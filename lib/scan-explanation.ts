/**
 * A persisted scan reason, reduced to a sentence an admin may read.
 *
 * `FileAsset.scanReason` is a short category the scanner writes. It is not
 * file contents, but the column is still a free string: a value this build
 * does not recognise must never be echoed, because a later writer could put
 * something else there. This function returns one of a fixed set of keys, or
 * null. Callers translate the key. They never receive the stored string.
 *
 * It decides nothing. Checkout, download and inspection keep using the scan
 * status columns. A key here cannot make a file sellable or openable.
 */

export const SCAN_EXPLANATION_KEYS = [
  "malware",
  "executable",
  "script",
  "pdf_javascript",
  "pdf_launch_action",
  "pdf_submit_form",
  "pdf_embedded_file",
  "pdf_xfa",
  "pdf_rich_media",
  "pdf_open_action",
  "pdf_additional_actions",
  "pdf_unreadable",
  "embedded",
  "macros",
  "password_protected",
  "archive",
  "format",
  "html",
  "unattributed",
] as const;

export type ScanExplanationKey = (typeof SCAN_EXPLANATION_KEYS)[number];

/**
 * Own properties only. A lookup of an inherited name (`constructor`,
 * `toString`) must not become an explanation.
 */
const TABLE: Record<string, ScanExplanationKey> = {
  malware: "malware",
  executable: "executable",
  archive_executable: "executable",
  script: "script",
  archive_script: "script",
  pdf_javascript: "pdf_javascript",
  pdf_launch_action: "pdf_launch_action",
  pdf_submit_form: "pdf_submit_form",
  pdf_embedded_file: "pdf_embedded_file",
  pdf_xfa: "pdf_xfa",
  pdf_rich_media: "pdf_rich_media",
  pdf_open_action: "pdf_open_action",
  pdf_additional_actions: "pdf_additional_actions",
  pdf_unreadable: "pdf_unreadable",
  xxe: "script",
  insecure_deserialization: "script",
  ole_embedded_object: "embedded",
  macros: "macros",
  password_protected: "password_protected",
  archive_encrypted: "password_protected",
  unsafe_archive: "archive",
  archive_path_traversal: "archive",
  archive_symlink: "archive",
  archive_nested: "archive",
  archive_decompression_bomb: "archive",
  archive_unsupported: "archive",
  archive_malformed: "archive",
  archive_type_marker: "archive",
  archive_member_type: "archive",
  archive_member_unreadable: "archive",
  archive_member_limit: "archive",
  archive_active_html: "script",
  archive_not_html_app: "format",
  unrecognised_format: "format",
  format_mismatch: "format",
  malformed_file: "format",
  format_not_verified: "format",
  html_content: "html",
  not_clean_unattributed: "unattributed",
};

/**
 * Map a stored reason onto an explanation key.
 *
 * The `_terminal` suffix is the scanner's retry marker (lib/scan/run.ts). It
 * is stripped before the lookup and is not itself an explanation. Anything
 * that is not a short lowercase token — including a reason this build has
 * never written — is null, and the caller says only that the file is blocked.
 */
export function explainScanReason(
  reason: string | null | undefined
): ScanExplanationKey | null {
  if (typeof reason !== "string") return null;
  const base = reason.endsWith("_terminal")
    ? reason.slice(0, -"_terminal".length)
    : reason;
  if (!/^[a-z0-9_]{1,64}$/.test(base)) return null;
  if (!Object.hasOwn(TABLE, base)) return null;
  return TABLE[base] ?? null;
}
