/**
 * Workbook check for an OOXML .xlsx.
 *
 * The extension and the client MIME are not evidence. A file is a workbook
 * SaiFlow can sell only when its own ZIP directory says so:
 *
 *   - `[Content_Types].xml` is present and names the non-macro spreadsheet
 *     main part (`spreadsheetml.sheet.main+xml`)
 *   - `xl/workbook.xml` is present
 *   - no VBA project, no macroEnabled content type, no ActiveX part, and no
 *     embedded OLE object
 *
 * What is blocked on purpose, even when it might sometimes be harmless:
 *
 *   - any part whose name contains `vbaProject` and ends in `.bin`
 *   - the whole `xl/activeX/` tree (form controls and macro ActiveX are not
 *     separated here; both are refused)
 *   - the whole `xl/embeddings/` tree (OLE objects, including a `.bin`
 *     oleObject). Chart XML under `xl/charts/` is not this tree.
 *   - `xl/printerSettings/*.bin` is NOT blocked. Excel writes it into ordinary
 *     macro-free workbooks.
 *
 * The same byte check is used for a primary file, an additional deliverable
 * (both are scanned as the object itself), and an `.xlsx` member of a ZIP.
 * Legacy and macro spreadsheet names are refused before the byte check.
 *
 * Inflation uses the existing decompression-bomb rule on the workbook's own
 * directory, and refuses a package with more than MAX_WORKBOOK_ENTRIES parts
 * or a part larger than the 128MB scan ceiling.
 */
import { MAX_SCANNABLE_BYTES } from "@/lib/storage/provider";
import {
  isDecompressionBomb,
  readEntryPayload,
  readZipCentralDirectory,
  type ArchiveEntry,
} from "./archive";

/** Most parts a sold workbook may contain. A real sheet is a few dozen. */
export const MAX_WORKBOOK_ENTRIES = 1024;

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const XLSX_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

/** Macro-enabled and legacy spreadsheet names. Also other macro Office types. */
export const BLOCKED_SPREADSHEET_EXTENSIONS = [
  ".xlsm",
  ".xlsb",
  ".xltm",
  ".xlam",
  ".xla",
  ".xls",
  ".xlt",
  ".pptm",
  ".docm",
  ".dotm",
  ".potm",
  ".ppam",
  ".ppsm",
] as const;

export type WorkbookReason =
  | "macros"
  | "format_mismatch"
  | "archive_encrypted"
  | "archive_decompression_bomb"
  | "archive_malformed"
  | "archive_unsupported";

function entryName(entry: ArchiveEntry): string {
  return entry.name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function extensionOf(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

export function blockedSpreadsheetExtension(name: string): boolean {
  const ext = extensionOf(name);
  return (BLOCKED_SPREADSHEET_EXTENSIONS as readonly string[]).includes(ext);
}

function isVbaPart(name: string): boolean {
  return name.includes("vbaproject") && name.endsWith(".bin");
}

function isActiveXPart(name: string): boolean {
  return name.split("/").includes("activex");
}

function isOleEmbedding(name: string): boolean {
  return name.split("/").includes("embeddings");
}

export function isSpreadsheetPackage(entries: ArchiveEntry[]): boolean {
  const names = entries.map(entryName);
  if (!names.includes("[content_types].xml")) return false;
  return names.includes("xl/workbook.xml") || names.includes("xl/workbook.bin") || names.some(isVbaPart);
}

function findEntry(entries: ArchiveEntry[], exact: string): ArchiveEntry | undefined {
  return entries.find((entry) => entryName(entry) === exact);
}

/**
 * Inspect one workbook package. `bytes` are the xlsx itself, not a ZIP that
 * merely contains one.
 */
export function inspectWorkbook(bytes: Uint8Array): { ok: true } | { ok: false; reason: WorkbookReason } {
  const dir = readZipCentralDirectory(bytes);
  if (!dir.ok) {
    return { ok: false, reason: dir.reason === "unsupported" ? "archive_unsupported" : "archive_malformed" };
  }
  if (dir.entries.length > MAX_WORKBOOK_ENTRIES) {
    return { ok: false, reason: "archive_decompression_bomb" };
  }
  if (isDecompressionBomb(dir.entries)) return { ok: false, reason: "archive_decompression_bomb" };
  if (dir.entries.some((entry) => entry.encrypted)) return { ok: false, reason: "archive_encrypted" };

  const names = dir.entries.map(entryName);
  if (names.some((name) => blockedSpreadsheetExtension(name) || isVbaPart(name) || isActiveXPart(name) || isOleEmbedding(name))) {
    return { ok: false, reason: "macros" };
  }
  if (names.some((name) => name === "xl/workbook.bin")) return { ok: false, reason: "format_mismatch" };

  const typesEntry = findEntry(dir.entries, "[content_types].xml");
  const workbookEntry = findEntry(dir.entries, "xl/workbook.xml");
  if (!typesEntry || !workbookEntry) return { ok: false, reason: "format_mismatch" };

  const types = readText(bytes, typesEntry);
  const workbook = readText(bytes, workbookEntry);
  if (!types || !workbook) return { ok: false, reason: types === "too_large" || workbook === "too_large" ? "archive_decompression_bomb" : "format_mismatch" };

  const typesLower = types.toLowerCase();
  if (
    typesLower.includes("macroenabled") ||
    typesLower.includes("vbaproject") ||
    typesLower.includes("application/vnd.ms-office.vbaproject") ||
    typesLower.includes("activex")
  ) {
    return { ok: false, reason: "macros" };
  }
  if (!typesLower.includes(XLSX_MAIN_CONTENT_TYPE)) return { ok: false, reason: "format_mismatch" };
  if (!workbook.toLowerCase().includes("workbook")) return { ok: false, reason: "format_mismatch" };
  return { ok: true };
}

function readText(bytes: Uint8Array, entry: ArchiveEntry): string | null | "too_large" {
  const payload = readEntryPayload(bytes, entry, MAX_SCANNABLE_BYTES);
  if (!payload.ok) return payload.reason === "too_large" ? "too_large" : null;
  return new TextDecoder("utf-8", { fatal: false }).decode(payload.bytes);
}

/**
 * A member of an ordinary ZIP that is itself a workbook or a blocked
 * spreadsheet. Returns the rejection reason, or null when the member is not
 * a spreadsheet.
 */
export function spreadsheetMemberReason(container: Uint8Array, entry: ArchiveEntry): WorkbookReason | null {
  if (blockedSpreadsheetExtension(entry.name)) return extensionOf(entry.name) === ".xls" || extensionOf(entry.name) === ".xlt" ? "format_mismatch" : "macros";
  if (extensionOf(entry.name) !== ".xlsx") return null;
  const payload = readEntryPayload(container, entry, MAX_SCANNABLE_BYTES);
  if (!payload.ok) {
    if (payload.reason === "too_large") return "archive_decompression_bomb";
    if (payload.reason === "unsupported") return "archive_unsupported";
    return "format_mismatch";
  }
  const inner = inspectWorkbook(payload.bytes);
  return inner.ok ? null : inner.reason;
}
