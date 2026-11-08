/**
 * Limited Illustrator support and the PostScript refusal (lib/scan/illustrator.ts,
 * lib/scan/sniff.ts, lib/scan/archive.ts, lib/scan/policy.ts).
 *
 * What is proved here, without a provider, a database or the network:
 *   - EPS, DOS-EPS and legacy Illustrator bytes are recognised as PostScript
 *     and have no policy, so they can never become SAFE; the refusal is named.
 *   - A PDF-compatible Illustrator file is a PDF by its bytes and gets the
 *     PDF policy unchanged. The Illustrator marker is a label, not a pass.
 *   - A `.ai`-named PDF is refused while the server switch is off, and the
 *     switch accepts exactly the value "on".
 *   - An ordinary ZIP with an AI/EPS/SVG/PSD member is refused structurally,
 *     before a provider call; EPUB keeps its SVG allowance.
 *   - The upload route config without the switch refuses `.ai` and `.eps`
 *     through UploadThing's real matcher; the switch config admits the
 *     shared `application/postscript` type and nothing else.
 *   - Seller and admin wording map the new reasons to "unsupported", never
 *     to a threat, and the public copy stops claiming formats it refuses.
 *
 * Nothing here renders, parses or executes PostScript. The fixtures are
 * synthetic byte strings shaped like the formats' headers.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { matchFileType } from "@uploadthing/shared";
import { Micro } from "effect";

import { isIllustratorPdf, sniffFormat } from "../lib/scan/sniff.ts";
import {
  isUnsupportedMemberEntry,
  UNSUPPORTED_MEMBER_EXTENSIONS,
  type ArchiveEntry,
} from "../lib/scan/archive.ts";
import {
  ORDINARY_ZIP_MEMBER_EXTENSIONS,
  RECOGNISED_FORMATS_FOR_TESTS,
  refusalReasonForBytes,
  resolveContentPolicy,
  structuralVerdict,
  verdictFromFindings,
} from "../lib/scan/policy.ts";
import {
  ILLUSTRATOR_SWITCH_ENV,
  illustratorUploadsEnabled,
  illustratorVerdict,
  isDeclaredIllustrator,
} from "../lib/scan/illustrator.ts";
import {
  ILLUSTRATOR_UPLOAD_TYPE,
  PRODUCT_FILE_CONFIG,
  PRODUCT_FILE_CONFIG_WITH_ILLUSTRATOR,
} from "../lib/upload-config.ts";
import { UPLOADER_ACCEPTED, PUBLICLY_SUPPORTED } from "../lib/scan/format-support.ts";
import { failureCategory, SELLER_FAILURES } from "../lib/seller-file-state.ts";
import { explainScanReason, SCAN_EXPLANATION_KEYS } from "../lib/scan-explanation.ts";
import { isFileTypeRefusal } from "../lib/upload-errors.ts";
import { extractFileFacts } from "../lib/file-facts.ts";
import type { ScanFindings } from "../lib/scan/provider.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const enc = new TextEncoder();
const ascii = (s: string) => enc.encode(s);
const bytes = (...parts: (Uint8Array | number[])[]) => new Uint8Array(parts.flatMap((p) => [...p]));
const zeros = (n: number) => new Array<number>(n).fill(0);

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** A modern Illustrator file: a PDF carrying the private editing stream. */
export const AI_PDF_COMPATIBLE = ascii(
  "%PDF-1.6\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "3 0 obj\n<< /AIMetaData 4 0 R /AIPrivateData1 5 0 R /AIPrivateData2 6 0 R /NumBlock 2 >>\nendobj\n" +
    "5 0 obj\n<< /Length 42 >>\nstream\n%AI12_CompressedDataxœ...synthetic...\nendstream\nendobj\n" +
    "trailer\n<< /Root 1 0 R >>\n%%EOF\n"
);

/** The same kind of file saved from Illustrator as .pdf with editing preserved. */
const ILLUSTRATOR_EXPORTED_PDF = AI_PDF_COMPATIBLE;

/** A plain PDF with no Illustrator data. */
const PLAIN_PDF = ascii("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");

