/**
 * The named local HTML app archive.
 *
 * A clinic workbench (or any other reviewed local HTML application) is a ZIP
 * the buyer downloads and opens on their own computer. SaiFlow never hosts it
 * and never executes it. This module is how that ZIP is told apart from every
 * other ZIP, including an EPUB.
 *
 * Identity is a stored root marker with exact bytes — the same discipline as
 * an EPUB's `mimetype` entry, and a different contract, so the two cannot be
 * substituted for each other. The product description is not consulted. A
 * plain ZIP that merely contains HTML stays a plain ZIP and keeps allowHtml
 * false.
 *
 * Browser JavaScript is permitted only as classic `.js` files referenced by
 * a local `<script src>`. Inline scripts, modules, remote scripts, and every
 * other script extension stay rejected. The allowance exists because a local
 * HTML application cannot behave as an application without it; it is not a
 * general script exception.
 */

import { inflateRawSync } from "node:zlib";
import { readStoredEntryBytes, type ArchiveEntry } from "./archive";

/** Root entry name. A copy in a subdirectory does not opt the archive in. */
export const LOCAL_HTML_APP_MARKER_NAME = "saiflow-local-html-app.json";

/**
 * Exact stored bytes. No BOM, no newline, no extra fields, no pretty print.
 * A near-miss is an invalid marker, which does not receive this policy.
 */
export const LOCAL_HTML_APP_MARKER_BODY =
  '{"saiflowArchiveType":"local-html-app","version":1}';

/** Extensions a reviewed local HTML app may contain. `.js` is the only script. */
export const LOCAL_HTML_APP_EXTENSIONS: readonly string[] = [
  ".html",
  ".htm",
  ".css",
  ".json",
  ".md",
  ".txt",
  ".js",
];

const ALLOWED_EXTENSIONS = new Set(LOCAL_HTML_APP_EXTENSIONS);

export const LOCAL_HTML_APP_LIMITS = {
  maxEntries: 200,
  maxJsFiles: 24,
  maxMemberBytes: 1_500_000,
  maxTotalBytes: 8_000_000,
} as const;

export type LocalHtmlMarker = "absent" | "valid" | "invalid";

/**
 * Whether this archive deliberately declares itself a local HTML app.
 *
 * `invalid` means the marker name is present but the contract is not met
 * (compressed, duplicated, wrong bytes). Callers must not treat that as a
 * plain absence: the archive asked for the type and did not earn it.
 */
export function localHtmlMarker(entries: ArchiveEntry[], bytes: Uint8Array): LocalHtmlMarker {
  const hits = entries.filter((entry) => entry.name === LOCAL_HTML_APP_MARKER_NAME);
  if (hits.length === 0) return "absent";
  if (hits.length !== 1) return "invalid";

  const data = readStoredEntryBytes(bytes, hits[0], LOCAL_HTML_APP_MARKER_BODY.length);
  if (!data || data.byteLength !== LOCAL_HTML_APP_MARKER_BODY.length) return "invalid";

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return "invalid";
  }
  return text === LOCAL_HTML_APP_MARKER_BODY ? "valid" : "invalid";
}

/** The final extension, so `app.mjs` is `.mjs` and not `.js`. */
export function fileExtension(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/** Classic `.js` only. `.mjs` and `.cjs` end in `js` and are still scripts. */
export function isPermittedBrowserScript(entry: ArchiveEntry): boolean {
  return fileExtension(entry.name) === ".js";
}

/**
 * Member-name rule for this archive type. Script extensions are decided by
 * the caller first, so `.py` stays `archive_script` rather than a generic
 * member rejection.
 */
export function localHtmlEntryRejection(entry: ArchiveEntry): string | null {
  if (isMacMetadata(entry.name)) return "archive_member_type";
  const parts = pathParts(entry.name);
  if (!parts) return "archive_member_type";
  if (entry.name.endsWith("/")) return null;
  if (!ALLOWED_EXTENSIONS.has(fileExtension(entry.name))) return "archive_member_type";
  return null;
}

/**
 * Read and check the text members. Returns a reject reason, or null when the
 * archive matches the local HTML app rules.
 *
 * Fail closed: a member we cannot read as UTF-8 is rejected, never skipped.
 * Compressed HTML is inflated, so deflate is not a way to hide a script tag.
 */
export function inspectLocalHtmlApp(bytes: Uint8Array, entries: ArchiveEntry[]): string | null {
  if (entries.length > LOCAL_HTML_APP_LIMITS.maxEntries) return "archive_member_limit";

  const files = entries.filter((entry) => !entry.name.endsWith("/"));
  const html = files.filter((entry) => {
    const ext = fileExtension(entry.name);
    return ext === ".html" || ext === ".htm";
  });
  if (html.length === 0) return "archive_not_html_app";

  const js = files.filter((entry) => fileExtension(entry.name) === ".js");
  if (js.length > LOCAL_HTML_APP_LIMITS.maxJsFiles) return "archive_script";

  const names = new Set(entries.map((entry) => entry.name));
  const budget = { used: 0 };

  for (const entry of files) {
    const data = readMember(bytes, entry, budget);
    if (!data) return "archive_member_unreadable";
    const text = asUtf8Text(data);
    if (text === null) return "archive_member_unreadable";

    const ext = fileExtension(entry.name);
    if (ext === ".html" || ext === ".htm") {
      if (htmlProblems(text, entry.name, names)) return "archive_active_html";
    } else if (ext === ".css") {
      if (cssProblems(text)) return "archive_active_html";
    } else if (ext === ".js") {
      if (jsProblems(text)) return "archive_script";
    }
  }

  return null;
}

function isMacMetadata(name: string): boolean {
  const parts = name.split("/");
  const base = parts[parts.length - 1] === "" ? parts[parts.length - 2] : parts[parts.length - 1];
  return parts[0] === "__MACOSX" || base === ".DS_Store";
}

function pathParts(name: string): string[] | null {
  if (!name || name.length > 240) return null;
  if (name.includes("\\") || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)) return null;
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  if (!trimmed || trimmed.startsWith("/")) return null;
  const parts = trimmed.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  return parts;
}

