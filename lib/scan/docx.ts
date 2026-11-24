/**
 * Document check for an OOXML .docx.
 *
 * The extension and the client MIME are not evidence. A file is a Word
 * document SaiFlow can sell only when its own ZIP directory says so:
 *
 *   - `[Content_Types].xml` is present and names the non-macro wordprocessing
 *     main part (`wordprocessingml.document.main+xml`)
 *   - `word/document.xml` is present
 *   - no VBA project, no macroEnabled content type, no ActiveX part, and no
 *     embedded OLE object
 *
 * Macro-enabled packages (`.docm`, `.dotm`) and any `.docx` that still
 * carries `vbaProject.bin` are rejected. Legacy Word names (`.doc`, `.dot`)
 * are not this format.
 *
 * The same byte check is used for a primary file and for a `.docx` member of
 * a ZIP. Inflation uses the existing decompression-bomb rule, and refuses a
 * package with more than MAX_DOCUMENT_ENTRIES parts or a part larger than
 * the 128MB scan ceiling.
 */
import { MAX_SCANNABLE_BYTES } from "@/lib/storage/provider";
import {
  isDecompressionBomb,
  isExecutableEntry,
  isNestedArchive,
  isScriptEntry,
  readEntryPayload,
  readZipCentralDirectory,
  type ArchiveEntry,
} from "./archive";

/** Most parts a sold document may contain. A real letter is a few dozen. */
export const MAX_DOCUMENT_ENTRIES = 1024;

export const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const DOCX_MAIN_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

/**
 * Legacy and macro Word names. `.docm` and `.dotm` are also on the spreadsheet
 * block list so a ZIP member is rejected as macros before this check runs.
 */
export const BLOCKED_WORD_EXTENSIONS = [".doc", ".dot", ".wbk", ".docb", ".docm", ".dotm"] as const;

export type DocumentReason =
  | "macros"
  | "format_mismatch"
  | "archive_encrypted"
  | "archive_decompression_bomb"
  | "archive_malformed"
  | "archive_unsupported"
  | "archive_executable"
  | "archive_script"
  | "archive_nested";

/**
 * Parts a .docx may contain when the provider whitelists archive members.
 * Sent only for a package that already passed `inspectWord`. `.bin` is here
 * so an ordinary non-VBA part is not a false mismatch; VBA and OLE bins are
 * rejected before the provider is asked. `.svg` is absent: it can carry script.
 */
export const DOCX_MEMBER_EXTENSIONS = [
  ".docx",
  ".zip",
  ".xml",
  ".rels",
  ".bin",
  ".png",
  ".jpeg",
  ".jpg",
  ".gif",
  ".emf",
  ".wmf",
  ".tif",
  ".tiff",
  ".odttf",
] as const;

function entryName(entry: ArchiveEntry): string {
  return entry.name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function extensionOf(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

function blockedWordExtension(name: string): boolean {
  const ext = extensionOf(name);
  return (BLOCKED_WORD_EXTENSIONS as readonly string[]).includes(ext);
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

/**
 * Whether this ZIP is a Word package rather than a spreadsheet or a plain
 * archive. A workbook wins when both `xl/workbook.xml` and `word/document.xml`
 * are present, so this returns false in that case.
 */
export function isWordPackage(entries: ArchiveEntry[]): boolean {
  const names = entries.map(entryName);
  if (!names.includes("[content_types].xml")) return false;
  if (names.includes("xl/workbook.xml") || names.includes("xl/workbook.bin")) return false;
  return names.includes("word/document.xml") || names.some((name) => name.startsWith("word/") && isVbaPart(name));
}

function findEntry(entries: ArchiveEntry[], exact: string): ArchiveEntry | undefined {
  return entries.find((entry) => entryName(entry) === exact);
}

/**
 * Inspect one Word package. `bytes` are the docx itself, not a ZIP that
 * merely contains one.
 */
export function inspectWord(bytes: Uint8Array): { ok: true } | { ok: false; reason: DocumentReason } {
  const dir = readZipCentralDirectory(bytes);
  if (!dir.ok) {
    return { ok: false, reason: dir.reason === "unsupported" ? "archive_unsupported" : "archive_malformed" };
  }
  if (dir.entries.length > MAX_DOCUMENT_ENTRIES) {
    return { ok: false, reason: "archive_decompression_bomb" };
  }
  if (isDecompressionBomb(dir.entries)) return { ok: false, reason: "archive_decompression_bomb" };
  if (dir.entries.some((entry) => entry.encrypted)) return { ok: false, reason: "archive_encrypted" };

  for (const entry of dir.entries) {
    if (isExecutableEntry(entry)) return { ok: false, reason: "archive_executable" };
    if (isScriptEntry(entry)) return { ok: false, reason: "archive_script" };
    if (isNestedArchive(entry)) return { ok: false, reason: "archive_nested" };
  }

  const names = dir.entries.map(entryName);
  if (names.some((name) => blockedWordExtension(name) || isVbaPart(name) || isActiveXPart(name) || isOleEmbedding(name))) {
    return { ok: false, reason: "macros" };
  }

  const typesEntry = findEntry(dir.entries, "[content_types].xml");
  const documentEntry = findEntry(dir.entries, "word/document.xml");
  if (!typesEntry || !documentEntry) return { ok: false, reason: "format_mismatch" };

  const types = readText(bytes, typesEntry);
  const document = readText(bytes, documentEntry);
  if (!types || !document) {
    return {
      ok: false,
      reason: types === "too_large" || document === "too_large" ? "archive_decompression_bomb" : "format_mismatch",
    };
  }

  const typesLower = types.toLowerCase();
  if (
    typesLower.includes("macroenabled") ||
    typesLower.includes("vbaproject") ||
    typesLower.includes("application/vnd.ms-office.vbaproject") ||
    typesLower.includes("activex")
  ) {
    return { ok: false, reason: "macros" };
  }
  if (!typesLower.includes(DOCX_MAIN_CONTENT_TYPE)) return { ok: false, reason: "format_mismatch" };
  if (!document.toLowerCase().includes("document")) return { ok: false, reason: "format_mismatch" };
  return { ok: true };
}

function readText(bytes: Uint8Array, entry: ArchiveEntry): string | null | "too_large" {
  const payload = readEntryPayload(bytes, entry, MAX_SCANNABLE_BYTES);
  if (!payload.ok) return payload.reason === "too_large" ? "too_large" : null;
  return new TextDecoder("utf-8", { fatal: false }).decode(payload.bytes);
}

/**
 * A member of an ordinary ZIP that is itself a Word document or a blocked
 * Word name. Returns the rejection reason, or null when the member is not
 * a Word file. `.docm` and `.dotm` are handled by the spreadsheet block list
 * first; this still rejects them if that list is not consulted.
 */
export function wordMemberReason(container: Uint8Array, entry: ArchiveEntry): DocumentReason | null {
  const ext = extensionOf(entry.name);
  if (ext === ".docm" || ext === ".dotm") return "macros";
  if (ext === ".doc" || ext === ".dot" || ext === ".wbk" || ext === ".docb") return "format_mismatch";
  if (ext !== ".docx") return null;
  const payload = readEntryPayload(container, entry, MAX_SCANNABLE_BYTES);
  if (!payload.ok) {
    if (payload.reason === "too_large") return "archive_decompression_bomb";
    if (payload.reason === "unsupported") return "archive_unsupported";
    return "format_mismatch";
  }
  const inner = inspectWord(payload.bytes);
  return inner.ok ? null : inner.reason;
}