/** A PDF-compatible AI that also carries JavaScript. */
const AI_PDF_WITH_JS = ascii(
  "%PDF-1.6\n1 0 obj\n<< /Type /Catalog /OpenAction 7 0 R /AIPrivateData1 5 0 R >>\nendobj\n" +
    "7 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n%%EOF\n"
);

/** Legacy Illustrator (before version 9): an EPS program. */
const AI_LEGACY_EPS = ascii(
  "%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n%%BoundingBox: 0 0 100 100\n" +
    "%%EndComments\n/m { moveto } bind def\n0 0 m 100 100 lineto stroke\n%%EOF\n"
);

/** An ordinary EPS. */
const EPS = ascii("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 200\n%%EndComments\nshowpage\n%%EOF\n");

/** A plain PostScript program. */
const PS = ascii("%!PS\n/Helvetica findfont 12 scalefont setfont 10 10 moveto (hi) show showpage\n");

/** DOS EPS binary header followed by a PostScript section. */
const DOS_EPS = bytes([0xc5, 0xd0, 0xd3, 0xc6], zeros(26), ascii("%!PS-Adobe-3.0 EPSF-3.0\n"));

/** A Windows executable renamed to .ai. */
const EXE = bytes(ascii("MZ"), zeros(62), ascii("PE\0\0"), zeros(20));

const findings = (over: Partial<ScanFindings> = {}): ScanFindings => ({
  clean: true,
  verifiedFileFormat: ".pdf",
  containsExecutable: false,
  containsInvalidFile: false,
  containsScript: false,
  containsPasswordProtectedFile: false,
  containsRestrictedFileFormat: false,
  containsMacros: false,
  containsXmlExternalEntities: false,
  containsInsecureDeserialization: false,
  containsHtml: false,
  containsUnsafeArchive: false,
  containsOleEmbeddedObject: false,
  virusNames: [],
  ...over,
});

/** Minimal stored ZIP writer: local headers, central directory, EOCD. */
export function makeZip(entries: { name: string; data: string }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const data = enc.encode(entry.data);
    const lh = new Uint8Array(30 + name.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint32(42, offset, true);
    cd.set(name, 46);
    locals.push(lh, data);
    cds.push(cd);
    offset += lh.length + data.length;
  }
  const cat = (parts: Uint8Array[]) => {
    const total = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const part of parts) {
      total.set(part, o);
      o += part.length;
    }
    return total;
  };
  const localPart = cat(locals);
  const cdPart = cat(cds);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdPart.length, true);
  edv.setUint32(16, localPart.length, true);
  return cat([localPart, cdPart, eocd]);
}

const entry = (name: string): ArchiveEntry => ({
  name,
  compressedSize: 10,
  uncompressedSize: 10,
  encrypted: false,
  symlink: false,
  method: 0,
  localHeaderOffset: 0,
});

/* ------------------------------------------------------------------ */
/* Byte-level identification                                           */
/* ------------------------------------------------------------------ */

describe("PostScript is recognised from its bytes and refused by name", () => {
  for (const [label, fixture] of [
    ["EPS", EPS],
    ["plain PostScript", PS],
    ["DOS EPS binary header", DOS_EPS],
    ["legacy Illustrator (EPS-based)", AI_LEGACY_EPS],
  ] as const) {
    test(`${label} sniffs as postscript, has no policy, and is named postscript_unsupported`, () => {
      assert.equal(sniffFormat(fixture), "postscript");
      assert.equal(resolveContentPolicy(fixture), null, "no policy means no path to SAFE");
      assert.equal(refusalReasonForBytes(fixture), "postscript_unsupported");
      assert.equal(isIllustratorPdf(fixture), false);
    });
  }

  test("unrecognised bytes keep the generic reason", () => {
    assert.equal(sniffFormat(EXE), "unknown");
    assert.equal(refusalReasonForBytes(EXE), "unrecognised_format");
  });

  test("the review-checklist facts say a PostScript file does not open", () => {
    const facts = extractFileFacts(EPS);
    assert.equal(facts.kind, "postscript");
    assert.equal(facts.opens, false);
  });

  test("'%!PS' is matched at offset 0 only, so a PDF mentioning it is still a PDF", () => {
    const pdf = ascii("%PDF-1.4\n% this document explains %!PS headers\n%%EOF\n");
    assert.equal(sniffFormat(pdf), "pdf");
  });
});

