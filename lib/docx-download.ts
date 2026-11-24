/**
 * Buyer-download headers for a Word document.
 *
 * The signed storage URL keeps whatever type the upload stored. When the
 * stored file name is a .docx, the download route serves the bytes itself
 * so the browser gets the document type and a Word filename.
 */
export const DOCX_DOWNLOAD_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function docxDownloadName(storedName: string | null | undefined): string | null {
  if (!storedName) return null;
  const base = storedName.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base.toLowerCase().endsWith(".docx")) return null;
  const cleaned = base.replace(/["\r\n]/g, "").replace(/[^\x20-\x7e\u00a0-\uffff]/g, "_");
  return cleaned.length > 0 ? cleaned : null;
}

/** Content-Disposition that keeps a non-ASCII document name. */
export function docxContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
