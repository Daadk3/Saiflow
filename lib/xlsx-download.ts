/**
 * Buyer-download headers for a workbook.
 *
 * The signed storage URL keeps whatever type the upload stored. When the
 * stored file name is an .xlsx, the download route serves the bytes itself
 * so the browser gets the spreadsheet type and a workbook filename.
 */
export const XLSX_DOWNLOAD_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function xlsxDownloadName(storedName: string | null | undefined): string | null {
  if (!storedName) return null;
  const base = storedName.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  if (!base.toLowerCase().endsWith(".xlsx")) return null;
  const cleaned = base.replace(/["\r\n]/g, "").replace(/[^\x20-\x7e\u00a0-\uffff]/g, "_");
  return cleaned.length > 0 ? cleaned : null;
}

/** Content-Disposition that keeps a non-ASCII workbook name. */
export function xlsxContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