describe("a PDF-compatible Illustrator file is a PDF by its bytes", () => {
  test("it sniffs as pdf and carries the Illustrator marker", () => {
    assert.equal(sniffFormat(AI_PDF_COMPATIBLE), "pdf");
    assert.equal(isIllustratorPdf(AI_PDF_COMPATIBLE), true);
  });

  test("it receives the PDF policy, unchanged: container .pdf, no HTML, no scripts", () => {
    const policy = resolveContentPolicy(AI_PDF_COMPATIBLE);
    assert.ok(policy);
    assert.equal(policy.kind, "pdf");
    assert.deepEqual(policy.restrictToExtensions, [".pdf"]);
    assert.equal(policy.allowHtml, false);
    assert.notEqual(policy.allowScripts, true);
  });

  test("the structural PDF pass applies to it: active content is still rejected", () => {
    const clean = resolveContentPolicy(AI_PDF_COMPATIBLE)!;
    assert.deepEqual(structuralVerdict(AI_PDF_COMPATIBLE, clean), { outcome: "ALLOW" });
    const withJs = resolveContentPolicy(AI_PDF_WITH_JS)!;
    const verdict = structuralVerdict(AI_PDF_WITH_JS, withJs);
    assert.equal(verdict.outcome, "REJECT");
    assert.ok(["pdf_javascript", "pdf_open_action"].includes((verdict as { reason: string }).reason));
  });

  test("the marker is a label, not a pass: a plain PDF has no marker and the same policy", () => {
    assert.equal(isIllustratorPdf(PLAIN_PDF), false);
    assert.equal(resolveContentPolicy(PLAIN_PDF)?.kind, "pdf");
  });

  test("the provider must still verify it as .pdf; .ai or null never ALLOW", () => {
    const policy = resolveContentPolicy(AI_PDF_COMPATIBLE)!;
    assert.deepEqual(verdictFromFindings(findings({ verifiedFileFormat: ".pdf" }), policy), { outcome: "ALLOW" });
    assert.deepEqual(verdictFromFindings(findings({ verifiedFileFormat: ".ai" }), policy), {
      outcome: "REJECT",
      reason: "format_mismatch",
    });
    assert.deepEqual(verdictFromFindings(findings({ verifiedFileFormat: null }), policy), {
      outcome: "UNVERIFIABLE",
      reason: "format_not_verified",
    });
    assert.equal(RECOGNISED_FORMATS_FOR_TESTS.has(".ai"), false, ".ai is not a recognised verified format");
    assert.equal(RECOGNISED_FORMATS_FOR_TESTS.has(".eps"), false, ".eps is not a recognised verified format");
  });
});

/* ------------------------------------------------------------------ */
/* The switch                                                          */
/* ------------------------------------------------------------------ */

describe("the server switch", () => {
  test("accepts exactly 'on' and nothing else", () => {
    assert.equal(ILLUSTRATOR_SWITCH_ENV, "ILLUSTRATOR_PDF_UPLOADS");
    assert.equal(illustratorUploadsEnabled({}), false, "missing is off");
    for (const value of ["", " ", "true", "1", "yes", "ON", "On", "enabled", "off", "on-please"]) {
      assert.equal(illustratorUploadsEnabled({ ILLUSTRATOR_PDF_UPLOADS: value }), false, JSON.stringify(value));
    }
    assert.equal(illustratorUploadsEnabled({ ILLUSTRATOR_PDF_UPLOADS: "on" }), true);
    assert.equal(illustratorUploadsEnabled({ ILLUSTRATOR_PDF_UPLOADS: " on " }), true, "surrounding whitespace is tolerated");
  });

  test("the declared name is read case-insensitively and only at the end", () => {
    assert.equal(isDeclaredIllustrator("art.ai"), true);
    assert.equal(isDeclaredIllustrator("ART.AI"), true);
    assert.equal(isDeclaredIllustrator("art.ai.pdf"), false);
    assert.equal(isDeclaredIllustrator("art.pdf"), false);
    assert.equal(isDeclaredIllustrator("ai"), false);
  });

  test("off: a .ai-named PDF is refused as illustrator_disabled; on: it continues", () => {
    const policy = resolveContentPolicy(AI_PDF_COMPATIBLE)!;
    assert.deepEqual(illustratorVerdict("art.ai", policy, false), { outcome: "REJECT", reason: "illustrator_disabled" });
    assert.deepEqual(illustratorVerdict("art.ai", policy, true), { outcome: "ALLOW" });
  });

  test("the name can only refuse: a .pdf-named Illustrator PDF is unaffected either way", () => {
    const policy = resolveContentPolicy(ILLUSTRATOR_EXPORTED_PDF)!;
    assert.deepEqual(illustratorVerdict("art.pdf", policy, false), { outcome: "ALLOW" });
    assert.deepEqual(illustratorVerdict("art.pdf", policy, true), { outcome: "ALLOW" });
  });

  test("non-PDF policies are never touched by the switch", () => {
    const zip = resolveContentPolicy(makeZip([{ name: "a.md", data: "x" }]))!;
    assert.deepEqual(illustratorVerdict("kit.ai", zip, false), { outcome: "ALLOW" });
  });
});

