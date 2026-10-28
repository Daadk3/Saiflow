/**
 * Facts about a deliverable's bytes for the founder's review checklist:
 * whether the file opens, how many pages a PDF has, and whether its text
 * contains contact details or a banned product type.
 *
 * Runs inside the scan pipeline, on the bytes it already read, so nothing is
 * downloaded twice. Best-effort and bounded: every decompression has an
 * output ceiling, and any failure yields "could not check" rather than a
 * pass. The text never leaves this module; only flag codes and counts do
 * (FileContentFacts), the same rule the scanner follows for its reasons.
 *
 * These facts are flags for a person. They feed lib/review-checklist and
 * nothing else; no gate reads them and they never move moderationStatus.
 */
import { inflateRawSync, inflateSync } from "node:zlib";
import {
  findBannedTypes,
  findContactInfo,
  type FileContentFacts,
} from "@/lib/review-checklist";
import { readZipCentralDirectory, type ArchiveEntry } from "@/lib/scan/archive";
import { sniffFormat } from "@/lib/scan/sniff";

/** Most decompressed bytes read from one file, across all its streams. */
const MAX_INFLATED_TOTAL = 32 * 1024 * 1024;
/** Most decompressed bytes from a single stream. */
const MAX_INFLATED_STREAM = 8 * 1024 * 1024;
const MAX_STREAMS = 4000;
/** Most extracted text kept for the searches. */
const MAX_TEXT = 2 * 1024 * 1024;
/** Fewer extracted characters than this and the text checks are "not checked". */
const MIN_TEXT_FOR_CHECK = 40;

export function extractFileFacts(bytes: Uint8Array): FileContentFacts {
  try {
    const format = sniffFormat(bytes);
    if (format === "pdf") return pdfFacts(bytes);
    if (format === "zip") return zipFacts(bytes);
    if (format === "unknown") return empty(null, false);
    // Images, audio and video: recognised from their bytes, no text to read.
    return empty(format, true);
  } catch {
    return empty(null, false);
  }
}

function empty(kind: string | null, opens: boolean): FileContentFacts {
  return { kind, opens, pageCount: null, textChecked: false, contact: [], banned: [] };
}

function withText(kind: string, opens: boolean, pageCount: number | null, text: string): FileContentFacts {
  const meaningful = text.replace(/\s+/g, "").length >= MIN_TEXT_FOR_CHECK;
  return {
    kind,
    opens,
    pageCount,
    textChecked: meaningful,
    contact: meaningful ? findContactInfo(text) : [],
    banned: meaningful ? findBannedTypes(withReversedArabic(text)) : [],
  };
}

/**
 * Some PDF producers store Arabic in visual order, so a phrase reads
 * backwards once extracted. Searching each line as written and reversed
 * finds it either way.
 */
function withReversedArabic(text: string): string {
  return text
    .split("\n")
    .map((line) => (/[؀-ۿ]/.test(line) ? `${line}\n${Array.from(line).reverse().join("")}` : line))
    .join("\n");
}

/* ------------------------------------------------------------------ */
/* PDF                                                                  */
/* ------------------------------------------------------------------ */

class Budget {
  used = 0;
  take(n: number): boolean {
    this.used += n;
    return this.used <= MAX_INFLATED_TOTAL;
  }
}

function inflate(data: Uint8Array, budget: Budget): Uint8Array | null {
  if (budget.used >= MAX_INFLATED_TOTAL) return null;
  const maxOutputLength = Math.min(MAX_INFLATED_STREAM, MAX_INFLATED_TOTAL - budget.used);
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      const out = fn(data, { maxOutputLength });
      if (!budget.take(out.byteLength)) return null;
      return out;
    } catch {
      // Try the next framing, then give up on this stream.
    }
  }
  return null;
}

/** Every stream's body, decompressed when it is Flate and readable. */
function pdfStreams(raw: string, bytes: Uint8Array, budget: Budget): string[] {
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = re.exec(raw)) && count < MAX_STREAMS) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    count++;
    const dict = raw.slice(Math.max(0, match.index - 400), match.index);
    const dictStart = dict.lastIndexOf("<<");
    const header = dictStart >= 0 ? dict.slice(dictStart) : dict;
    const body = bytes.subarray(start, end);
    if (/\/Filter\s*\[?\s*\/FlateDecode/.test(header)) {
      const inflated = inflate(body, budget);
      if (inflated) out.push(latin1(inflated));
    } else if (!/\/Filter/.test(header)) {
      out.push(raw.slice(start, end));
    }
    re.lastIndex = end;
  }
  return out;
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/** Pages: page objects in the file body or in object streams. */
function countPages(chunks: string[]): number {
  let pages = 0;
  for (const chunk of chunks) pages += chunk.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages;
}

/**
 * Glyph code → Unicode, merged from every ToUnicode CMap in the file. Fonts
 * can disagree about a code, so this is approximate; it is good enough to
 * find a phrase, and a wrong mapping can only cost a flag, never grant one.
 */
