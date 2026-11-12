/**
 * Active content in a PDF, read from the object graph.
 *
 * The previous check searched the raw file for `/JS`, `/JavaScript`, `/AA`,
 * `/OpenAction`, `/Launch`, `/EmbeddedFile` and `/RichMedia`. Those bytes
 * also occur inside compressed page streams and embedded fonts, and
 * Print → Save as PDF writes `/OpenAction` only to open on a page. A book
 * was then marked UNSAFE.
 *
 * This walk tokenises PDF syntax and skips stream bodies. Names match in
 * full, so `/JS` is not `/JSON`. An OpenAction that only selects a page or
 * a zoom is navigation. JavaScript, Launch, embedded files, XFA, RichMedia
 * and SubmitForm are still rejected. Flate object streams are inflated,
 * because the objects inside them are syntax, not page content.
 */

import { inflateSync } from "node:zlib";

const ORDER = [
  "pdf_javascript",
  "pdf_launch_action",
  "pdf_submit_form",
  "pdf_embedded_file",
  "pdf_xfa",
  "pdf_rich_media",
  "pdf_open_action",
  "pdf_additional_actions",
  "pdf_unreadable",
] as const;

const FIT_NAMES = new Set(["Fit", "FitH", "FitV", "FitR", "FitB", "FitBH", "FitBV", "XYZ"]);

/** Named actions that only change which page is shown, or how it fits. */
const NAMED_NAV = new Set([
  "NextPage",
  "PrevPage",
  "FirstPage",
  "LastPage",
  "GoBack",
  "GoForward",
  "FitPage",
  "FitWidth",
  "FitVisible",
  "ActualSize",
  "FullScreen",
]);

const MAX_DICTS = 100_000;
const MAX_OBJSTM_OBJECTS = 10_000;
const MAX_INFLATE = 8 * 1024 * 1024;

type PdfName = { t: "name"; v: string };
type PdfRef = { t: "ref"; n: number; g: number };
type PdfNum = { t: "num"; v: number };
type PdfStr = { t: "str" };
type PdfArray = { t: "array"; items: PdfValue[] };
type PdfDict = { t: "dict"; map: Map<string, PdfValue> };
type PdfBool = { t: "bool" };
type PdfNull = { t: "null" };
type PdfValue = PdfName | PdfRef | PdfNum | PdfStr | PdfArray | PdfDict | PdfBool | PdfNull;

type ActionKind =
  | "safe"
  | "javascript"
  | "launch"
  | "submit"
  | "richmedia"
  | "other"
  | "missing";

const isWs = (c: number): boolean =>
  c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;

const isDelim = (c: number): boolean =>
  c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e ||
  c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d ||
  c === 0x2f || c === 0x25;

const isRegular = (c: number | undefined): boolean =>
  c !== undefined && !isWs(c) && !isDelim(c);

const isHex = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

const latin1 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
};

const ascii = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