/* ------------------------------------------------------------------ */
/* Inside a ZIP                                                        */
/* ------------------------------------------------------------------ */

describe("AI, EPS and other design source files inside an ordinary ZIP", () => {
  test("the member list names design formats and no accepted member type", () => {
    for (const ext of UNSUPPORTED_MEMBER_EXTENSIONS) {
      assert.ok(!(ORDINARY_ZIP_MEMBER_EXTENSIONS as readonly string[]).includes(ext), `${ext} must not also be an accepted member`);
    }
    for (const ext of [".ai", ".eps", ".ps", ".svg", ".psd"]) {
      assert.ok((UNSUPPORTED_MEMBER_EXTENSIONS as readonly string[]).includes(ext), ext);
    }
    assert.equal(isUnsupportedMemberEntry(entry("Folder/Artwork.AI")), true, "case-insensitive");
    assert.equal(isUnsupportedMemberEntry(entry("guide.pdf")), false);
    assert.equal(isUnsupportedMemberEntry(entry("main.js")), false, "scripts have their own, earlier rule");
  });

  for (const member of ["art.ai", "art.eps", "art.svg", "art.psd", "nested/Pattern.AI"]) {
    test(`a ZIP with ${member} is refused structurally as archive_member_unsupported`, () => {
      const zip = makeZip([
        { name: "README.md", data: "Buyer notes" },
        { name: member, data: "%!PS-Adobe-3.0 synthetic" },
      ]);
      const policy = resolveContentPolicy(zip);
      assert.ok(policy && policy.kind === "zip");
      assert.deepEqual(structuralVerdict(zip, policy), { outcome: "REJECT", reason: "archive_member_unsupported" });
    });
  }

  test("a ZIP of PDF, Markdown and PNG members is still allowed structurally (regression)", () => {
    const zip = makeZip([
      { name: "pattern.pdf", data: "%PDF-1.4 synthetic" },
      { name: "preview.png", data: "\u0089PNG synthetic" },
      { name: "README.md", data: "notes" },
    ]);
    const policy = resolveContentPolicy(zip)!;
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
  });

  test("a script member is still reported as a script, not as an unsupported design file", () => {
    const zip = makeZip([{ name: "run.py", data: "print(1)" }, { name: "art.ai", data: "x" }]);
    const policy = resolveContentPolicy(zip)!;
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "REJECT", reason: "archive_script" });
  });

  test("an EPUB keeps its SVG images: the member rule is ordinary-ZIP only", () => {
    const epub = makeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: "<container/>" },
      { name: "OEBPS/cover.svg", data: "<svg/>" },
    ]);
    const policy = resolveContentPolicy(epub);
    assert.ok(policy && policy.kind === "epub");
    assert.deepEqual(structuralVerdict(epub, policy), { outcome: "ALLOW" });
  });
});

/* ------------------------------------------------------------------ */
/* The upload route, through UploadThing's real matcher                */
/* ------------------------------------------------------------------ */

