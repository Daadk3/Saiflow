/**
 * Buyer-download headers for a plain-text file.
 *
 * Served as an attachment. A .txt is never rendered in the browser, so text
 * that happens to contain markup cannot run as a page.
 */
export const TXT_DOWNLOAD_TYPE = "text/plain; charset=utf-8";

export function txtDownloadName(storedName: string | null | undefined): string | null {
  if (!storedName) return null;
  const base = storedName.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base.toLowerCase().endsWith(".txt")) return null;
  const cleaned = base.replace(/["\r\n]/g, "").replace(/[^\x20-\x7e\u00a0-\uffff]/g, "_");
  return cleaned.length > 0 ? cleaned : null;
}

/** Content-Disposition that keeps a non-ASCII text filename. */
export function txtContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
