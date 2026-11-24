/**
 * Word .docx and plain text .txt as deliverables.
 *
 * A passing document is a real ZIP with the OOXML Word parts. Macro documents
 * and renamed binaries are the same bytes with the part that makes them
 * ineligible. Text is accepted only when the bytes are UTF-8 or UTF-16 with a
 * BOM and contain no binary. No provider is called.
 *
 * Primary files, additional deliverables, and ZIP members share this scan.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import {
  ORDINARY_ZIP_MEMBER_EXTENSIONS,
  formatMatchesPolicy,
  providerRestrictToExtensions,
  resolveContentPolicy,
  structuralVerdict,
  type PolicyVerdict,
} from "../lib/scan/policy.ts";
import { DOCX_CONTENT_TYPE, DOCX_MEMBER_EXTENSIONS } from "../lib/scan/docx.ts";
import { sniffFormat } from "../lib/scan/sniff.ts";
import { docxContentDisposition, docxDownloadName, DOCX_DOWNLOAD_TYPE } from "../lib/docx-download.ts";
import { txtContentDisposition, txtDownloadName, TXT_DOWNLOAD_TYPE } from "../lib/txt-download.ts";
import { PRODUCT_FILE_CONFIG } from "../lib/upload-config.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const reasonOf = (verdict: PolicyVerdict) => (verdict.outcome === "ALLOW" ? "" : verdict.reason);

const TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>مرحبا</w:t></w:r></w:p></w:body></w:document>`;

const MACRO_TYPES = TYPES.replace(
  "wordprocessingml.document.main+xml",
  "wordprocessingml.document.macroEnabled.main+xml"
);

function makeZip(files: { name: string; data: string | Uint8Array; method?: 0 | 8; encrypted?: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const plain = typeof file.data === "string" ? enc.encode(file.data) : file.data;
    const method = file.method ?? 0;
    const payload = method === 8 ? deflateRawSync(plain) : plain;
    const local = new Uint8Array(30 + name.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(6, file.encrypted ? 1 : 0, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, plain.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, file.encrypted ? 1 : 0, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, plain.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    locals.push(local);
    cds.push(cd);
    offset += local.length;
  }
  const cdStart = offset;
  const cdBytes = concat(cds);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, cdStart, true);
  return concat([...locals, cdBytes, eocd]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function document(extra: { name: string; data: string }[] = [], types = TYPES): Uint8Array {
  return makeZip([
    { name: "[Content_Types].xml", data: types },
    { name: "word/document.xml", data: DOCUMENT },
    ...extra,
  ]);
}

describe("a macro-free docx is a deliverable", () => {
  const doc = document();

  test("the bytes pass as a primary file", () => {
    const policy = resolveContentPolicy(doc);
    assert.ok(policy);
    assert.equal(policy.kind, "docx");
    assert.deepEqual(policy.restrictToExtensions, [".docx"]);
    assert.equal(policy.allowHtml, false);
    assert.deepEqual(structuralVerdict(doc, policy), { outcome: "ALLOW" });
    const sent = providerRestrictToExtensions(policy);
    assert.ok(sent.includes(".docx"));
    assert.ok(sent.includes(".xml"));
    assert.ok(sent.includes(".rels"));
    assert.ok(!sent.includes(".svg"));
    assert.ok(!sent.includes(".exe"));
    assert.ok(!sent.includes(".js"));
    assert.equal(formatMatchesPolicy(".docx", policy), true);
    assert.equal(formatMatchesPolicy(".zip", policy), true);
    assert.equal(formatMatchesPolicy(".docm", policy), false);
    assert.equal(formatMatchesPolicy(".txt", policy), false);
  });

  test("a deflated document passes the same check", () => {
    const packed = makeZip([
      { name: "[Content_Types].xml", data: TYPES, method: 8 },
      { name: "word/document.xml", data: DOCUMENT, method: 8 },
    ]);
    const policy = resolveContentPolicy(packed);
    assert.equal(policy?.kind, "docx");
    assert.deepEqual(structuralVerdict(packed, policy!), { outcome: "ALLOW" });
  });

  test("the same document is accepted inside a ZIP with PDFs and a text file", () => {
    const zip = makeZip([
      { name: "guide-ar.pdf", data: "%PDF-1.4 synthetic" },
      { name: "guide-en.pdf", data: "%PDF-1.4 synthetic" },
      { name: "readme.txt", data: "خطوات الاستخدام. Plain text, no script." },
      { name: "letter.docx", data: doc },
    ]);
    const policy = resolveContentPolicy(zip);
    assert.equal(policy?.kind, "zip");
    assert.deepEqual(structuralVerdict(zip, policy!), { outcome: "ALLOW" });
    const sent = providerRestrictToExtensions(policy!);
    assert.ok(sent.includes(".zip"));
    assert.ok(sent.includes(".pdf"));
    assert.ok(sent.includes(".txt"));
    assert.ok(sent.includes(".docx"));
    assert.equal(formatMatchesPolicy(".zip", policy!), true);
    assert.equal(formatMatchesPolicy(".docx", policy!), false);
  });
});

describe("macro Word files and fake docx files stay blocked", () => {
  test("vbaProject.bin inside a docx is rejected", () => {
    const doc = document([{ name: "word/vbaProject.bin", data: "not really vba" }]);
    const policy = resolveContentPolicy(doc);
    assert.equal(policy?.kind, "docx");
    assert.deepEqual(structuralVerdict(doc, policy!), { outcome: "REJECT", reason: "macros" });
  });

  test("a macroEnabled content type is rejected even without the bin", () => {
    const doc = document([], MACRO_TYPES);
    assert.equal(reasonOf(structuralVerdict(doc, resolveContentPolicy(doc)!)), "macros");
  });

  test("a docm renamed to docx is rejected from the bytes", () => {
    const renamed = document([{ name: "word/vbaProject.bin", data: "macro" }], MACRO_TYPES);
    assert.equal(reasonOf(structuralVerdict(renamed, resolveContentPolicy(renamed)!)), "macros");
  });

  test(".docm and .doc inside a ZIP are rejected", () => {
    const macro = makeZip([{ name: "letter.docm", data: "macro package" }, { name: "notes.txt", data: "hi" }]);
    assert.equal(reasonOf(structuralVerdict(macro, resolveContentPolicy(macro)!)), "macros");
    const legacy = makeZip([{ name: "letter.doc", data: "ole" }, { name: "notes.txt", data: "hi" }]);
    assert.equal(reasonOf(structuralVerdict(legacy, resolveContentPolicy(legacy)!)), "format_mismatch");
  });

  test("a macro docx inside a ZIP is rejected", () => {
    const inner = document([{ name: "word/vbaProject.bin", data: "macro" }]);
    const zip = makeZip([{ name: "letter.docx", data: inner }, { name: "notes.txt", data: "hello" }]);
    assert.equal(reasonOf(structuralVerdict(zip, resolveContentPolicy(zip)!)), "macros");
  });

  test("ActiveX and OLE embeddings are rejected", () => {
    const active = document([{ name: "word/activeX/activeX1.xml", data: "<activeX/>" }]);
    const ole = document([{ name: "word/embeddings/oleObject1.bin", data: "ole" }]);
    assert.equal(reasonOf(structuralVerdict(active, resolveContentPolicy(active)!)), "macros");
    assert.equal(reasonOf(structuralVerdict(ole, resolveContentPolicy(ole)!)), "macros");
  });

  test("a renamed executable or other binary is not a document", () => {
    const exe = new Uint8Array(64);
    exe.set([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    assert.equal(sniffFormat(exe), "unknown");
    assert.equal(resolveContentPolicy(exe), null);
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
    assert.equal(resolveContentPolicy(junk), null);
    const notWord = makeZip([{ name: "readme.txt", data: "just a zip" }]);
    assert.equal(resolveContentPolicy(notWord)?.kind, "zip");
    assert.notEqual(resolveContentPolicy(notWord)?.kind, "docx");
  });

  test("a script or nested archive packed inside a docx is rejected", () => {
    const script = document([{ name: "word/setup.ps1", data: "Write-Host hi" }]);
    const nested = document([{ name: "word/extra.zip", data: "PK" }]);
    assert.equal(reasonOf(structuralVerdict(script, resolveContentPolicy(script)!)), "archive_script");
    assert.equal(reasonOf(structuralVerdict(nested, resolveContentPolicy(nested)!)), "archive_nested");
  });
});

describe("plain text is a deliverable only when it is text", () => {
  test("UTF-8, including Arabic and a short note, passes", () => {
    const note = new TextEncoder().encode("دليل مختصر.\nHello.\n");
    const policy = resolveContentPolicy(note);
    assert.equal(sniffFormat(note), "text");
    assert.equal(policy?.kind, "txt");
    assert.deepEqual(policy?.restrictToExtensions, [".txt"]);
    assert.equal(policy?.allowHtml, false);
    assert.deepEqual(structuralVerdict(note, policy!), { outcome: "ALLOW" });
    assert.equal(formatMatchesPolicy(".txt", policy!), true);
    assert.equal(formatMatchesPolicy(".docx", policy!), false);
    assert.equal(formatMatchesPolicy(".html", policy!), false);
    const hello = new TextEncoder().encode("Hi");
    assert.equal(resolveContentPolicy(hello)?.kind, "txt");
    assert.equal(structuralVerdict(hello, resolveContentPolicy(hello)!).outcome, "ALLOW");
  });

  test("UTF-8 with a BOM and UTF-16 with a BOM pass", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("note\n")]);
    assert.equal(structuralVerdict(utf8, resolveContentPolicy(utf8)!).outcome, "ALLOW");
    const utf16 = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00, 0x0a, 0x00]);
    assert.equal(sniffFormat(utf16), "text");
    assert.equal(structuralVerdict(utf16, resolveContentPolicy(utf16)!).outcome, "ALLOW");
  });

  test("binary content, a NUL, and a non-UTF-8 byte are rejected", () => {
    const nul = new Uint8Array([...new TextEncoder().encode("hello"), 0x00, ...new TextEncoder().encode("world")]);
    assert.equal(resolveContentPolicy(nul), null);
    const control = new TextEncoder().encode("hello\u0001world");
    assert.equal(resolveContentPolicy(control), null);
    const latin = new Uint8Array([0xc1, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b]);
    assert.equal(resolveContentPolicy(latin), null);
  });

  test("HTML, SVG, a shebang and PostScript are not plain text", () => {
    for (const body of [
      "<!DOCTYPE html><html><body>Hi</body></html>",
      "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
      "#!/bin/sh\necho hi\n",
      "<?php echo 1;\n",
      "%!PS-Adobe-3.0\n%%EOF\n",
    ]) {
      assert.equal(resolveContentPolicy(new TextEncoder().encode(body)), null, body.slice(0, 12));
    }
  });

  test("a binary .txt inside a ZIP is rejected and a real one is kept", () => {
    const bad = makeZip([
      { name: "notes.txt", data: new Uint8Array([0x4d, 0x5a, 0x00, 0x01, 0x02, 0xff]) },
      { name: "guide.pdf", data: "%PDF-1.4" },
    ]);
    assert.equal(reasonOf(structuralVerdict(bad, resolveContentPolicy(bad)!)), "format_mismatch");
    const good = makeZip([
      { name: "notes.txt", data: "سطر واحد.\n" },
      { name: "guide.pdf", data: "%PDF-1.4" },
    ]);
    assert.equal(structuralVerdict(good, resolveContentPolicy(good)!).outcome, "ALLOW");
  });
});

describe("nothing else was opened", () => {
  test("scripts, executables, Illustrator and EPS stay off the allowlists", () => {
    for (const ext of [".py", ".js", ".sh", ".exe", ".ai", ".eps", ".docm", ".html", ".svg"]) {
      assert.ok(!(ORDINARY_ZIP_MEMBER_EXTENSIONS as readonly string[]).includes(ext), ext);
      assert.ok(!(DOCX_MEMBER_EXTENSIONS as readonly string[]).includes(ext), ext);
    }
    const keys = Object.keys(PRODUCT_FILE_CONFIG);
    assert.ok(!keys.includes("text"));
    assert.ok(!keys.includes("application/postscript"));
    assert.ok(!keys.includes("application/msword"));
    assert.ok(!keys.includes("application/vnd.ms-word.document.macroEnabled.12"));
    const zip = makeZip([
      { name: "art.ai", data: "%PDF-1.4 not really" },
      { name: "notes.txt", data: "hi" },
    ]);
    assert.equal(reasonOf(structuralVerdict(zip, resolveContentPolicy(zip)!)), "format_mismatch");
    const eps = makeZip([{ name: "art.eps", data: "%!PS-Adobe" }]);
    assert.equal(reasonOf(structuralVerdict(eps, resolveContentPolicy(eps)!)), "format_mismatch");
    const script = makeZip([{ name: "build.py", data: "print(1)\n" }]);
    assert.equal(reasonOf(structuralVerdict(script, resolveContentPolicy(script)!)), "archive_script");
  });

  test("buyer download names a docx or a txt and not the other formats", () => {
    assert.equal(DOCX_DOWNLOAD_TYPE, DOCX_CONTENT_TYPE);
    assert.equal(docxDownloadName("letter.docx"), "letter.docx");
    assert.equal(docxDownloadName("folder/Letter.DOCX"), "Letter.DOCX");
    assert.equal(docxDownloadName("letter.docm"), null);
    assert.equal(docxDownloadName("notes.txt"), null);
    assert.match(docxContentDisposition("خطاب.docx"), /attachment;/);
    assert.equal(txtDownloadName("notes.txt"), "notes.txt");
    assert.equal(txtDownloadName("folder/Notes.TXT"), "Notes.TXT");
    assert.equal(txtDownloadName("letter.docx"), null);
    assert.equal(TXT_DOWNLOAD_TYPE.startsWith("text/plain"), true);
    assert.match(txtContentDisposition("ملاحظات.txt"), /filename\*=UTF-8''/);
    const route = read("../app/api/download/[productId]/route.ts");
    assert.ok(route.includes("DOCX_DOWNLOAD_TYPE"));
    assert.ok(route.includes("TXT_DOWNLOAD_TYPE"));
    assert.ok(route.includes("XLSX_DOWNLOAD_TYPE"));
  });

  test("the seller-facing lists name Word and plain text in both languages", () => {
    const en = JSON.parse(read("../messages/en.json"));
    const ar = JSON.parse(read("../messages/ar.json"));
    for (const text of [
      en.support.faq.items.uploadFiles.answer,
      en.hostedAccess.seller.typeFileHelp,
      en.fileSafety.failureUnsupportedFormat,
    ]) {
      assert.match(text, /\.docx/);
      assert.match(text, /\.txt|plain text/i);
    }
    for (const text of [
      ar.support.faq.items.uploadFiles.answer,
      ar.hostedAccess.seller.typeFileHelp,
      ar.fileSafety.failureUnsupportedFormat,
    ]) {
      assert.match(text, /\.docx/);
      assert.match(text, /\.txt|نص/);
    }
  });
});
