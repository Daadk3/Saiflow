/**
 * Excel .xlsx as a deliverable.
 *
 * Fixtures are built here. A passing workbook is a real ZIP with the OOXML
 * parts. Macro and legacy spreadsheets are the same builder with the part
 * that makes them ineligible. No provider is called and no production file
 * is read.
 *
 * Primary files and additional deliverables are the same object scan: both
 * are uploaded through productFile and scanned by resolveContentPolicy /
 * structuralVerdict. The extra-file table does not have its own type list.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

import { resolveContentPolicy, structuralVerdict, providerRestrictToExtensions, type PolicyVerdict } from "../lib/scan/policy.ts";
import { extractFileFacts } from "../lib/file-facts.ts";
import { computeReviewChecks } from "../lib/review-checklist.ts";
import { xlsxContentDisposition, xlsxDownloadName, XLSX_DOWNLOAD_TYPE } from "../lib/xlsx-download.ts";
import { XLSX_CONTENT_TYPE } from "../lib/scan/xlsx.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const reasonOf = (verdict: PolicyVerdict) => (verdict.outcome === "ALLOW" ? "" : verdict.reason);

const TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1"/></sheets></workbook>`;

const SHEET = `<?xml version="1.0"?><worksheet><sheetData><row><c><v>12</v></c></row></sheetData></worksheet>`;

function makeZip(files: { name: string; data: string; method?: 0 | 8; encrypted?: boolean }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const plain = enc.encode(file.data);
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

function workbook(extra: { name: string; data: string }[] = [], types = TYPES): Uint8Array {
  return makeZip([
    { name: "[Content_Types].xml", data: types },
    { name: "xl/workbook.xml", data: WORKBOOK },
    { name: "xl/worksheets/sheet1.xml", data: SHEET },
    ...extra,
  ]);
}

const MACRO_TYPES = TYPES.replace(
  "spreadsheetml.sheet.main+xml",
  "spreadsheetml.sheet.macroEnabled.main+xml"
);

describe("a macro-free xlsx is a deliverable", () => {
  const book = workbook();

  test("the bytes pass as a primary file and as an additional file (same scan)", () => {
    const policy = resolveContentPolicy(book);
    assert.ok(policy);
    assert.equal(policy.kind, "xlsx");
    assert.deepEqual(structuralVerdict(book, policy), { outcome: "ALLOW" });
    assert.ok(providerRestrictToExtensions(policy).includes(".xml"));
    assert.ok(providerRestrictToExtensions(policy).includes(".xlsx"));
    const page = read("../app/dashboard/shop/[slug]/add-product/page.tsx");
    const create = read("../lib/products/create-product.ts");
    assert.ok(page.includes('endpoint="productFile"'));
    assert.ok(create.includes("resolveExtraDeliverables"));
  });

  test("a deflated workbook passes the same check", () => {
    const book = makeZip([
      { name: "[Content_Types].xml", data: TYPES, method: 8 },
      { name: "xl/workbook.xml", data: WORKBOOK, method: 8 },
      { name: "xl/worksheets/sheet1.xml", data: SHEET, method: 8 },
    ]);
    const policy = resolveContentPolicy(book);
    assert.equal(policy?.kind, "xlsx");
    assert.deepEqual(structuralVerdict(book, policy!), { outcome: "ALLOW" });
  });

  test("the same workbook is accepted as a ZIP member", () => {
    const zipBytes = makeZipBytes([
      { name: "readme.pdf", data: new TextEncoder().encode("%PDF-1.4 synthetic") },
      { name: "books/prices.xlsx", data: book },
    ]);
    const policy = resolveContentPolicy(zipBytes);
    assert.equal(policy?.kind, "zip");
    assert.deepEqual(structuralVerdict(zipBytes, policy!), { outcome: "ALLOW" });
    assert.ok(providerRestrictToExtensions(policy!).includes(".xlsx"));
  });

  test("a Drive link in a sheet is a review warning, not a scan rejection", () => {
    const linked = workbook([
      {
        name: "xl/sharedStrings.xml",
        data: `<sst><si><t>Buyer copy of the sheet is at https://drive.google.com/file/d/abc/view and the rest of this cell is padding text.</t></si></sst>`,
      },
    ]);
    const policy = resolveContentPolicy(linked);
    assert.equal(structuralVerdict(linked, policy!).outcome, "ALLOW");
    const facts = extractFileFacts(linked);
    assert.ok(facts.contact.includes("url"));
    const checks = computeReviewChecks({
      name: "Prices",
      description: "A workbook",
      fileKey: "k",
      fileScanStatus: "SAFE",
      fileScanKey: "k",
      facts,
    });
    assert.equal(checks.points[6].state, "warn");
  });
});

describe("macro and legacy spreadsheets stay blocked", () => {
  test("vbaProject.bin is rejected", () => {
    const book = workbook([{ name: "xl/vbaProject.bin", data: "not really vba" }]);
    const policy = resolveContentPolicy(book);
    assert.equal(policy?.kind, "xlsx");
    assert.deepEqual(structuralVerdict(book, policy!), { outcome: "REJECT", reason: "macros" });
  });

  test("a macroEnabled content type is rejected even without the bin", () => {
    const book = workbook([], MACRO_TYPES);
    const policy = resolveContentPolicy(book);
    assert.equal(reasonOf(structuralVerdict(book, policy!)), "macros");
  });

  test("an xlsm renamed to xlsx is rejected from the bytes", () => {
    const renamed = workbook([{ name: "xl/vbaProject.bin", data: "macro" }], MACRO_TYPES);
    assert.equal(reasonOf(structuralVerdict(renamed, resolveContentPolicy(renamed)!)), "macros");
  });

  test("ActiveX and OLE embeddings are rejected", () => {
    const active = workbook([{ name: "xl/activeX/activeX1.xml", data: "<activeX/>" }]);
    const ole = workbook([{ name: "xl/embeddings/oleObject1.bin", data: "ole" }]);
    assert.equal(reasonOf(structuralVerdict(active, resolveContentPolicy(active)!)), "macros");
    assert.equal(reasonOf(structuralVerdict(ole, resolveContentPolicy(ole)!)), "macros");
  });

  test("printer settings bin does not make a workbook a macro file", () => {
    const book = workbook([{ name: "xl/printerSettings/printerSettings1.bin", data: "printer" }]);
    assert.equal(structuralVerdict(book, resolveContentPolicy(book)!).outcome, "ALLOW");
  });

  test(".xls, .xlsb and .xlsm are rejected inside a ZIP and as the file itself", () => {
    const zip = makeZipBytes([
      { name: "old.xls", data: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]) },
      { name: "binary.xlsb", data: new Uint8Array([1, 2, 3, 4]) },
      { name: "macro.xlsm", data: new Uint8Array([1, 2, 3, 4]) },
    ]);
    const policy = resolveContentPolicy(zip);
    assert.equal(policy?.kind, "zip");
    assert.equal(structuralVerdict(zip, policy!).outcome, "REJECT");

    const xlsb = makeZip([
      { name: "[Content_Types].xml", data: TYPES.replace("sheet.main+xml", "sheet.binary.macroEnabled.main") },
      { name: "xl/workbook.bin", data: "binary workbook" },
    ]);
    assert.equal(resolveContentPolicy(xlsb)?.kind, "xlsx");
    assert.equal(reasonOf(structuralVerdict(xlsb, resolveContentPolicy(xlsb)!)), "format_mismatch");

    const ole = new Uint8Array(16);
    ole.set([0xd0, 0xcf, 0x11, 0xe0]);
    assert.equal(resolveContentPolicy(ole), null);
  });

  test("a corrupt or non-ZIP body is not a workbook", () => {
    const junk = new TextEncoder().encode("this is not a zip, whatever it was named");
    assert.equal(resolveContentPolicy(junk), null);
    const broken = workbook();
    broken[broken.length - 1] = 0xff;
    broken[broken.length - 2] = 0xff;
    const policy = resolveContentPolicy(broken);
    assert.equal(policy?.kind, "zip");
    assert.equal(structuralVerdict(broken, policy!).outcome, "REJECT");
  });

  test("an encrypted workbook is rejected", () => {
    const book = makeZip([
      { name: "[Content_Types].xml", data: TYPES, encrypted: true },
      { name: "xl/workbook.xml", data: WORKBOOK },
    ]);
    assert.equal(reasonOf(structuralVerdict(book, resolveContentPolicy(book)!)), "archive_encrypted");
  });
});

describe("buyer download names an xlsx", () => {
  test("the spreadsheet type and filename are used only for an .xlsx name", () => {
    assert.equal(XLSX_DOWNLOAD_TYPE, XLSX_CONTENT_TYPE);
    assert.equal(xlsxDownloadName("prices.xlsx"), "prices.xlsx");
    assert.equal(xlsxDownloadName("folder/prices.XLSX"), "prices.XLSX");
    assert.equal(xlsxDownloadName("prices.xlsm"), null);
    assert.equal(xlsxDownloadName("prices.pdf"), null);
    const disposition = xlsxContentDisposition("أسعار.xlsx");
    assert.match(disposition, /attachment;/);
    assert.match(disposition, /filename\*=UTF-8''/);
    const route = read("../app/api/download/[productId]/route.ts");
    assert.ok(route.includes("XLSX_DOWNLOAD_TYPE"));
    assert.ok(route.includes("xlsxContentDisposition"));
  });
});

function makeZipBytes(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    locals.push(local);
    cds.push(cd);
    offset += local.length;
  }
  const cdBytes = concat(cds);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, cdBytes, eocd]);
}
