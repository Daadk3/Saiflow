import type { FileScanStatus, UploadRoute } from "@prisma/client";
import { deliverableGateReason, type DeliverableSafety } from "@/lib/file-safety";
import { MAX_SCAN_ATTEMPTS, SCAN_LEASE_MS } from "@/lib/scan/run";

/**
 * What a seller is told about their file, in four words: uploaded, scanning,
 * passed, failed.
 *
 * SERVER-SIDE ONLY, like lib/creator-file-status.ts, and for the same reason:
 * it reads the scan columns and the FileAsset row, none of which may reach a
 * browser. The browser receives the result and renders it.
 *
 * THE POINT OF THIS MODULE is that "scanning" is bounded. A file whose scan
 * never started, never finished, or ran out of attempts is reported as
 * FAILED with a reason category and a retry, never as scanning forever. The
 * gates are untouched: "passed" is derived from `deliverableGateReason`, so it
 * is true under exactly the conditions `isDeliverableSafe` is true, and every
 * other state refuses at checkout and download exactly as before.
 */
export const SCAN_WINDOW_MS = 15 * 60_000;

export type SellerFileStateName = "uploaded" | "scanning" | "passed" | "failed";

/** Short, safe categories. Never a provider payload, a key or a hash. */
export type SellerFailure =
  | "unsafe_content"
  | "unsupported_format"
  | "password_protected"
  | "archive_problem"
  | "check_unavailable"
  | "timed_out"
  | "not_started"
  | "attempts_exhausted"
  | "no_record"
  | "unknown";

export const SELLER_FAILURES: readonly SellerFailure[] = [
  "unsafe_content",
  "unsupported_format",
  "password_protected",
  "archive_problem",
  "check_unavailable",
  "timed_out",
  "not_started",
  "attempts_exhausted",
  "no_record",
  "unknown",
];

export interface SellerFileState {
  state: SellerFileStateName;
  failure: SellerFailure | null;
  canRetry: boolean;
}

export interface SellerAssetView {
  key: string;
  shopId: string;
  route: UploadRoute;
  scanStatus: FileScanStatus;
  scanAttempts: number;
  scanAt: Date | null;
  scanReason: string | null;
  scanClaimToken: string | null;
  scanClaimedAt: Date | null;
  createdAt: Date;
}

export interface SellerProductView extends DeliverableSafety {
  shopId: string;
  /** Lower bound of the attachment time: a product is never attached after its last update. */
  updatedAt: Date;
}

const UNSAFE_REASONS = new Set([
  "malware",
  "executable",
  "script",
  "macros",
  "xxe",
  "insecure_deserialization",
  "ole_embedded_object",
  "html_content",
  "unsafe_archive",
  "archive_executable",
  "archive_script",
  "archive_nested",
]);
const FORMAT_REASONS = new Set([
  "unrecognised_format",
  "format_mismatch",
  "format_not_verified",
  "malformed_file",
]);
const UNAVAILABLE_REASONS = new Set(["hash_failed", "provider_threw", "unknown_verdict"]);

/** Collapse the worker's reason category into something a seller can act on. */
export function failureCategory(reason: string | null): SellerFailure {
  if (!reason) return "unknown";
  const base = reason.replace(/_terminal$/, "");
  if (base.startsWith("pdf_") || UNSAFE_REASONS.has(base)) return "unsafe_content";
  if (base === "password_protected" || base === "archive_encrypted") return "password_protected";
  if (base.startsWith("archive_")) return "archive_problem";
  if (FORMAT_REASONS.has(base)) return "unsupported_format";
  if (base.startsWith("provider_") || base.startsWith("storage_") || UNAVAILABLE_REASONS.has(base)) {
    return "check_unavailable";
  }
  return "unknown";
}