function indexOfBytes(bytes: Uint8Array, needle: Uint8Array, from: number): number {
  const last = bytes.length - needle.length;
  for (let i = from; i <= last; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (bytes[i + k] !== needle[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function boundedIndex(bytes: Uint8Array, marker: Uint8Array, from: number, end: number): number {
  let pos = from;
  while (pos < end) {
    const at = indexOfBytes(bytes.subarray(0, end), marker, pos);
    if (at < 0) return -1;
    const beforeOk = at === 0 || !isRegular(bytes[at - 1]);
    const after = at + marker.length;
    const afterOk = after >= end || !isRegular(bytes[after]);
    if (beforeOk && afterOk) return at;
    pos = at + 1;
  }
  return -1;
}

/**
 * A length object written as `N G obj <integer> endobj`. Used when `/Length`
 * is an indirect reference that this pass has not reached yet.
 */
function findBareInteger(bytes: Uint8Array, n: number, g: number): number | null {
  const marker = ascii(`${n} ${g} obj`);
  const endobj = ascii("endobj");
  let from = 0;
  while (from < bytes.length) {
    const at = boundedIndex(bytes, marker, from, bytes.length);
    if (at < 0) return null;
    let i = at + marker.length;
    while (i < bytes.length && isWs(bytes[i])) i++;
    const numStart = i;
    if (bytes[i] === 0x2b || bytes[i] === 0x2d) i++;
    const digitStart = i;
    while (i < bytes.length && bytes[i] >= 0x30 && bytes[i] <= 0x39) i++;
    if (i === digitStart) {
      from = at + 1;
      continue;
    }
    const value = Number(latin1(bytes.subarray(numStart, i)));
    while (i < bytes.length && isWs(bytes[i])) i++;
    if (
      boundedIndex(bytes, endobj, i, Math.min(bytes.length, i + endobj.length)) === i &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= bytes.length
    ) {
      return value;
    }
    from = at + 1;
  }
  return null;
}

function findEndstream(bytes: Uint8Array, from: number, end: number): number {
  const needle = ascii("endstream");
  return boundedIndex(bytes, needle, from, end);
}

class Parser {
  i = 0;
  bytes: Uint8Array;
  end: number;
  depth = 0;
  objStmDepth = 0;
  objects = new Map<string, PdfValue>();
  dicts: PdfDict[] = [];
  lengthCache = new Map<string, number | null>();
  aborted = false;

  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
  }

  parseFile(): void {
    let guard = 0;
    const limit = this.end + 8;
    while (this.i < this.end && guard++ < limit && this.dicts.length < MAX_DICTS) {
      const before = this.i;
      this.skipWsAndComments();
      if (this.i >= this.end) break;

      const kw = this.peekKeyword();
      if (kw === "xref") {
        this.skipXref();
      } else if (kw === "trailer") {
        this.i += "trailer".length;
        this.skipWsAndComments();
        if (this.peek("<<")) this.absorb(this.parseDict());
      } else if (kw === "startxref") {
        this.i += "startxref".length;
        this.skipWsAndComments();
        if (this.startsNumber()) this.readNumber();
      } else if (kw === "endobj" || kw === "endstream") {
        this.i += kw.length;
      } else if (this.peek("<<")) {
        const dict = this.parseDict();
        this.absorb(dict);
        this.maybeStream(dict);
      } else if (this.startsNumber()) {
        this.parseObjectOrSkipNumber();
      } else {
        this.i++;
      }

      if (this.i === before) this.i++;
    }
    if (this.dicts.length >= MAX_DICTS) this.aborted = true;
  }

  parseObjectOrSkipNumber(): void {
    const mark = this.i;
    const n = this.readNumber();
    this.skipWsAndComments();
    if (this.startsNumber()) {
      const g = this.readNumber();
      this.skipWsAndComments();
      if (this.peekKeyword() === "obj") {
        this.i += 3;
        this.skipWsAndComments();
        const value = this.parseValue();
        if (value && Number.isInteger(n) && Number.isInteger(g)) {
          this.objects.set(`${n} ${g}`, value);
          this.absorb(value);
          if (value.t === "dict") this.maybeStream(value);
        }
        return;
      }
    }
    this.i = mark;
    if (this.startsNumber()) this.readNumber();
    else this.i++;
  }

  absorb(value: PdfValue | null): void {
    if (!value || this.dicts.length >= MAX_DICTS) return;
    if (value.t === "dict") {
      this.dicts.push(value);
      for (const child of value.map.values()) this.absorb(child);
    } else if (value.t === "array") {
      for (const child of value.items) this.absorb(child);
    }
  }

  maybeStream(dict: PdfDict): void {
    this.skipWsAndComments();
    if (this.peekKeyword() !== "stream") return;
    this.i += "stream".length;
    if (this.bytes[this.i] === 0x0d) {
      this.i++;
      if (this.bytes[this.i] === 0x0a) this.i++;
    } else if (this.bytes[this.i] === 0x0a) {
      this.i++;
    }

    const start = this.i;
    const len = this.streamLength(dict);
    let data: Uint8Array | null = null;
    if (len !== null && start + len <= this.end) {
      this.i = start + len;
      data = this.bytes.subarray(start, start + len);
    } else {
      const at = findEndstream(this.bytes, start, this.end);
      if (at < 0) {
        this.i = this.end;
        return;
      }
      data = this.bytes.subarray(start, at);
      this.i = at;
    }
    if (data && this.isObjStm(dict)) this.parseObjStm(dict, data);
  }

  streamLength(dict: PdfDict): number | null {
    const value = dict.map.get("Length");
    if (!value) return null;
    if (value.t === "num" && Number.isInteger(value.v) && value.v >= 0) return value.v;
    if (value.t === "ref") return this.lookupLength(value.n, value.g);
    return null;
  }

  lookupLength(n: number, g: number): number | null {
    const key = `${n} ${g}`;
    if (this.lengthCache.has(key)) return this.lengthCache.get(key) ?? null;
    const parsed = this.objects.get(key);
    const fromObject =
      parsed?.t === "num" && Number.isInteger(parsed.v) && parsed.v >= 0 ? parsed.v : null;
    const found = fromObject ?? findBareInteger(this.bytes, n, g);
    this.lengthCache.set(key, found);
    return found;
  }

  isObjStm(dict: PdfDict): boolean {
    const type = dict.map.get("Type");
    return type?.t === "name" && type.v === "ObjStm";
  }

  parseObjStm(dict: PdfDict, data: Uint8Array): void {
    if (this.objStmDepth > 0) return;
    if (!flateOrStored(dict.map.get("Filter"))) return;
    const parms = dict.map.get("DecodeParms");
    if (parms && parms.t !== "null") return;

    let decoded: Uint8Array = data;
    if (dict.map.has("Filter")) {
      try {
        const inflated = inflateSync(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        if (inflated.byteLength > MAX_INFLATE) return;
        decoded = inflated;
      } catch {
        return;
      }
    }

    const count = integer(dict.map.get("N"));
    const first = integer(dict.map.get("First"));
    if (
      count === null || first === null ||
      count < 1 || count > MAX_OBJSTM_OBJECTS ||
      first < 0 || first > decoded.length
    ) {
      return;
    }

    const header = latin1(decoded.subarray(0, first)).trim().split(/\s+/);
    if (header.length < count * 2) return;

    this.objStmDepth++;
    try {
      for (let k = 0; k < count; k++) {
        const objNum = Number(header[k * 2]);
        const offset = Number(header[k * 2 + 1]);
        if (!Number.isInteger(objNum) || !Number.isInteger(offset)) continue;
        const start = first + offset;
        if (start < 0 || start > decoded.length) continue;
        const nextOffset = k + 1 < count ? Number(header[(k + 1) * 2 + 1]) : NaN;
        const stop = Number.isInteger(nextOffset) ? first + nextOffset : decoded.length;
        if (stop < start || stop > decoded.length) continue;
        const inner = new Parser(decoded, stop);
        inner.i = start;
        const value = inner.parseValue();
        if (!value) continue;
        this.objects.set(`${objNum} 0`, value);
        this.absorb(value);
      }
    } finally {
      this.objStmDepth--;
    }
  }

  parseValue(): PdfValue | null {
    this.skipWsAndComments();
    if (this.i >= this.end || this.depth > 40) return null;
    if (this.peek("<<")) return this.parseDict();
    if (this.peek("[")) return this.parseArray();
    if (this.peek("(")) {
      this.skipLiteral();
      return { t: "str" };
    }
    if (this.peek("<")) {
      this.skipHex();
      return { t: "str" };
    }
    if (this.peek("/")) return { t: "name", v: this.readName() };
    const kw = this.peekKeyword();
    if (kw === "true" || kw === "false") {
      this.i += kw.length;
      return { t: "bool" };
    }
    if (kw === "null") {
      this.i += 4;
      return { t: "null" };
    }
    if (!this.startsNumber()) return null;

    const n = this.readNumber();
    const after = this.i;
    this.skipWsAndComments();
    if (this.startsNumber()) {
      const g = this.readNumber();
      this.skipWsAndComments();
      if (this.peekKeyword() === "R" && Number.isInteger(n) && Number.isInteger(g)) {
        this.i += 1;
        return { t: "ref", n, g };
      }
      // The second number belongs to the next value. Keep the first.
      this.i = after;
    }
    return { t: "num", v: n };
  }

  parseDict(): PdfDict {
    this.i += 2;
    const map = new Map<string, PdfValue>();
    this.depth++;
    let guard = 0;
    while (this.i < this.end && guard++ < 8192 && map.size < 4096) {
      this.skipWsAndComments();
      if (this.peek(">>")) {
        this.i += 2;
        break;
      }
      if (!this.peek("/")) {
        if (this.i >= this.end) break;
        this.i++;
        continue;
      }
      const key = this.readName();
      const value = this.parseValue();
      if (key && value) map.set(key, value);
    }
    this.depth--;
    return { t: "dict", map };
  }

  parseArray(): PdfArray {
    this.i += 1;
    const items: PdfValue[] = [];
    this.depth++;
    let guard = 0;
    while (this.i < this.end && guard++ < 100_000 && items.length < 100_000) {
      this.skipWsAndComments();
      if (this.peek("]")) {
        this.i += 1;
        break;
      }
      const value = this.parseValue();
      if (value) items.push(value);
      else if (this.i < this.end) this.i++;
      else break;
    }
    this.depth--;
    return { t: "array", items };
  }

  skipXref(): void {
    this.i += 4;
    let sections = 0;
    while (this.i < this.end && sections++ < 10_000) {
      this.skipWsAndComments();
      if (this.peekKeyword() === "trailer") return;
      if (!this.startsNumber()) return;
      this.readNumber();
      this.skipWsAndComments();
      if (!this.startsNumber()) return;
      const count = this.readNumber();
      if (!Number.isInteger(count) || count < 0 || count > 5_000_000) return;
      for (let k = 0; k < count; k++) {
        this.skipWsAndComments();
        if (!this.startsNumber()) return;
        this.readNumber();
        this.skipWsAndComments();
        if (!this.startsNumber()) return;
        this.readNumber();
        this.skipWsAndComments();
        const flag = this.peekKeyword();
        if (flag !== "n" && flag !== "f") return;
        this.i += 1;
      }
    }
  }

  skipWsAndComments(): void {
    while (this.i < this.end) {
      const c = this.bytes[this.i];
      if (isWs(c)) {
        this.i++;
        continue;
      }
      if (c === 0x25) {
        this.i++;
        while (this.i < this.end && this.bytes[this.i] !== 0x0a && this.bytes[this.i] !== 0x0d) this.i++;
        continue;
      }
      break;
    }
  }

  skipLiteral(): void {
    this.i++;
    let depth = 1;
    while (this.i < this.end && depth > 0) {
      const c = this.bytes[this.i++];
      if (c === 0x5c) {
        if (this.i < this.end) this.i++;
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) depth--;
    }
  }

  skipHex(): void {
    this.i++;
    while (this.i < this.end && this.bytes[this.i] !== 0x3e) this.i++;
    if (this.i < this.end) this.i++;
  }

  readName(): string {
    if (this.i < this.end && this.bytes[this.i] === 0x2f) this.i++;
    let out = "";
    while (this.i < this.end && out.length < 128) {
      const c = this.bytes[this.i];
      if (isWs(c) || isDelim(c)) break;
      this.i++;
      if (
        c === 0x23 &&
        this.i + 1 < this.end &&
        isHex(this.bytes[this.i]) &&
        isHex(this.bytes[this.i + 1])
      ) {
        const hex = String.fromCharCode(this.bytes[this.i], this.bytes[this.i + 1]);
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.i += 2;
      } else {
        out += String.fromCharCode(c);
      }
    }
    return out;
  }

  readNumber(): number {
    const start = this.i;
    if (this.bytes[this.i] === 0x2b || this.bytes[this.i] === 0x2d) this.i++;
    while (this.i < this.end && this.bytes[this.i] >= 0x30 && this.bytes[this.i] <= 0x39) this.i++;
    if (this.bytes[this.i] === 0x2e) {
      this.i++;
      while (this.i < this.end && this.bytes[this.i] >= 0x30 && this.bytes[this.i] <= 0x39) this.i++;
    }
    const n = Number(latin1(this.bytes.subarray(start, this.i)));
    return Number.isFinite(n) ? n : 0;
  }

  startsNumber(): boolean {
    if (this.i >= this.end) return false;
    const c = this.bytes[this.i];
    if (c >= 0x30 && c <= 0x39) return true;
    if (c === 0x2b || c === 0x2d || c === 0x2e) {
      const n = this.bytes[this.i + 1];
      return n !== undefined && n >= 0x30 && n <= 0x39;
    }
    return false;
  }

  peek(text: string): boolean {
    if (this.i + text.length > this.end) return false;
    for (let k = 0; k < text.length; k++) {
      if (this.bytes[this.i + k] !== text.charCodeAt(k)) return false;
    }
    return true;
  }

  peekKeyword(): string | null {
    if (this.i >= this.end || !isRegular(this.bytes[this.i])) return null;
    let j = this.i;
    let s = "";
    while (j < this.end && isRegular(this.bytes[j])) {
      if (s.length >= 24) return null;
      s += String.fromCharCode(this.bytes[j]);
      j++;
    }
    return s;
  }
}

function integer(value: PdfValue | undefined): number | null {
  if (value?.t === "num" && Number.isInteger(value.v) && value.v >= 0) return value.v;
  return null;
}

function flateOrStored(filter: PdfValue | undefined): boolean {
  if (!filter) return true;
  if (filter.t === "name") return filter.v === "FlateDecode";
  if (filter.t === "array") {
    return filter.items.length === 1 && filter.items[0].t === "name" && filter.items[0].v === "FlateDecode";
  }
  return false;
}

function nameOf(value: PdfValue | undefined | null): string | null {
  return value?.t === "name" ? value.v : null;
}

function isDestination(value: PdfValue): boolean {
  if (value.t === "name" || value.t === "str") return true;
  if (value.t !== "array" || value.items.length === 0) return false;
  const names = value.items.filter((item): item is PdfName => item.t === "name").map((item) => item.v);
  if (names.length === 0) {
    return value.items.every((item) => item.t === "ref" || item.t === "num" || item.t === "null");
  }
  return names.every((item) => FIT_NAMES.has(item));
}

function resolve(value: PdfValue | undefined, objects: Map<string, PdfValue>, depth = 0): PdfValue | null {
  if (!value || depth > 8) return null;
  if (value.t !== "ref") return value;
  const next = objects.get(`${value.n} ${value.g}`);
  if (!next) return null;
  if (next.t === "ref") return resolve(next, objects, depth + 1);
  return next;
}

function hasRichMedia(dict: PdfDict): boolean {
  if (nameOf(dict.map.get("Subtype")) === "RichMedia") return true;
  if (nameOf(dict.map.get("S")) === "RichMediaExecute") return true;
  for (const key of dict.map.keys()) {
    if (key.startsWith("RichMedia")) return true;
  }
  return false;
}

/**
 * Page-only OpenAction. A URI here would fire on open, which is not the
 * "fit the page" action Print → Save as PDF writes. Link annotations are
 * a different dictionary and stay allowed.
 */
function isPageNavigation(value: PdfValue | undefined, objects: Map<string, PdfValue>): boolean {
  const resolved = resolve(value, objects);
  if (!resolved) return false;
  if (isDestination(resolved)) return true;
  if (resolved.t !== "dict") return false;
  const s = nameOf(resolved.map.get("S"));
  if (s === "GoTo" || s === "GoToR") return true;
  if (s === "Named") {
    const named = nameOf(resolve(resolved.map.get("N"), objects));
    return named !== null && NAMED_NAV.has(named);
  }
  return false;
}

function actionKind(value: PdfValue | undefined, objects: Map<string, PdfValue>): ActionKind {
  const resolved = resolve(value, objects);
  if (!resolved) return "missing";
  if (isDestination(resolved)) return "safe";
  if (resolved.t !== "dict") return "other";
  const s = nameOf(resolved.map.get("S"));
  if (resolved.map.has("JS") || resolved.map.has("JavaScript") || s === "JavaScript" || s === "JS") return "javascript";
  if (resolved.map.has("Launch") || s === "Launch") return "launch";
  if (s === "SubmitForm") return "submit";
  if (s === "RichMediaExecute" || hasRichMedia(resolved)) return "richmedia";
  if (s === "GoTo" || s === "GoToR" || s === "URI" || s === "Thread") return "safe";
  if (s === "Named") {
    const named = nameOf(resolve(resolved.map.get("N"), objects));
    return named !== null && NAMED_NAV.has(named) ? "safe" : "other";
  }
  return "other";
}

const SPECIFIC: ReadonlySet<ActionKind> = new Set(["javascript", "launch", "submit", "richmedia"]);

function threatsIn(dicts: PdfDict[], objects: Map<string, PdfValue>): Set<string> {
  const reasons = new Set<string>();
  for (const dict of dicts) {
    const s = nameOf(dict.map.get("S"));
    if (dict.map.has("JS") || dict.map.has("JavaScript") || s === "JavaScript" || s === "JS") {
      reasons.add("pdf_javascript");
    }
    if (dict.map.has("Launch") || s === "Launch") reasons.add("pdf_launch_action");
    if (s === "SubmitForm") reasons.add("pdf_submit_form");
    const type = nameOf(dict.map.get("Type"));
    if (
      type === "EmbeddedFile" ||
      dict.map.has("EmbeddedFile") ||
      dict.map.has("EmbeddedFiles") ||
      dict.map.has("EF")
    ) {
      reasons.add("pdf_embedded_file");
    }
    if (dict.map.has("XFA")) reasons.add("pdf_xfa");
    if (hasRichMedia(dict)) reasons.add("pdf_rich_media");

    if (dict.map.has("OpenAction")) {
      const kind = actionKind(dict.map.get("OpenAction"), objects);
      // A JavaScript or Launch OpenAction already has its own code. Anything
      // else that does not merely open a page is still an automatic action.
      if (!SPECIFIC.has(kind) && !isPageNavigation(dict.map.get("OpenAction"), objects)) {
        reasons.add("pdf_open_action");
      }
    }
    if (dict.map.has("AA")) {
      const aa = resolve(dict.map.get("AA"), objects);
      if (!aa || aa.t !== "dict") {
        reasons.add("pdf_additional_actions");
      } else {
        for (const action of aa.map.values()) {
          const kind = actionKind(action, objects);
          if (!SPECIFIC.has(kind) && kind !== "safe") reasons.add("pdf_additional_actions");
        }
      }
    }
  }
  return reasons;
}

/**
 * Reason codes for active PDF content, in a stable order.
 *
 * Empty means the structural PDF rules found nothing to reject. The provider
 * scan still runs.
 */
export function findPdfActiveContent(bytes: Uint8Array): string[] {
  try {
    const parser = new Parser(bytes);
    parser.parseFile();
    const reasons = threatsIn(parser.dicts, parser.objects);
    if (parser.aborted) reasons.add("pdf_unreadable");
    return ORDER.filter((reason) => reasons.has(reason));
  } catch {
    // A parser failure must not become a pass. structuralVerdict treats any
    // returned code as UNSAFE, and the seller is told this code rather than
    // a generic "active content" sentence.
    return ["pdf_unreadable"];
  }
}
