/**
 * The scanner seam.
 *
 * Everything above this file talks about findings, not about Cloudmersive.
 * That matters for two reasons: the vendor decision was made on a
 * self-serve/synchronous/no-retention basis rather than on detection strength,
 * and the stronger multi-engine option (OPSWAT) was deferred only because its
 * pricing is sales-gated. Swapping or doubling up should be one new file, not a
 * migration.
 *
 * No provider implementation may leak its payload upwards: callers receive the
 * normalised findings below and a short reason category, never the raw
 * response, and never anything derived from file contents.
 */

/** Normalised findings. Every field is "did the scanner see this", not policy. */
export interface ScanFindings {
  /** The provider's own overall verdict. Necessary, never sufficient. */
  clean: boolean;
  /**
   * Format established from content by the provider, e.g. ".pdf".
   *
   * Non-optional: a response without it is rejected as unparseable rather than
   * accepted with the check skipped.
   */
  verifiedFileFormat: string;
  containsExecutable: boolean;
  containsInvalidFile: boolean;
  containsScript: boolean;
  containsPasswordProtectedFile: boolean;
  containsRestrictedFileFormat: boolean;
  containsMacros: boolean;
  containsXmlExternalEntities: boolean;
  containsInsecureDeserialization: boolean;
  containsHtml: boolean;
  containsUnsafeArchive: boolean;
  containsOleEmbeddedObject: boolean;
  /** Names only, for the audit trail. Never file contents. */
  virusNames: string[];
}

/** Why a scan could not produce findings. None of these may become SAFE. */
export type ScanFailure =
  | "unconfigured"
  | "too_large"
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "bad_response"
  | "network";

/**
 * Why a response was unusable, in terms safe to persist.
 *
 * A discriminated union rather than a string, deliberately: a provider cannot
 * hand back free text, so no fragment of a response body, header or key can
 * reach `FileAsset.scanReason` even by accident. The only variable carried is
 * an integer HTTP status.
 *
 * This is diagnosis, not policy. Nothing here influences the verdict, the
 * retry decision, or whether a file may be sold.
 */
export type ScanFailureDetail =
  | { kind: "http"; status: number }
  | { kind: "json_parse" }
  | { kind: "schema" };

export type ScanProviderResult =
  | { ok: true; findings: ScanFindings }
  | { ok: false; failure: ScanFailure; detail?: ScanFailureDetail };

/**
 * Render a detail into the short token appended to the persisted reason.
 *
 * The second half of the guarantee above: the union constrains what a provider
 * may express, and this constrains what reaches the database. An out-of-range
 * or non-integer status is DROPPED rather than persisted — a missing token
 * costs a little diagnostic precision, whereas an unvalidated one would put an
 * unbounded value in an audit column.
 *
 * Returns null when there is nothing safe to add, which callers treat as
 * "keep the existing reason unchanged".
 */
export function formatFailureDetail(
  detail: ScanFailureDetail | undefined
): string | null {
  if (!detail) return null;

  if (detail.kind === "json_parse") return "json_parse";
  if (detail.kind === "schema") return "schema";

  const status = detail.status;
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  return `http_${status}`;
}

export interface ScanRequest {
  bytes: Uint8Array;
  fileName: string;
  /**
   * Content formats permitted for this file, as extensions (".pdf").
   * Enforced by the provider against the bytes, not against the name.
   */
  restrictToExtensions: string[];
  /**
   * Whether HTML markup is legitimate inside this file.
   *
   * True for EPUB only. An EPUB is a ZIP of XHTML by definition, so blocking
   * HTML there would reject every valid ebook — SaiFlow's core category. The
   * threat in an EPUB is script and executables, which stay blocked.
   */
  allowHtml: boolean;
}

export interface ScanProvider {
  /** Recorded in the audit trail, e.g. "cloudmersive". */
  readonly id: string;
  isConfigured(): boolean;
  scan(request: ScanRequest): Promise<ScanProviderResult>;
}

/** Failures worth another attempt later; the rest are terminal. */
export function isRetryableFailure(failure: ScanFailure): boolean {
  return (
    failure === "timeout" ||
    failure === "rate_limited" ||
    failure === "server_error" ||
    failure === "network"
  );
}
