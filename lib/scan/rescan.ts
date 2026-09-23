import { prisma } from "@/lib/prisma";
import { SCAN_LEASE_MS } from "@/lib/scan/run";
import {
  sellerFileState,
  type SellerAssetView,
  type SellerProductView,
} from "@/lib/seller-file-state";

/**
 * Manual retry of a file's scan.
 *
 * A retry is permitted only for a file the seller currently sees as FAILED
 * and that can be scanned again. The decision reuses the seller-facing
 * derivation, so what the button shows and what the route accepts cannot
 * drift apart.
 *
 * Never permitted:
 *   - UNSAFE: a verdict on the bytes is final; only a different file escapes
 *   - passed: nothing to do
 *   - uploaded or scanning: an attempt is pending or under way
 *   - no FileAsset row: there is nothing the worker could claim
 */
export type RescanRefusal =
  | "no_file"
  | "no_scan_record"
  | "unsafe"
  | "already_passed"
  | "not_failed";

export type RescanDecision = { ok: true } | { ok: false; refusal: RescanRefusal };

export function rescanDecision(
  product: SellerProductView,
  asset: SellerAssetView | null,
  now: Date = new Date()
): RescanDecision {
  if (product.fileKey === null) return { ok: false, refusal: "no_file" };
  const state = sellerFileState(product, asset, now);
  if (!state) return { ok: false, refusal: "no_file" };
  if (state.state === "passed") return { ok: false, refusal: "already_passed" };
  if (state.state !== "failed") return { ok: false, refusal: "not_failed" };
  if (state.failure === "no_record") return { ok: false, refusal: "no_scan_record" };
  if (!state.canRetry) return { ok: false, refusal: "unsafe" };
  return { ok: true };
}

/**
 * Reset exactly what another attempt needs, and nothing else.
 *
 * The asset keeps its provenance, its name and its previous digest; only the
 * attempt counter, the last reason, the timestamps and a DEAD lease are
 * cleared. Two conditions guard the write, both evaluated by the database:
 *
 *   unsettled  — a SAFE or UNSAFE verdict written in the meantime is never
 *                undone
 *   no live    — a worker holding a fresh lease keeps it; resetting under it
 *   claim        would orphan the verdict it is about to write and start a
 *                second scan of the same bytes
 *
 * Returns false when either guard refuses, and the caller answers 409. The
 * product's own SCAN_ERROR copy is moved back to PENDING so moderators see
 * "in progress" again; a product pointed at another file is untouched.
 */
export async function resetScanForRetry(
  key: string,
  productId: string,
  now: Date = new Date()
): Promise<boolean> {
  // The same lease rule the worker's claim uses: a live claim belongs to a
  // worker mid-scan, and its lease is never cleared from here. Evaluated in
  // the database, in the same statement as the reset, so a claim taken
  // between the seller's decision and this write still wins.
  const leaseCutoff = new Date(now.getTime() - SCAN_LEASE_MS);
  const reset = await prisma.fileAsset.updateMany({
    where: {
      key,
      route: "PRODUCT_FILE",
      scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] },
      AND: [{ OR: [{ scanClaimToken: null }, { scanClaimedAt: { lt: leaseCutoff } }] }],
    },
    data: {
      scanAttempts: 0,
      scanReason: null,
      scanAt: null,
      scanClaimToken: null,
      scanClaimedAt: null,
    },
  });
  if (reset.count !== 1) return false;

  await prisma.product.updateMany({
    where: { id: productId, fileKey: key, fileScanStatus: "SCAN_ERROR" },
    data: {
      fileScanStatus: "PENDING_SCAN",
      fileScanKey: null,
      fileScanSha256: null,
      fileScanAt: null,
    },
  });
  return true;
}
