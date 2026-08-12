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
  /** Format established from content by the provider, e.g. ".pdf". */
  verifiedFileFormat: string | null;
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

export type ScanProviderResult =
  | { ok: true; findings: ScanFindings }
  | { ok: false; failure: ScanFailure };

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
