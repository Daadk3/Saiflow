/**
 * Ordinary books must pass the PDF structural scan.
 *
 * The previous scanner searched the raw file for `/JS`, `/JavaScript`,
 * `/AA`, `/OpenAction`, `/Launch`, `/EmbeddedFile` and `/RichMedia`. Print →
 * Save as PDF writes `/OpenAction` only to fit the page, and the same byte
 * sequences show up inside fonts and compressed page streams. Those files
 * were marked UNSAFE. Real JavaScript, Launch, embedded files, XFA,
 * RichMedia and SubmitForm stay rejected.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

import { findPdfActiveContent } from "../lib/scan/sniff.ts";
import { resolveContentPolicy, structuralVerdict } from "../lib/scan/policy.ts";

/**
 * The rule this replaced. Kept here so a fixture can show which code the
 * byte search would have written. Not used by the product.
 */
function legacyPdfReasons(file: Uint8Array): string[] {
  const text = Buffer.from(file).toString("latin1");
  const markers: [string, string][] = [
    ["/JavaScript", "pdf_javascript"],
    ["/JS", "pdf_javascript"],
    ["/Launch", "pdf_launch_action"],
    ["/OpenAction", "pdf_open_action"],
    ["/AA", "pdf_additional_actions"],
    ["/EmbeddedFile", "pdf_embedded_file"],
    ["/RichMedia", "pdf_rich_media"],
  ];
  const found: string[] = [];
  for (const [token, reason] of markers) {
    const pattern = new RegExp(`${token.replace("/", "\\/")}(?![A-Za-z0-9])`);
    if (pattern.test(text) && !found.includes(reason)) found.push(reason);
  }
  return found;
}

function streamObject(extraDict: string, data: Buffer): Buffer {
  const header = Buffer.from(`<< ${extraDict} /Length ${data.length} >>\nstream\n`);
  return Buffer.concat([header, data, Buffer.from("\nendstream")]);
}

function assemble(objects: Buffer[]): Uint8Array {
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let cursor = chunks[0].length;
  const offsets: number[] = [];
  for (const body of objects) {
    offsets.push(cursor);
    chunks.push(body);
    cursor += body.length;
  }
  const xrefAt = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(chunks));
}

function obj(n: number, body: Buffer | string): Buffer {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  return Buffer.concat([Buffer.from(`${n} 0 obj\n`), bytes, Buffer.from("\nendobj\n")]);
}

/** Tokens that used to be rejected wherever they appeared in the file. */
const DECOY = Buffer.from(
  "font-program /JS (app.alert(1)) /JavaScript /AA /OpenAction /Launch /EmbeddedFile /RichMedia /XFA /SubmitForm /URI (https://example.test) "
);