type Config = Record<string, { maxFileSize: string }>;
function resolveKey(config: Config, name: string, type: string): string | null {
  const effect = matchFileType({ name, size: 1, type }, Object.keys(config) as never) as unknown as Micro.Micro<
    string,
    unknown,
    never
  >;
  const exit = Micro.runSyncExit(effect);
  return Micro.exitIsSuccess(exit) ? exit.value : null;
}

describe("the upload route config", () => {
  const base = PRODUCT_FILE_CONFIG as unknown as Config;
  const withAi = PRODUCT_FILE_CONFIG_WITH_ILLUSTRATOR as unknown as Config;

  test("without the switch, .ai and .eps are refused whatever the browser declares", () => {
    for (const [name, type] of [
      ["art.ai", "application/postscript"],
      ["art.ai", "application/illustrator"],
      ["art.ai", ""],
      ["art.eps", "application/postscript"],
      ["art.eps", ""],
    ]) {
      assert.equal(resolveKey(base, name, type), null, `${name} [${type || "no type"}]`);
    }
    assert.equal(Object.hasOwn(base, ILLUSTRATOR_UPLOAD_TYPE), false);
    assert.equal((UPLOADER_ACCEPTED as readonly string[]).includes(ILLUSTRATOR_UPLOAD_TYPE), false);
  });

  test("with the switch, the shared PostScript type is admitted at 32MB, private, attachment", () => {
    assert.equal(resolveKey(withAi, "art.ai", "application/postscript"), ILLUSTRATOR_UPLOAD_TYPE);
    assert.equal(resolveKey(withAi, "art.ai", ""), ILLUSTRATOR_UPLOAD_TYPE, "extension fallback");
    // Unavoidable at this layer and documented: .eps shares the MIME type.
    // The scanner refuses it from the bytes (postscript_unsupported).
    assert.equal(resolveKey(withAi, "art.eps", ""), ILLUSTRATOR_UPLOAD_TYPE);
    const rule = withAi[ILLUSTRATOR_UPLOAD_TYPE] as { maxFileSize: string; acl?: string; contentDisposition?: string };
    assert.equal(rule.maxFileSize, "32MB");
    assert.equal(rule.acl, "private");
    assert.equal(rule.contentDisposition, "attachment");
  });

  test("the switch config adds exactly one type and nothing else", () => {
    const added = Object.keys(withAi).filter((k) => !Object.hasOwn(base, k));
    assert.deepEqual(added, [ILLUSTRATOR_UPLOAD_TYPE]);
    for (const [name, type] of [
      ["logo.svg", "image/svg+xml"],
      ["logo.svg", ""],
      ["index.html", "text/html"],
      ["setup.exe", "application/x-msdownload"],
      ["bundle.rar", ""],
      ["design.psd", "image/vnd.adobe.photoshop"],
      ["design.psd", ""],
    ]) {
      assert.equal(resolveKey(withAi, name, type), null, `${name} [${type || "no type"}]`);
    }
  });

  test("the router picks the switch config only when the switch is on (source)", () => {
    const core = read("../app/api/uploadthing/core.ts");
    assert.match(core, /productFile: f\(illustratorUploadsEnabled\(\) \? PRODUCT_FILE_CONFIG_WITH_ILLUSTRATOR : PRODUCT_FILE_CONFIG\)/);
  });

  test("the uploader's type refusal is recognised from UploadThing's own messages", () => {
    assert.equal(isFileTypeRefusal(new Error("File type application/postscript not allowed for art.ai")), true);
    assert.equal(isFileTypeRefusal(new Error("Could not determine type for art")), true);
    assert.equal(isFileTypeRefusal(new Error("Invalid file size: 200MB")), false);
    assert.equal(isFileTypeRefusal(new Error("Unauthorized")), false);
    assert.equal(isFileTypeRefusal(null), false);
  });
});

/* ------------------------------------------------------------------ */
/* What people are told                                                */
/* ------------------------------------------------------------------ */