function toUnicodeMap(streams: string[]): Map<number, string> {
  const map = new Map<number, string>();
  const hexToString = (hex: string) => {
    let s = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const stream of streams) {
    if (!stream.includes("begincmap")) continue;
    for (const block of stream.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, src, dst] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        map.set(parseInt(src, 16), hexToString(dst));
      }
    }
    for (const block of stream.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, lo, hi, dst] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const from = parseInt(lo, 16);
        const to = Math.min(parseInt(hi, 16), from + 0xffff);
        const base = parseInt(dst.slice(-4), 16);
        const prefix = hexToString(dst.slice(0, -4));
        for (let code = from; code <= to; code++) map.set(code, prefix + String.fromCharCode(base + code - from));
      }
    }
  }
  return map;
}

function decodeLiteral(body: string): string {
  return body
    .replace(/\\([nrtbf()\\])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" } as Record<string, string>)[c] ?? c)
    .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\\r?\n/g, "");
}

function decodeHex(hex: string, cmap: Map<number, string>): string {
  const clean = hex.replace(/\s+/g, "");
  if (/^feff/i.test(clean)) {
    let s = "";
    for (let i = 4; i + 4 <= clean.length; i += 4) s += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
    return s;
  }
  if (cmap.size === 0) return "";
  let s = "";
  const width = clean.length % 4 === 0 ? 4 : 2;
  for (let i = 0; i + width <= clean.length; i += width) s += cmap.get(parseInt(clean.slice(i, i + width), 16)) ?? "";
  return s;
}

/** Text shown on the page (Tj / TJ) and the targets of link annotations. */
function pdfText(raw: string, streams: string[]): string {
  const cmap = toUnicodeMap(streams);
  const parts: string[] = [];
  let size = 0;
  const push = (s: string) => {
    if (!s || size >= MAX_TEXT) return;
    parts.push(s);
    size += s.length;
  };
  const literal = /\((?:\\[\s\S]|[^\\)])*\)/g;
  const hex = /<([0-9A-Fa-f\s]+)>/g;
  for (const stream of streams) {
    if (!/\bBT\b/.test(stream)) continue;
    for (const [, block] of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
      const line: string[] = [];
      for (const [token] of block.matchAll(new RegExp(`${literal.source}|${hex.source}`, "g"))) {
        line.push(token.startsWith("(") ? decodeLiteral(token.slice(1, -1)) : decodeHex(token.slice(1, -1), cmap));
      }
      push(line.join(""));
    }
  }
  for (const chunk of [raw, ...streams]) {
    for (const [, uri] of chunk.matchAll(/\/URI\s*\(((?:\\[\s\S]|[^\\)])*)\)/g)) push(` ${decodeLiteral(uri)} `);
  }
  return parts.join("\n");
}

function pdfFacts(bytes: Uint8Array): FileContentFacts {
  const raw = latin1(bytes);
  const budget = new Budget();
  const streams = pdfStreams(raw, bytes, budget);
  const pages = countPages([raw, ...streams]);
  const eof = raw.lastIndexOf("%%EOF");
  const hasEnd = eof >= 0 && eof > raw.length - 2048;
  const opens = hasEnd && pages > 0;
  return withText("pdf", opens, pages > 0 ? pages : null, pdfText(raw, streams));
}

/* ------------------------------------------------------------------ */
/* ZIP-based files (DOCX, EPUB, plain archives)                         */
/* ------------------------------------------------------------------ */

const TEXT_ENTRY = /\.(?:xml|xhtml|html?|txt|md|csv|json|opf|ncx)$/i;

function entryBytes(bytes: Uint8Array, entry: ArchiveEntry, budget: Budget): Uint8Array | null {
  if (entry.encrypted || entry.uncompressedSize > MAX_INFLATED_STREAM) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = entry.localHeaderOffset;
  if (base + 30 > bytes.byteLength) return null;
  const start = base + 30 + view.getUint16(base + 26, true) + view.getUint16(base + 28, true);
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) return null;
  const data = bytes.subarray(start, end);
  if (entry.method === 0) return budget.take(data.byteLength) ? data : null;
  if (entry.method === 8) {
    if (budget.used >= MAX_INFLATED_TOTAL) return null;
    try {
      const out = inflateRawSync(data, { maxOutputLength: Math.min(MAX_INFLATED_STREAM, MAX_INFLATED_TOTAL - budget.used) });
      return budget.take(out.byteLength) ? out : null;
    } catch {
      return null;
    }
  }
  return null;
}

function zipFacts(bytes: Uint8Array): FileContentFacts {
  const dir = readZipCentralDirectory(bytes);
  if (!dir.ok) return empty("zip", false);
  const budget = new Budget();
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let size = 0;
  for (const entry of dir.entries) {
    if (size >= MAX_TEXT) break;
    if (!TEXT_ENTRY.test(entry.name)) continue;
    const data = entryBytes(bytes, entry, budget);
    if (!data) continue;
    // Markup removed so tag and attribute names are not searched as text,
    // but link targets are kept.
    const text = decoder
      .decode(data)
      .replace(/(?:href|Target)="([^"]*)"/g, " $1 ")
      .replace(/<[^>]+>/g, " ");
    parts.push(text);
    size += text.length;
  }
  return withText("zip", true, null, parts.join("\n"));
}