function readMember(
  bytes: Uint8Array,
  entry: ArchiveEntry,
  budget: { used: number }
): Uint8Array | null {
  if (entry.encrypted || entry.uncompressedSize > LOCAL_HTML_APP_LIMITS.maxMemberBytes) return null;
  if (budget.used >= LOCAL_HTML_APP_LIMITS.maxTotalBytes) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = entry.localHeaderOffset;
  if (base + 30 > bytes.byteLength) return null;
  const start = base + 30 + view.getUint16(base + 26, true) + view.getUint16(base + 28, true);
  const end = start + entry.compressedSize;
  if (start < 0 || end > bytes.byteLength) return null;
  const data = bytes.subarray(start, end);

  if (entry.method === 0) {
    if (data.byteLength !== entry.uncompressedSize) return null;
    if (budget.used + data.byteLength > LOCAL_HTML_APP_LIMITS.maxTotalBytes) return null;
    budget.used += data.byteLength;
    return data;
  }

  if (entry.method === 8) {
    const room = LOCAL_HTML_APP_LIMITS.maxTotalBytes - budget.used;
    try {
      const out = inflateRawSync(data, {
        maxOutputLength: Math.min(LOCAL_HTML_APP_LIMITS.maxMemberBytes, room),
      });
      if (out.byteLength !== entry.uncompressedSize) return null;
      if (budget.used + out.byteLength > LOCAL_HTML_APP_LIMITS.maxTotalBytes) return null;
      budget.used += out.byteLength;
      return out;
    } catch {
      return null;
    }
  }

  return null;
}

function asUtf8Text(data: Uint8Array): string | null {
  if (data.includes(0)) return null;
  if (data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xfe) return null;
  if (data.byteLength >= 2 && data[0] === 0xfe && data[1] === 0xff) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

function resolveRelative(fromName: string, ref: string): string | null {
  const raw = ref.trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("\\") || raw.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.includes("\\") || raw.includes("?") || raw.includes("#")) return null;

  const base = fromName.split("/");
  base.pop();
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (base.length === 0) return null;
      base.pop();
      continue;
    }
    base.push(part);
  }
  const path = base.join("/");
  return path.length > 0 ? path : null;
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? match[2] : null;
}

function htmlProblems(html: string, fromName: string, members: Set<string>): boolean {
  if (/javascript\s*:/i.test(html)) return true;
  if (/(?:^|[\s<])on[a-z]{3,}\s*=/i.test(html)) return true;
  if (/<(?:iframe|object|embed|applet|base)\b/i.test(html)) return true;
  if (/\bsrcdoc\s*=/i.test(html)) return true;
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh/i.test(html)) return true;

  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const link of links) {
    const rel = attr(link, "rel");
    const href = attr(link, "href");
    if (!rel || !/\bstylesheet\b/i.test(rel) || !href) return true;
    const resolved = resolveRelative(fromName, href);
    if (!resolved || fileExtension(resolved) !== ".css" || !members.has(resolved)) return true;
  }

  const opened = html.match(/<script\b/gi) ?? [];
  const tags = html.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  if (opened.length !== tags.length) return true;
  for (const tag of tags) {
    const match = tag.match(/^<script\b([^>]*)>\s*<\/script\s*>$/i);
    if (!match) return true;
    const src = match[1].match(/\bsrc\s*=\s*(["'])([^"']+)\1/i);
    if (!src) return true;
    const resolved = resolveRelative(fromName, src[2]);
    if (!resolved || fileExtension(resolved) !== ".js" || !members.has(resolved)) return true;
    const rest = match[1]
      .replace(/\bsrc\s*=\s*(["'])[^"']+\1/i, "")
      .replace(/\btype\s*=\s*(["'])text\/javascript\1/i, "")
      .replace(/\b(?:defer|async)\b/gi, "")
      .trim();
    if (rest.length > 0) return true;
  }
  return false;
}

function cssProblems(css: string): boolean {
  if (/javascript\s*:/i.test(css)) return true;
  if (/expression\s*\(/i.test(css)) return true;
  if (/(?:^|[;{}\s])behavior\s*:/i.test(css)) return true;
  if (/-moz-binding\s*:/i.test(css)) return true;
  if (/url\s*\([^)]*\.\./i.test(css)) return true;
  if (/url\s*\(\s*["']?\s*(?:https?:|\/\/|data:)/i.test(css)) return true;
  if (/@import\s+(?:url\s*\(\s*)?["']?\s*(?:https?:|\/\/)/i.test(css)) return true;
  return false;
}

function jsProblems(js: string): boolean {
  if (/^\uFEFF?\s*#!/.test(js)) return true;
  if (/\brequire\s*\(/.test(js)) return true;
  if (/\bimport\s*\(/.test(js)) return true;
  if (/\bimport\b/.test(js) || /\bexport\b/.test(js)) return true;
  if (/\bfrom\s*["']node:/.test(js)) return true;
  if (/\b(?:child_process|__dirname|__filename)\b/.test(js)) return true;
  if (/\bprocess\s*\.\s*(?:exit|env|binding)\b/.test(js)) return true;
  if (/\beval\s*\(/.test(js) || /\bnew\s+Function\s*\(/.test(js)) return true;
  if (/\bnew\s+(?:Shared)?Worker\s*\(/.test(js)) return true;
  if (/javascript\s*:/i.test(js)) return true;
  return false;
}