/**
 * Whether a worker currently holds this row. Mirrors the worker's own lease
 * rule (lib/scan/run.ts): a claim younger than SCAN_LEASE_MS is live; an
 * older one belongs to a worker that died and may be taken over.
 *
 * A token with NO timestamp is treated as live. That is what the database
 * does: the worker's claim and the retry reset both release a row only when
 * `scanClaimToken IS NULL OR scanClaimedAt < cutoff`, and in SQL a null
 * timestamp satisfies neither, so such a row is held. Reporting it as
 * retryable here would offer a retry the reset must refuse.
 */
export function hasLiveClaim(
  asset: Pick<SellerAssetView, "scanClaimToken" | "scanClaimedAt">,
  now: Date = new Date()
): boolean {
  if (asset.scanClaimToken === null) return false;
  if (asset.scanClaimedAt === null) return true;
  return now.getTime() - asset.scanClaimedAt.getTime() < SCAN_LEASE_MS;
}

const failed = (failure: SellerFailure, canRetry: boolean): SellerFileState => ({
  state: "failed",
  failure,
  canRetry,
});
const SCANNING: SellerFileState = { state: "scanning", failure: null, canRetry: false };
const UPLOADED: SellerFileState = { state: "uploaded", failure: null, canRetry: false };
const PASSED: SellerFileState = { state: "passed", failure: null, canRetry: false };

/**
 * Derive the seller-facing state.
 *
 * Precedence: the product's own gate decides passed and unsafe, because those
 * are what checkout and download read. Everything else comes from the
 * FileAsset row the current key points at, and only that row: an asset for
 * another key, another shop or another route is treated as no record.
 */
export function sellerFileState(
  product: SellerProductView,
  asset: SellerAssetView | null,
  now: Date = new Date()
): SellerFileState | null {
  if (product.fileKey === null) return null;

  const gate = deliverableGateReason(product);
  if (gate === "safe") return PASSED;
  if (gate === "unsafe") return failed("unsafe_content", false);

  const usable =
    asset &&
    asset.key === product.fileKey &&
    asset.shopId === product.shopId &&
    asset.route === "PRODUCT_FILE"
      ? asset
      : null;
  if (!usable) return failed("no_record", false);

  if (usable.scanStatus === "UNSAFE") {
    const category = failureCategory(usable.scanReason);
    return failed(category === "unknown" ? "unsafe_content" : category, false);
  }
  // A verdict exists for these bytes and only the product binding is behind;
  // reconciliation closes that, so it is still scanning as far as the seller
  // is concerned.
  if (usable.scanStatus === "SAFE") return SCANNING;

  // A live claim means a worker is scanning these bytes right now. That is
  // "scanning" whatever the row's last status, attempt count or reason says,
  // and it is never retryable: a retry would clear the lease and discard the
  // verdict about to be written. This check therefore comes before every
  // branch below that can offer a retry, including SCAN_ERROR rows whose
  // budget is spent or whose last reason was terminal.
  if (hasLiveClaim(usable, now)) return SCANNING;

  const exhausted = usable.scanAttempts >= MAX_SCAN_ATTEMPTS;
  const lastAttemptAt = usable.scanAt;
  const stale = (at: Date | null) => at !== null && now.getTime() - at.getTime() > SCAN_WINDOW_MS;

  if (usable.scanStatus === "SCAN_ERROR") {
    const terminal = usable.scanReason?.endsWith("_terminal") ?? false;
    if (exhausted || terminal) {
      const category = failureCategory(usable.scanReason);
      return failed(category === "unknown" && exhausted ? "attempts_exhausted" : category, true);
    }
    if (stale(lastAttemptAt)) return failed("timed_out", true);
    return SCANNING;
  }

  // PENDING_SCAN (no live claim: handled above)
  if (exhausted) return failed("attempts_exhausted", true);
  if (lastAttemptAt !== null) {
    return stale(lastAttemptAt) ? failed("timed_out", true) : SCANNING;
  }
  const since = new Date(Math.max(product.updatedAt.getTime(), usable.createdAt.getTime()));
  if (stale(since)) return failed("not_started", true);
  return UPLOADED;
}
