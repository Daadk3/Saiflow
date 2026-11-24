/**
 * Plain-text check for a .txt deliverable.
 *
 * There is no magic number for text, so the bytes themselves have to be text:
 *
 *   - UTF-8, with or without a BOM, or
 *   - UTF-16 LE/BE when a BOM is present (Windows "Unicode" text)
 *
 * A NUL, a control character other than tab, newline and carriage return, or
 * a byte that is not valid in that encoding is binary and is rejected.
 * Legacy single-byte code pages are rejected too: they cannot be told apart
 * from binary. Save Arabic text as UTF-8.
 *
 * A file that is really HTML, SVG, XML, PHP, PostScript/EPS, or a shebang
 * script is not a plain-text product, even when those bytes happen to be
 * valid UTF-8. The same check is applied to a `.txt` member of a ZIP.
 */
import { MAX_SCANNABLE_BYTES } from "@/lib/storage/provider";
import { readEntryPayload, type ArchiveEntry } from "./archive";

export type TextReason = "format_mismatch" | "archive_decompression_bomb" | "archive_unsupported";

const MARKUP_OR_PROGRAM =
  /^(?:#!|<\?php\b|<!doctype\b|<html\b|<svg\b|<\?xml\b|<script\b|<head\b|<body\b|%!ps)/i;

function extensionOf(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

function textCharsOk(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
    if (c < 0x20 || c === 0x7f) return false;
    if (c >= 0x80 && c <= 0x9f) return false;
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

function isMarkupOrProgram(text: string): boolean {
  const head = text.replace(/^\uFEFF/, "").trimStart().slice(0, 80);
  return MARKUP_OR_PROGRAM.test(head);
}

/**
 * The decoded text, or null when the bytes are not plain text.
 * Empty input is not a text file.
 */
export function plainTextContent(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SCANNABLE_BYTES) return null;

  let text: string;
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      // UTF-32 LE uses this BOM followed by two zero bytes.
      if (bytes.length >= 4 && bytes[2] === 0x00 && bytes[3] === 0x00) return null;
      if ((bytes.length - 2) % 2 !== 0) return null;
      text = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      if ((bytes.length - 2) % 2 !== 0) return null;
      text = new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
    } else {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
  } catch {
    return null;
  }

  if (text.length === 0) return null;
  if (!textCharsOk(text)) return null;
  if (isMarkupOrProgram(text)) return null;
  return text;
}

export function isPlainText(bytes: Uint8Array): boolean {
  return plainTextContent(bytes) !== null;
}

export function inspectPlainText(bytes: Uint8Array): { ok: true } | { ok: false; reason: "format_mismatch" } {
  return isPlainText(bytes) ? { ok: true } : { ok: false, reason: "format_mismatch" };
}

/**
 * A `.txt` member of an ordinary ZIP. Returns the rejection reason, or null
 * when the member is not a `.txt` or when its bytes are plain text.
 */
export function textMemberReason(container: Uint8Array, entry: ArchiveEntry): TextReason | null {
  if (entry.name.endsWith("/")) return null;
  if (extensionOf(entry.name) !== ".txt") return null;
  const payload = readEntryPayload(container, entry, MAX_SCANNABLE_BYTES);
  if (!payload.ok) {
    if (payload.reason === "too_large") return "archive_decompression_bomb";
    if (payload.reason === "unsupported") return "archive_unsupported";
    return "format_mismatch";
  }
  return isPlainText(payload.bytes) ? null : "format_mismatch";
}