describe("seller and admin wording for the new reasons", () => {
  test("every new reason is an 'unsupported' category, never a threat", () => {
    assert.equal(failureCategory("postscript_unsupported"), "unsupported_format");
    assert.equal(failureCategory("illustrator_disabled"), "unsupported_format");
    assert.equal(failureCategory("archive_member_unsupported"), "unsupported_member");
    assert.equal(failureCategory("archive_member_unsupported_terminal"), "unsupported_member");
    assert.ok(SELLER_FAILURES.includes("unsupported_member"));
    // Unchanged neighbours.
    assert.equal(failureCategory("archive_script"), "unsafe_content");
    assert.equal(failureCategory("archive_nested"), "unsafe_content");
    assert.equal(failureCategory("unrecognised_format"), "unsupported_format");
  });

  test("the admin explanation names an unsupported member and keeps PostScript under format", () => {
    assert.equal(explainScanReason("archive_member_unsupported"), "unsupported_member");
    assert.equal(explainScanReason("postscript_unsupported"), "format");
    assert.equal(explainScanReason("illustrator_disabled"), "format");
    assert.ok((SCAN_EXPLANATION_KEYS as readonly string[]).includes("unsupported_member"));
  });

  for (const lang of ["en", "ar"] as const) {
    const messages = JSON.parse(read(`../messages/${lang}.json`)) as Record<string, unknown>;
    const get = (path: string) => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages) as string;

    test(`${lang}: every seller failure category has a sentence, including the new one`, () => {
      for (const key of ["failureUnsupportedFormat", "failureUnsupportedMember"]) {
        assert.equal(typeof get(`fileSafety.${key}`), "string", key);
      }
      assert.equal(typeof get("admin.fileSafety.blockedBecause.unsupported_member"), "string");
      assert.equal(typeof get("dashboard.product.productFileZipHelp"), "string");
      assert.equal(typeof get("dashboard.product.fileTypeNotAccepted"), "string");
    });

    test(`${lang}: the unsupported-format and member sentences name AI and EPS and disclaim a threat`, () => {
      for (const key of ["fileSafety.failureUnsupportedFormat", "fileSafety.failureUnsupportedMember"]) {
        const s = get(key);
        assert.match(s, /AI/, key);
        assert.match(s, /EPS/, key);
        assert.match(s, /PDF/, key);
        assert.doesNotMatch(s, /malware|virus|فيروس|برمجية خبيثة/i, key);
      }
    });

    test(`${lang}: the FAQ and help copy state the ZIP member rule and stop claiming software`, () => {
      const faq = get("pricing.faq.a4");
      const help = get("support.faq.items.uploadFiles.answer");
      for (const s of [faq, help]) {
        assert.equal(typeof s, "string");
        assert.match(s, /ZIP/);
        assert.match(s, /Markdown/);
        assert.match(s, /CSV/);
        assert.match(s, /AI/);
        assert.match(s, /EPS/);
        assert.match(s, /PDF/);
        // The old copy sold "software, templates, and more" / "برامج، قوالب، وأكثر".
        // Executables are refused, so none of that may be claimed. (The Arabic
        // refusal clause legitimately says programs are refused inside a ZIP.)
        assert.doesNotMatch(s, /software|templates|قوالب|وأكثر/i, "no claim of software or templates as sellable types");
        assert.doesNotMatch(s, /If it's digital|إذا كان رقمي/i, "no blanket claim");
      }
    });
  }

  test("the public copy does not advertise AI as supported while the switch is unverified", () => {
    assert.deepEqual([...PUBLICLY_SUPPORTED], ["pdf"]);
    for (const lang of ["en", "ar"]) {
      const text = read(`../messages/${lang}.json`);
      // Every sentence that names the AI design format (always alongside EPS)
      // is a refusal. "AI" on its own is the listing assistant and is not
      // about file formats.
      for (const line of text.split("\n").filter((l) => /\bAI\b.*\bEPS\b/.test(l))) {
        assert.ok(
          /not accepted|refused|aren[’']t accepted|غير مقبول|تُرفض|doesn[’']t sell|does not sell|لا يُباع|can[’']t sell|ليس من الأنواع|No other archives|بلا أرشيفات/i.test(line),
          `${lang}: a line mentioning AI must be a refusal: ${line.trim().slice(0, 120)}`
        );
      }
    }
  });
});