function ordinaryBook(): Uint8Array {
  const pageText = deflateSync(
    Buffer.from("BT /F1 12 Tf (Porter) Tj ET " + DECOY.toString("latin1"))
  );
  return assemble([
    obj(1, "<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R /OpenAction << /S /GoTo /D [3 0 R /Fit] >> >>"),
    obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    obj(3, "<< /Type /Page /Parent 2 0 R /Contents 5 0 R /Annots [6 0 R] /Resources << /Font << /F1 7 0 R >> >> >>"),
    obj(4, "<< /Type /Outlines /First 8 0 R /Count 1 >>"),
    obj(5, streamObject("/Filter /FlateDecode", pageText)),
    obj(6, "<< /Type /Annot /Subtype /Link /Rect [0 0 10 10] /A << /S /URI /URI (https://example.test/book) >> /Border [0 0 0] >>"),
    obj(7, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /FontDescriptor 9 0 R >>"),
    obj(8, "<< /Title (Chapter) /Parent 4 0 R /Dest [3 0 R /XYZ null null null] >>"),
    obj(9, "<< /Type /FontDescriptor /FontName /Times-Roman /FontFile2 10 0 R >>"),
    obj(10, streamObject("", DECOY)),
  ]);
}

function verdict(file: Uint8Array): string | null {
  const policy = resolveContentPolicy(file);
  assert.equal(policy?.kind, "pdf");
  const result = structuralVerdict(file, policy!);
  return result.outcome === "ALLOW" ? null : result.reason;
}

describe("ordinary books are not active content", () => {
  test("a Print → Save as PDF book with links, a bookmark, a font and a fit OpenAction passes", () => {
    const file = ordinaryBook();
    const text = Buffer.from(file).toString("latin1");
    // The old byte search hits the font program and the real OpenAction.
    assert.equal(legacyPdfReasons(file)[0], "pdf_javascript");
    assert.ok(legacyPdfReasons(file).includes("pdf_open_action"));
    assert.ok(text.includes("/URI (https://example.test/book)"));
    assert.deepEqual(findPdfActiveContent(file), []);
    assert.equal(verdict(file), null);
  });

  test("an OpenAction that is only a destination array passes", () => {
    const file = assemble([
      obj(1, "<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>"),
      obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
      obj(3, "<< /Type /Page /Parent 2 0 R >>"),
    ]);
    assert.deepEqual(legacyPdfReasons(file), ["pdf_open_action"]);
    assert.deepEqual(findPdfActiveContent(file), []);
  });

  test("FitH, XYZ and a named destination are navigation", () => {
    for (const action of [
      "<< /S /GoTo /D [3 0 R /FitH 0] >>",
      "<< /S /GoTo /D [3 0 R /XYZ null null 1] >>",
      "/Chapter1",
      "[3 0 R /FitB]",
      "<< /S /Named /N /FitWidth >>",
      "<< /S /GoToR /F (chapter.pdf) /D [0 /Fit] >>",
    ]) {
      const file = assemble([
        obj(1, `<< /Type /Catalog /OpenAction ${action} >>`),
      ]);
      assert.deepEqual(findPdfActiveContent(file), [], action);
    }
  });

  test("a link annotation and a bookmark that only jump to a page pass", () => {
    const file = assemble([
      obj(1, "<< /Type /Catalog /Outlines 2 0 R >>"),
      obj(2, "<< /Type /Outlines /First 3 0 R /Count 1 >>"),
      obj(3, "<< /Title (Start) /Parent 2 0 R /A << /S /GoTo /D [0 /Fit] >> >>"),
      obj(4, "<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://example.test) >> >>"),
    ]);
    assert.deepEqual(findPdfActiveContent(file), []);
  });

  test("additional actions that only navigate or open a link pass", () => {
    const file = assemble([
      obj(1, "<< /Type /Catalog /AA << /WC << /S /URI /URI (https://example.test) >> /O << /S /GoTo /D [0 /Fit] >> >> >>"),
    ]);
    assert.deepEqual(legacyPdfReasons(file), ["pdf_additional_actions"]);
    assert.deepEqual(findPdfActiveContent(file), []);
  });

  test("an indirect stream length still hides decoy bytes", () => {
    const file = assemble([
      obj(1, "<< /Type /Catalog /OpenAction [2 0 R /Fit] >>"),
      obj(2, "<< /Type /Page /Contents 3 0 R >>"),
      obj(3, Buffer.concat([
        Buffer.from("<< /Length 4 0 R >>\nstream\n"),
        DECOY,
        Buffer.from("\nendstream"),
      ])),
      obj(4, String(DECOY.length)),
    ]);
    assert.ok(legacyPdfReasons(file).includes("pdf_javascript"));
    assert.deepEqual(findPdfActiveContent(file), []);
  });

  test("a font name and a glyph name that merely contain those letters pass", () => {
    const file = assemble([
      obj(1, "<< /Type /Font /BaseFont /JSABCDEF+NotoNaskh /Encoding << /Differences [ 32 /A /JS /AArdvark ] >> >>"),
      obj(2, "<< /JSONData 1 0 R /AArdvark 2 /Producer (saved with /JS in the name) >>"),
    ]);
    assert.ok(legacyPdfReasons(file).includes("pdf_javascript"));
    assert.deepEqual(findPdfActiveContent(file), []);
  });

  test("a hex-escaped JavaScript name is still JavaScript", () => {
    const file = assemble([
      obj(1, "<< /S /#4A#61#76#61#53#63#72#69#70#74 /#4A#53 (app.alert\\(1\\)) >>"),
    ]);
    assert.deepEqual(findPdfActiveContent(file), ["pdf_javascript"]);
  });
});

describe("real PDF threats stay blocked", () => {
  const rejects = (body: string, reason: string) => {
    const file = assemble([obj(1, body)]);
    assert.equal(verdict(file), reason, body);
  };

  test("Word's zoom script is still JavaScript", () => {
    rejects(
      "<< /Type /Catalog /OpenAction << /S /JavaScript /JS (this.zoomType = zoomtype.fitW;) >> >>",
      "pdf_javascript"
    );
    rejects("<< /S /JS (app.alert\\(1\\)) >>", "pdf_javascript");
  });

  test("Launch, embedded files, XFA, RichMedia and SubmitForm", () => {
    rejects("<< /S /Launch /F (calc.exe) >>", "pdf_launch_action");
    rejects("<< /Type /EmbeddedFile /Length 1 >>", "pdf_embedded_file");
    rejects("<< /Type /Filespec /EF << /F 2 0 R >> >>", "pdf_embedded_file");
    rejects("<< /XFA 2 0 R >>", "pdf_xfa");
    rejects("<< /Subtype /RichMedia /RichMediaSettings << >> >>", "pdf_rich_media");
    rejects("<< /S /RichMediaExecute >>", "pdf_rich_media");
    rejects("<< /S /SubmitForm /F (https://example.test/collect) >>", "pdf_submit_form");
  });

  test("JavaScript inside an additional action is javascript, not a generic active-PDF code", () => {
    rejects(
      "<< /AA << /O << /S /JavaScript /JS (app.alert\\(1\\)) >> >> >>",
      "pdf_javascript"
    );
  });

  test("an OpenAction that is not navigation keeps pdf_open_action", () => {
    rejects("<< /OpenAction << /S /URI /URI (https://example.test) >> >>", "pdf_open_action");
    rejects("<< /OpenAction << /S /Named /N /Print >> >>", "pdf_open_action");
    rejects("<< /OpenAction 9 0 R >>", "pdf_open_action");
  });

  test("an unresolved additional-action dictionary stays blocked", () => {
    rejects("<< /AA 9 0 R >>", "pdf_additional_actions");
  });

  test("JavaScript stored in a Flate object stream is still found", () => {
    const payload = Buffer.from("5 0 << /S /JavaScript /JS (app.alert\\(1\\)) >>");
    const compressed = deflateSync(payload);
    const file = assemble([
      obj(1, "<< /Type /Catalog /OpenAction 5 0 R >>"),
      obj(2, streamObject(`/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode`, compressed)),
    ]);
    assert.equal(verdict(file), "pdf_javascript");
  });

  test("a decoy font does not hide a real Launch action", () => {
    const file = assemble([
      obj(1, "<< /Type /Catalog /OpenAction << /S /GoTo /D [0 /Fit] >> /Names << /JavaScript 3 0 R >> >>"),
      obj(2, streamObject("", DECOY)),
      obj(3, "<< /Names [ (x) 4 0 R ] >>"),
      obj(4, "<< /S /Launch /F (calc.exe) >>"),
    ]);
    const reasons = findPdfActiveContent(file);
    assert.equal(reasons[0], "pdf_javascript");
    assert.ok(reasons.includes("pdf_launch_action"));
  });
});
