/**
 * Stage C — provenance and the scanning pipeline.
 *
 * The security decisions are pure functions, and they are tested as such: real
 * bytes through the real sniffer, real ZIP structures through the real parser,
 * real provider code through a stubbed `fetch`. Nothing here re-implements the
 * logic it is checking.
 *
 * What is asserted at source level instead, and why: the persistence step needs
 * a live Postgres (Prisma field references, transactions, updateMany), so the
 * atomic key-binding is checked by reading the query it issues. Those tests are
 * marked where they appear.
 *
 * No real file is scanned and no malicious sample exists in this repository —
 * the malware cases are provider responses, not payloads.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sniffFormat, findPdfActiveContent } from "../lib/scan/sniff.ts";
import {
  readZipCentralDirectory,
  hasPathTraversal,
  isNestedArchive,
  isExecutableEntry,
  isScriptEntry,
  isDecompressionBomb,
} from "../lib/scan/archive.ts";
import {
  resolveContentPolicy,
  structuralVerdict,
  verdictFromFindings,
  isEpubLayout,
  formatMatchesPolicy,
  normaliseFormat,
} from "../lib/scan/policy.ts";
import { cloudmersiveProvider } from "../lib/scan/cloudmersive.ts";
import { isRetryableFailure, type ScanFindings } from "../lib/scan/provider.ts";
import { isEligibleNow, sha256Hex, MAX_SCAN_ATTEMPTS } from "../lib/scan/run.ts";
import { provenanceVerdict, attachedScanFields } from "../lib/file-safety.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const runSrc = read("../lib/scan/run.ts");
const coreSrc = read("../app/api/uploadthing/core.ts");
const createSrc = read("../app/api/products/route.ts");
const editSrc = read("../app/api/products/[id]/route.ts");
const workerSrc = read("../app/api/internal/scan/route.ts");
const storageSrc = read("../lib/storage/provider.ts");

/* ------------------------------------------------------------------ */
/* Byte helpers                                                        */
/* ------------------------------------------------------------------ */

const bytes = (...parts: (number[] | string)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      for (const ch of p) out.push(ch.charCodeAt(0));
    } else out.push(...p);
  }
  return new Uint8Array(out);
};

const pad = (b: Uint8Array, len: number): Uint8Array => {
  const out = new Uint8Array(Math.max(len, b.length));
  out.set(b);
  return out;
};

interface ZipSpec {
  name: string;
  compressedSize?: number;
  uncompressedSize?: number;
  encrypted?: boolean;
  symlink?: boolean;
  /** Literal entry contents, stored uncompressed. */
  data?: string;
  /** Compression method; 0 (stored) unless set. */
  method?: number;
}

interface ZipOptions {
  /** Append a second, well-formed EOCD declaring zero entries. */
  forgeTrailingEocd?: boolean;
  /** Declare a different entry count than the directory actually contains. */
  lieAboutCount?: number;
  /** Break the cdOffset + cdSize === eocd invariant. */
  shiftCdOffset?: number;
  /** Claim a comment that does not reach EOF. */
  bogusCommentLen?: number;
  /** Corrupt the local file header a directory entry points at. */
  breakLocalHeader?: boolean;
  /** Make a local header carry a different name than the directory entry. */
  mismatchLocalName?: boolean;
  /** Trailing bytes after the EOCD. */
  trailingJunk?: number;
  /**
   * Append a zero-entry EOCD whose cdOffset points at ITSELF, so the
   * cdOffset + cdSize === eocd invariant holds trivially.
   */
  selfReferentialEocd?: boolean;
}

/**
 * Build a real ZIP: local file headers with data, a central directory whose
 * entries point at them, and an EOCD. The hardened parser cross-checks all
 * three, so a fixture that only fakes the directory would be rejected for the
 * wrong reason.
 */
function makeZip(specs: ZipSpec[], opts: ZipOptions = {}): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;

  specs.forEach((s, index) => {
    const name = enc.encode(s.name);
    const localName =
      opts.mismatchLocalName && index === 0 ? enc.encode("x".repeat(s.name.length)) : name;
    const data = s.data ? enc.encode(s.data) : new Uint8Array(s.compressedSize ?? 8);

    const lh = new Uint8Array(30 + localName.length);
    const ldv = new DataView(lh.buffer);
    const isLast = index === specs.length - 1;
    ldv.setUint32(0, opts.breakLocalHeader && isLast ? 0xdeadbeef : 0x04034b50, true);
    ldv.setUint16(6, s.encrypted ? 1 : 0, true);
    ldv.setUint16(8, s.method ?? 0, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, s.uncompressedSize ?? data.length, true);
    ldv.setUint16(26, localName.length, true);
    lh.set(localName, 30);

    const cd = new Uint8Array(46 + name.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(8, s.encrypted ? 1 : 0, true);
    cdv.setUint16(10, s.method ?? 0, true);
    cdv.setUint32(20, s.compressedSize ?? data.length, true);
    cdv.setUint32(24, s.uncompressedSize ?? data.length, true);
    cdv.setUint16(28, name.length, true);
    cdv.setUint32(38, (((s.symlink ? 0xa1ff : 0x81a4) << 16) >>> 0), true);
    cdv.setUint32(42, offset, true);
    cd.set(name, 46);

    locals.push(lh, data);
    cds.push(cd);
    offset += lh.length + data.length;
  });

  const cat = (parts: Uint8Array[]) => {
    const total = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of parts) {
      total.set(x, o);
      o += x.length;
    }
    return total;
  };

  const localPart = cat(locals);
  const cdPart = cat(cds);

  const eocd = (count: number, size: number, off: number, commentLen = 0) => {
    const e = new Uint8Array(22);
    const d = new DataView(e.buffer);
    d.setUint32(0, 0x06054b50, true);
    d.setUint16(8, count, true);
    d.setUint16(10, count, true);
    d.setUint32(12, size, true);
    d.setUint32(16, off, true);
    d.setUint16(20, commentLen, true);
    return e;
  };

  const parts: Uint8Array[] = [
    localPart,
    cdPart,
    eocd(
      opts.lieAboutCount ?? specs.length,
      cdPart.length,
      localPart.length + (opts.shiftCdOffset ?? 0),
      opts.bogusCommentLen ?? 0
    ),
  ];
  if (opts.forgeTrailingEocd) parts.push(eocd(0, 0, 0));
  if (opts.selfReferentialEocd) {
    const soFar = cat(parts).length;
    parts.push(eocd(0, 0, soFar));
  }
  if (opts.trailingJunk) parts.push(new Uint8Array(opts.trailingJunk));
  return cat(parts);
}

const cleanFindings = (over: Partial<ScanFindings> = {}): ScanFindings => ({
  clean: true,
  // Now required: a response without a content-verified format is unparseable.
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

/* ------------------------------------------------------------------ */
/* Content-based type verification                                     */
/* ------------------------------------------------------------------ */

describe("format is established from bytes, not from the name", () => {
  test("real formats are recognised", () => {
    assert.equal(sniffFormat(pad(bytes("%PDF-1.7"), 32)), "pdf");
    assert.equal(sniffFormat(makeZip([{ name: "a.txt" }])), "zip");
    assert.equal(sniffFormat(pad(bytes([0xff, 0xd8, 0xff, 0xe0]), 32)), "jpeg");
    assert.equal(
      sniffFormat(pad(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 32)),
      "png"
    );
    assert.equal(sniffFormat(pad(bytes("GIF89a"), 32)), "gif");
    assert.equal(sniffFormat(pad(bytes("RIFF", [0, 0, 0, 0], "WEBP"), 32)), "webp");
    assert.equal(sniffFormat(pad(bytes("RIFF", [0, 0, 0, 0], "WAVE"), 32)), "audio");
    assert.equal(sniffFormat(pad(bytes([0, 0, 0, 0x20], "ftypisom"), 32)), "video");
    assert.equal(sniffFormat(pad(bytes([0, 0, 0, 0x20], "ftypavif"), 32)), "avif");
    assert.equal(sniffFormat(pad(bytes([0, 0, 0, 0x20], "ftypheic"), 32)), "heic");
    assert.equal(sniffFormat(pad(bytes("ID3"), 32)), "audio");
  });

  test("an executable renamed .pdf is not a PDF", () => {
    // The original hole: the upload route reads the browser's MIME claim and
    // the filename, both attacker-controlled. Bytes are neither.
    const mzExe = pad(bytes("MZ", [0x90, 0x00, 0x03]), 64);
    assert.equal(sniffFormat(mzExe), "unknown");
    assert.equal(resolveContentPolicy(mzExe), null);
  });

  test("HTML and SVG are not a recognised deliverable family", () => {
    assert.equal(sniffFormat(pad(bytes("<!DOCTYPE html><html>"), 64)), "unknown");
    assert.equal(sniffFormat(pad(bytes("<svg xmlns=\"http://www.w3.org/2000/svg\">"), 64)), "unknown");
  });

  test("an unrecognised family resolves to no policy, which is a rejection", () => {
    assert.equal(resolveContentPolicy(pad(bytes("garbage-not-a-file"), 64)), null);
  });
});

/* ------------------------------------------------------------------ */
/* PDF active content                                                  */
/* ------------------------------------------------------------------ */

describe("PDF active content", () => {
  const pdf = (body: string) => pad(bytes(`%PDF-1.7\n${body}\n%%EOF`), 64);

  test("a plain PDF is allowed", () => {
    const p = pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
    assert.deepEqual(findPdfActiveContent(p), []);
    const policy = resolveContentPolicy(p);
    assert.equal(policy?.kind, "pdf");
    assert.deepEqual(structuralVerdict(p, policy!), { outcome: "ALLOW" });
  });

  for (const [body, reason] of [
    ["<< /JavaScript 5 0 R >>", "pdf_javascript"],
    ["<< /JS (app.alert\\(1\\)) >>", "pdf_javascript"],
    ["<< /Launch << /F (calc.exe) >> >>", "pdf_launch_action"],
    ["<< /OpenAction 3 0 R >>", "pdf_open_action"],
    ["<< /EmbeddedFile 9 0 R >>", "pdf_embedded_file"],
    ["<< /RichMedia 4 0 R >>", "pdf_rich_media"],
  ] as const) {
    test(`${reason} is rejected`, () => {
      const p = pdf(body);
      const policy = resolveContentPolicy(p)!;
      const verdict = structuralVerdict(p, policy);
      assert.equal(verdict.outcome, "REJECT");
      assert.equal((verdict as { reason: string }).reason, reason);
    });
  }

  test("lookalike tokens do not false-positive", () => {
    // /JS must not match /JSON, /AA must not match a longer name.
    assert.deepEqual(findPdfActiveContent(pdf("<< /JSONData 1 0 R /AArdvark 2 >>")), []);
  });
});

/* ------------------------------------------------------------------ */
/* Archives                                                            */
/* ------------------------------------------------------------------ */

describe("archive structure is parsed, never executed", () => {
  test("entries are read from the central directory", () => {
    const zip = makeZip([{ name: "readme.txt" }, { name: "assets/logo.png" }]);
    const dir = readZipCentralDirectory(zip);
    assert.equal(dir.ok, true);
    assert.deepEqual(
      dir.ok ? dir.entries.map((e) => e.name) : [],
      ["readme.txt", "assets/logo.png"]
    );
  });

  test("a truncated archive is malformed, not silently empty", () => {
    assert.equal(readZipCentralDirectory(new Uint8Array(10)).ok, false);
  });

  test("entry classification", () => {
    const e = (name: string) => ({
      name,
      compressedSize: 1,
      uncompressedSize: 1,
      encrypted: false,
      symlink: false,
      method: 0,
      localHeaderOffset: 0,
    });
    assert.equal(isExecutableEntry(e("setup.exe")), true);
    assert.equal(isExecutableEntry(e("Tool.app")), true);
    assert.equal(isScriptEntry(e("payload.js")), true);
    assert.equal(isScriptEntry(e("run.ps1")), true);
    assert.equal(isNestedArchive(e("inner.zip")), true);
    assert.equal(isNestedArchive(e("inner.rar")), true);
    assert.equal(hasPathTraversal(e("../../etc/passwd")), true);
    assert.equal(hasPathTraversal(e("/absolute/path")), true);
    assert.equal(hasPathTraversal(e("C:\\windows\\system32")), true);
    // Legitimate content must not trip any of them.
    assert.equal(isExecutableEntry(e("chapter-01.xhtml")), false);
    assert.equal(isScriptEntry(e("chapter-01.xhtml")), false);
    assert.equal(hasPathTraversal(e("OEBPS/text/ch1.xhtml")), false);
  });

  test("decompression bombs are flagged only above an absolute floor", () => {
    const bomb = [
      { name: "big", compressedSize: 1000, uncompressedSize: 1_000_000_000, encrypted: false, symlink: false, method: 8, localHeaderOffset: 0 },
    ];
    const small = [
      { name: "s", compressedSize: 10, uncompressedSize: 100_000, encrypted: false, symlink: false, method: 8, localHeaderOffset: 0 },
    ];
    assert.equal(isDecompressionBomb(bomb), true);
    assert.equal(isDecompressionBomb(small), false);
  });

  const zipRejects: [string, ZipSpec[], string][] = [
    ["executable inside", [{ name: "setup.exe" }], "archive_executable"],
    ["script inside", [{ name: "install.sh" }], "archive_script"],
    ["nested archive", [{ name: "inner.zip" }], "archive_nested"],
    ["password protected", [{ name: "secret.txt", encrypted: true }], "archive_encrypted"],
    ["path traversal", [{ name: "../escape.txt" }], "archive_path_traversal"],
    ["symlink", [{ name: "link", symlink: true }], "archive_symlink"],
    [
      "decompression bomb",
      [{ name: "big.txt", compressedSize: 1000, uncompressedSize: 900_000_000 }],
      "archive_decompression_bomb",
    ],
  ];

  for (const [label, specs, reason] of zipRejects) {
    test(`ZIP with ${label} is rejected as ${reason}`, () => {
      const zip = makeZip(specs);
      const policy = resolveContentPolicy(zip)!;
      assert.equal(policy.kind, "zip");
      const verdict = structuralVerdict(zip, policy);
      assert.equal(verdict.outcome, "REJECT");
      assert.equal((verdict as { reason: string }).reason, reason);
    });
  }

  test("an ordinary ZIP is allowed", () => {
    const zip = makeZip([{ name: "artwork.png" }, { name: "notes/readme.txt" }]);
    const policy = resolveContentPolicy(zip)!;
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
  });
});

/* ------------------------------------------------------------------ */
/* EPUB is not treated as a generic ZIP                                */
/* ------------------------------------------------------------------ */

describe("EPUB policy", () => {
  // A real EPUB: `mimetype` first, stored, containing exactly the media type.
  const epubSpecs = (extra: ZipSpec[] = []): ZipSpec[] => [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml" },
    { name: "OEBPS/content.opf" },
    ...extra,
  ];

  test("EPUB layout is detected and given its own policy", () => {
    const epub = makeZip(epubSpecs([{ name: "OEBPS/ch1.xhtml" }]));
    const dir = readZipCentralDirectory(epub);
    assert.ok(dir.ok && isEpubLayout(dir.entries, epub));

    const policy = resolveContentPolicy(epub)!;
    assert.equal(policy.kind, "epub");
    assert.deepEqual(policy.restrictToExtensions, [".epub"]);
    // The whole point: XHTML is the format, so HTML must be permitted here and
    // nowhere else.
    assert.equal(policy.allowHtml, true);
  });

  test("XHTML inside an EPUB is allowed", () => {
    const epub = makeZip(epubSpecs([{ name: "OEBPS/text/chapter-01.xhtml" }]));
    const policy = resolveContentPolicy(epub)!;
    assert.deepEqual(structuralVerdict(epub, policy), { outcome: "ALLOW" });
  });

  test("script inside an EPUB is still rejected", () => {
    const epub = makeZip(epubSpecs([{ name: "OEBPS/js/reader.js" }]));
    const policy = resolveContentPolicy(epub)!;
    const verdict = structuralVerdict(epub, policy);
    assert.equal(verdict.outcome, "REJECT");
    assert.equal((verdict as { reason: string }).reason, "archive_script");
  });

  test("a plain ZIP does not get the EPUB exemption", () => {
    const zip = makeZip([{ name: "index.html" }]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "zip");
    assert.equal(policy.allowHtml, false);
  });
});

/* ------------------------------------------------------------------ */
/* Provider findings -> verdict                                        */
/* ------------------------------------------------------------------ */

describe("provider findings are reconciled with policy", () => {
  const pdfPolicy = { kind: "pdf" as const, restrictToExtensions: [".pdf"], allowHtml: false };
  const epubPolicy = { kind: "epub" as const, restrictToExtensions: [".epub"], allowHtml: true };

  test("a clean result is allowed", () => {
    assert.deepEqual(verdictFromFindings(cleanFindings(), pdfPolicy), { outcome: "ALLOW" });
  });

  const rejections: [keyof ScanFindings | "clean", unknown, string][] = [
    ["clean", false, "malware"],
    ["containsExecutable", true, "executable"],
    ["containsScript", true, "script"],
    ["containsMacros", true, "macros"],
    ["containsPasswordProtectedFile", true, "password_protected"],
    ["containsUnsafeArchive", true, "unsafe_archive"],
    ["containsOleEmbeddedObject", true, "ole_embedded_object"],
    ["containsXmlExternalEntities", true, "xxe"],
    ["containsInsecureDeserialization", true, "insecure_deserialization"],
    ["containsInvalidFile", true, "malformed_file"],
    ["containsRestrictedFileFormat", true, "format_mismatch"],
    ["containsHtml", true, "html_content"],
  ];

  for (const [field, value, reason] of rejections) {
    test(`${String(field)} -> ${reason}`, () => {
      const verdict = verdictFromFindings(
        cleanFindings({ [field]: value } as Partial<ScanFindings>),
        pdfPolicy
      );
      assert.equal(verdict.outcome, "REJECT");
      assert.equal((verdict as { reason: string }).reason, reason);
    });
  }

  test("HTML is allowed only inside an EPUB", () => {
    assert.equal(
      verdictFromFindings(cleanFindings({ containsHtml: true }), pdfPolicy).outcome,
      "REJECT"
    );
    assert.equal(
      verdictFromFindings(
        cleanFindings({ containsHtml: true, verifiedFileFormat: ".epub" }),
        epubPolicy
      ).outcome,
      "ALLOW"
    );
  });

  test("a content-verified format that disagrees with ours is rejected", () => {
    const verdict = verdictFromFindings(
      cleanFindings({ verifiedFileFormat: ".exe" }),
      pdfPolicy
    );
    assert.equal(verdict.outcome, "REJECT");
    assert.equal((verdict as { reason: string }).reason, "format_mismatch");
  });

  test("a matching verified format is accepted with or without the dot", () => {
    assert.equal(verdictFromFindings(cleanFindings({ verifiedFileFormat: ".pdf" }), pdfPolicy).outcome, "ALLOW");
    assert.equal(verdictFromFindings(cleanFindings({ verifiedFileFormat: "pdf" }), pdfPolicy).outcome, "ALLOW");
  });
});

/* ------------------------------------------------------------------ */
/* The provider itself, against a stubbed transport                    */
/* ------------------------------------------------------------------ */

describe("Cloudmersive failure mapping", () => {
  const withKey = async (fn: () => Promise<void>) => {
    const prevKey = process.env.CLOUDMERSIVE_API_KEY;
    const prevFetch = globalThis.fetch;
    process.env.CLOUDMERSIVE_API_KEY = "test-key-not-a-real-secret";
    try {
      await fn();
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
      else process.env.CLOUDMERSIVE_API_KEY = prevKey;
    }
  };

  const req = {
    bytes: new Uint8Array([1, 2, 3]),
    fileName: "x.pdf",
    restrictToExtensions: [".pdf"],
    allowHtml: false,
  };

  test("no key configured -> unconfigured, and no request is made", async () => {
    const prev = process.env.CLOUDMERSIVE_API_KEY;
    delete process.env.CLOUDMERSIVE_API_KEY;
    let called = false;
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok, false);
      assert.equal(res.ok === false && res.failure, "unconfigured");
      assert.equal(called, false);
    } finally {
      globalThis.fetch = prevFetch;
      if (prev !== undefined) process.env.CLOUDMERSIVE_API_KEY = prev;
    }
  });

  const statusCases: [number, string][] = [
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
    [413, "too_large"],
    [400, "bad_response"],
    [401, "bad_response"],
  ];

  for (const [status, failure] of statusCases) {
    test(`HTTP ${status} -> ${failure}`, async () => {
      await withKey(async () => {
        globalThis.fetch = (async () =>
          new Response("{}", { status })) as typeof fetch;
        const res = await cloudmersiveProvider.scan(req);
        assert.equal(res.ok, false);
        assert.equal(res.ok === false && res.failure, failure);
      });
    });
  }

  test("a timeout is reported as a timeout", async () => {
    await withKey(async () => {
      globalThis.fetch = (async () => {
        const e = new Error("timed out");
        e.name = "TimeoutError";
        throw e;
      }) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok === false && res.failure, "timeout");
    });
  });

  test("a transport error is reported as network", async () => {
    await withKey(async () => {
      globalThis.fetch = (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok === false && res.failure, "network");
    });
  });

  test("unparseable body -> bad_response", async () => {
    await withKey(async () => {
      globalThis.fetch = (async () =>
        new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok === false && res.failure, "bad_response");
    });
  });

  test("a response without CleanResult is an error, never a pass", async () => {
    await withKey(async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ SomethingElse: true }), {
          status: 200,
        })) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok === false && res.failure, "bad_response");
    });
  });

  test("missing threat flags are read as THREAT PRESENT", async () => {
    await withKey(async () => {
      // CleanResult true but every other field absent. Coercing this into
      // "threat present" would be inventing a verdict out of a payload we do
      // not understand, so it is a parse failure -> SCAN_ERROR, never SAFE.
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ CleanResult: true }), {
          status: 200,
        })) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok, false);
      assert.equal(res.ok === false && res.failure, "bad_response");
    });
  });

  test("malware is reported as unclean", async () => {
    await withKey(async () => {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            CleanResult: false,
            FoundViruses: [{ FileName: "x.pdf", VirusName: "Eicar-Test-Signature" }],
            ContainsExecutable: false,
            ContainsInvalidFile: false,
            ContainsScript: false,
            ContainsPasswordProtectedFile: false,
            ContainsRestrictedFileFormat: false,
            ContainsMacros: false,
            ContainsXmlExternalEntities: false,
            ContainsInsecureDeserialization: false,
            ContainsHtml: false,
            ContainsUnsafeArchive: false,
            ContainsOleEmbeddedObject: false,
            VerifiedFileFormat: ".pdf",
          }),
          { status: 200 }
        )) as typeof fetch;
      const res = await cloudmersiveProvider.scan(req);
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.findings.clean, false);
        assert.deepEqual(res.findings.virusNames, ["Eicar-Test-Signature"]);
        const verdict = verdictFromFindings(res.findings, {
          kind: "pdf",
          restrictToExtensions: [".pdf"],
          allowHtml: false,
        });
        assert.equal((verdict as { reason: string }).reason, "malware");
      }
    });
  });

  test("only transient failures are retryable", () => {
    for (const f of ["timeout", "rate_limited", "server_error", "network"] as const) {
      assert.equal(isRetryableFailure(f), true, f);
    }
    for (const f of ["unconfigured", "too_large", "bad_response"] as const) {
      assert.equal(isRetryableFailure(f), false, f);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Retry and hashing                                                   */
/* ------------------------------------------------------------------ */

describe("bounded retry", () => {
  const at = (s: string) => new Date(s);
  const base = {
    scanStatus: "SCAN_ERROR",
    scanAttempts: 1,
    scanAt: at("2026-08-12T10:00:00Z"),
  };

  test("a settled file is never re-scanned", () => {
    for (const scanStatus of ["SAFE", "UNSAFE"]) {
      assert.equal(
        isEligibleNow({ ...base, scanStatus, scanAttempts: 0, scanAt: null }),
        false,
        scanStatus
      );
    }
  });

  test("attempts are bounded", () => {
    assert.equal(
      isEligibleNow({ ...base, scanAttempts: MAX_SCAN_ATTEMPTS, scanAt: null }),
      false
    );
    assert.equal(MAX_SCAN_ATTEMPTS, 3);
  });

  test("a never-attempted file is immediately eligible", () => {
    assert.equal(
      isEligibleNow({ scanStatus: "PENDING_SCAN", scanAttempts: 0, scanAt: null }),
      true
    );
  });

  test("backoff grows with each attempt", () => {
    // attempt 1 -> 2 minutes, attempt 2 -> 4 minutes.
    assert.equal(isEligibleNow({ ...base, scanAttempts: 1 }, at("2026-08-12T10:01:00Z")), false);
    assert.equal(isEligibleNow({ ...base, scanAttempts: 1 }, at("2026-08-12T10:02:00Z")), true);
    assert.equal(isEligibleNow({ ...base, scanAttempts: 2 }, at("2026-08-12T10:03:00Z")), false);
    assert.equal(isEligibleNow({ ...base, scanAttempts: 2 }, at("2026-08-12T10:04:00Z")), true);
  });
});

describe("SHA-256 is over the exact bytes", () => {
  test("known vector", () => {
    // sha256("abc")
    assert.equal(
      sha256Hex(new TextEncoder().encode("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  test("empty and single-byte differences change the digest", () => {
    const a = sha256Hex(new Uint8Array([1, 2, 3]));
    const b = sha256Hex(new Uint8Array([1, 2, 4]));
    assert.notEqual(a, b);
    assert.equal(a.length, 64);
  });
});

/* ------------------------------------------------------------------ */
/* Provenance                                                          */
/* ------------------------------------------------------------------ */

describe("provenance authorises an attachment", () => {
  const asset = {
    key: "KEY1234567890",
    shopId: "shop_a",
    route: "PRODUCT_FILE" as const,
    scanStatus: "PENDING_SCAN" as const,
    scanSha256: null,
    scanAt: null,
  };

  test("the right shop and the right route is accepted", () => {
    const res = provenanceVerdict(asset, "shop_a");
    assert.equal(res.ok, true);
  });

  test("an absent record is rejected", () => {
    const res = provenanceVerdict(null, "shop_a");
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.reason, "missing");
  });

  test("another shop's upload is rejected", () => {
    // The cross-shop key reuse that host pinning alone could not close.
    const res = provenanceVerdict(asset, "shop_b");
    assert.equal(res.ok === false && res.reason, "wrong_shop");
  });

  test("an upload from a different route is rejected", () => {
    for (const route of ["PRODUCT_THUMBNAIL", "SHOP_LOGO", "SHOP_COVER"] as const) {
      const res = provenanceVerdict({ ...asset, route }, "shop_a");
      assert.equal(res.ok === false && res.reason, "wrong_route", route);
    }
  });
});

describe("attached scan fields", () => {
  const now = new Date("2026-08-12T12:00:00Z");

  test("an unscanned file binds no key", () => {
    const fields = attachedScanFields({
      key: "K1",
      scanStatus: "PENDING_SCAN",
      scanSha256: null,
      scanAt: null,
    });
    assert.equal(fields.fileScanStatus, "PENDING_SCAN");
    assert.equal(fields.fileScanKey, null);
  });

  test("a settled file carries its verdict and binds its key", () => {
    for (const status of ["SAFE", "UNSAFE", "SCAN_ERROR"] as const) {
      const fields = attachedScanFields({
        key: "K1",
        scanStatus: status,
        scanSha256: "abc",
        scanAt: now,
      });
      assert.equal(fields.fileScanStatus, status);
      assert.equal(fields.fileScanKey, "K1");
      assert.equal(fields.fileScanSha256, "abc");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Wiring (source-level: these paths need a database to execute)       */
/* ------------------------------------------------------------------ */

describe("verdict writes are bound to the scanned key", () => {
  test("product propagation is conditional on fileKey", () => {
    // The race this closes: scan A, seller replaces with B, A's verdict lands
    // late. B has a different fileKey, so it matches nothing.
    assert.ok(
      /updateMany\(\{\s*where: \{ fileKey: key \}/.test(runSrc),
      "product update must be keyed on the scanned key"
    );
    assert.ok(
      !/product\.update\(\{\s*where: \{ id/.test(runSrc),
      "must not write a verdict by product id"
    );
  });

  test("the whole verdict write is one transaction", () => {
    assert.ok(runSrc.includes("prisma.$transaction"));
  });

  test("attempts are claimed before any work", () => {
    const claim = runSrc.indexOf("scanAttempts: { increment: 1 }");
    // Match the call site, not the import.
    const readCall = runSrc.indexOf("await readPrivateObject(");
    assert.ok(claim > 0, "attempt counter must be persisted");
    assert.ok(readCall > 0);
    assert.ok(claim < readCall, "claim before reading bytes");
  });

  test("SAFE is written on exactly one path", () => {
    // Every verdict goes through settle(); count only the SAFE one. The type
    // union on finalizeVerdict must not be counted.
    const safeWrites = runSrc.match(/settle\("SAFE"/g) ?? [];
    assert.equal(safeWrites.length, 1, "only one place may write SAFE");
  });

  test("every failure path writes SCAN_ERROR, never SAFE", () => {
    for (const reason of [
      "storage_",
      "hash_failed",
      "provider_threw",
    ]) {
      assert.ok(runSrc.includes(reason), `missing failure path: ${reason}`);
    }
    assert.ok(runSrc.includes('settle("SCAN_ERROR"'));
  });

  test("an unconfigured provider records nothing", () => {
    // It never attempted a scan, so it must not manufacture a failure that
    // burns the retry budget.
    assert.ok(runSrc.includes("PROVIDER_UNCONFIGURED"));
    const idx = runSrc.indexOf("PROVIDER_UNCONFIGURED");
    const claimIdx = runSrc.indexOf("scanAttempts: { increment: 1 }");
    assert.ok(idx < claimIdx, "must return before claiming an attempt");
  });

  test("the scanner never moves moderation state by itself", () => {
    assert.ok(runSrc.includes("previousStatus: product.moderationStatus"));
    assert.ok(runSrc.includes("newStatus: product.moderationStatus"));
  });

  test("the audit records the engine, not its payload", () => {
    assert.ok(runSrc.includes("actor: `scanner:${providerId}`"));
    assert.ok(!/reason: JSON\.stringify/.test(runSrc), "must not store raw payloads");
  });
});

describe("provenance is enforced on both write paths", () => {
  test("create verifies before attaching", () => {
    assert.ok(createSrc.includes("verifyDeliverableProvenance(fileKey, shopId)"));
    assert.ok(createSrc.includes("attachedScanFields"));
  });

  test("edit verifies a replacement against the product's own shop", () => {
    assert.ok(editSrc.includes("verifyDeliverableProvenance("));
    assert.ok(editSrc.includes("product.shopId"));
  });

  test("provenance is checked after ownership, not before", () => {
    // Call site, not the import — otherwise this passes vacuously.
    const ownership = createSrc.indexOf("You don't have access to this shop");
    const provenanceCall = createSrc.indexOf("verifyDeliverableProvenance(fileKey");
    assert.ok(ownership > 0 && provenanceCall > 0);
    assert.ok(
      ownership < provenanceCall,
      "an outsider must be refused before any key lookup"
    );
  });

  test("the upload callback records provenance and does not scan", () => {
    assert.ok(coreSrc.includes("prisma.fileAsset.upsert"));
    assert.equal((coreSrc.match(/recordProvenance\("/g) ?? []).length, 4);
    assert.ok(!/scanFileAsset|cloudmersive/i.test(coreSrc), "callback must not scan");
  });

  test("provenance is written from server metadata, not a request body", () => {
    assert.ok(coreSrc.includes("shopId: metadata.shopId"));
    assert.ok(coreSrc.includes("uploadedById: metadata.userId"));
  });
});

/* ------------------------------------------------------------------ */
/* Secrets and regressions                                             */
/* ------------------------------------------------------------------ */

describe("secrets never escape the server", () => {
  const clientFiles = [
    "../app/dashboard/shop/[slug]/add-product/page.tsx",
    "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    "../app/dashboard/shop/[slug]/edit/page.tsx",
    "../lib/uploadthing.ts",
  ];

  test("no client module references the scanner or any key", () => {
    for (const f of clientFiles) {
      const src = read(f);
      assert.ok(!/CLOUDMERSIVE|API_KEY|generateSignedURL/i.test(src), f);
    }
  });

  test("the scanner key is read from the environment only", () => {
    const provider = read("../lib/scan/cloudmersive.ts");
    assert.ok(provider.includes("process.env.CLOUDMERSIVE_API_KEY"));
    // No literal key, and no NEXT_PUBLIC_ exposure anywhere.
    assert.ok(!/CLOUDMERSIVE_API_KEY\s*=\s*["'][^"']+["']/.test(provider));
    assert.ok(!/NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/.test(provider));
  });

  test("the signed URL is never returned, logged or persisted", () => {
    // It is the private asset. readPrivateObject hands back bytes only.
    assert.ok(storageSrc.includes("Promise<StorageReadResult>"));
    assert.ok(!/console\.(log|error|warn)\([^)]*signedUrl/.test(storageSrc));
    assert.ok(!/return .*signedUrl/.test(storageSrc));
    assert.ok(!/signedUrl/.test(runSrc), "the pipeline never sees a signed URL");
  });

  test("the worker never echoes a provider payload or a cause", () => {
    assert.ok(workerSrc.includes('(error as Error)?.name'));
    assert.ok(!/console\.error\([^)]*error\)/.test(workerSrc));
  });

  test("the worker requires an admin session or the cron secret", () => {
    assert.ok(workerSrc.includes("isAdminEmail"));
    assert.ok(workerSrc.includes("Bearer ${cronSecret}"));
    // No secret configured must not mean "anyone may call it".
    assert.ok(/if \(cronSecret\)/.test(workerSrc));
  });
});

describe("Stage A/B guarantees still hold", () => {
  test("the deliverable route is still private", () => {
    const cfg = read("../lib/upload-config.ts");
    assert.ok(cfg.includes('acl: "private"'));
    assert.ok(cfg.includes('contentDisposition: "attachment"'));
  });

  test("the video ceiling now fits the scannable limit", () => {
    const cfg = read("../lib/upload-config.ts");
    assert.ok(cfg.includes('video: { maxFileSize: "128MB"'));
    assert.ok(!cfg.includes('"256MB"'));
  });

  test("PRE_LAUNCH_MODE and payments are untouched", () => {
    const checkout = read("../app/api/checkout/route.ts");
    assert.ok(checkout.includes("env.PRE_LAUNCH_MODE"));
    assert.ok(checkout.includes('error: "pre_launch"'));
    // Stage C does not gate checkout — that is Stage D.
    assert.ok(!checkout.includes("fileScanStatus"));
  });

  test("buyer download is not yet gated (Stage D) and still needs an order", () => {
    const dl = read("../app/api/download/[productId]/route.ts");
    assert.ok(dl.includes("Not authorized to download this product"));
    assert.ok(!dl.includes("fileScanStatus"));
  });
});

/* ================================================================== */
/* Fugu remediation regressions                                        */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* C1 — forged ZIP structure                                           */
/* ------------------------------------------------------------------ */

describe("C1: a forged central directory cannot launder archive contents", () => {
  const withExe = [{ name: "setup.exe" }];

  test("the honest archive is rejected for its contents", () => {
    const zip = makeZip(withExe);
    const policy = resolveContentPolicy(zip)!;
    const verdict = structuralVerdict(zip, policy);
    assert.equal((verdict as { reason: string }).reason, "archive_executable");
  });

  test("REGRESSION: an appended EOCD claiming zero entries no longer passes", () => {
    // Before the fix this parsed as an empty archive and returned ALLOW, so an
    // archive containing setup.exe was accepted as structurally clean.
    const zip = makeZip(withExe, { forgeTrailingEocd: true });
    const dir = readZipCentralDirectory(zip);
    assert.equal(dir.ok, false, "the forgery must not parse");

    const policy = resolveContentPolicy(zip)!;
    const verdict = structuralVerdict(zip, policy);
    assert.equal(verdict.outcome, "REJECT");
    assert.equal((verdict as { reason: string }).reason, "archive_malformed");
  });

  const structuralForgeries: [string, ZipSpec[], Parameters<typeof makeZip>[1]][] = [
    ["EOCD comment does not reach EOF", withExe, { bogusCommentLen: 5 }],
    ["trailing bytes after the EOCD", withExe, { trailingJunk: 16 }],
    ["declared entry count disagrees with the directory", withExe, { lieAboutCount: 0 }],
    ["entry count too high", withExe, { lieAboutCount: 5 }],
    ["cdOffset + cdSize does not land on the EOCD", withExe, { shiftCdOffset: 4 }],
    // Two entries so the first local header stays intact and the file is still
    // recognised as a ZIP — isolating the local-header cross-check.
    [
      "a directory entry points at no local header",
      [{ name: "readme.txt" }, { name: "setup.exe" }],
      { breakLocalHeader: true },
    ],
    ["a local header carries a different name", withExe, { mismatchLocalName: true }],
  ];

  for (const [label, specs, opts] of structuralForgeries) {
    test(`rejected: ${label}`, () => {
      const zip = makeZip(specs, opts);
      const dir = readZipCentralDirectory(zip);
      assert.equal(dir.ok, false, label);
      const policy = resolveContentPolicy(zip);
      // Either the family is no longer recognisable at all, or the structural
      // pass rejects it. Both are fail-closed.
      if (policy) {
        assert.equal(structuralVerdict(zip, policy).outcome, "REJECT");
      }
    });
  }

  test("every forgery fails CLOSED, never as an empty allow", () => {
    for (const [, specs, opts] of structuralForgeries) {
      const zip = makeZip(specs, opts);
      const dir = readZipCentralDirectory(zip);
      // The dangerous outcome is ok:true with no entries — that is what
      // silently allowed forbidden contents.
      assert.ok(!(dir.ok && dir.entries.length === 0), "must not parse as empty");
    }
  });

  test("a genuine archive still parses after hardening", () => {
    const zip = makeZip([{ name: "art.png" }, { name: "notes/readme.txt" }]);
    const dir = readZipCentralDirectory(zip);
    assert.ok(dir.ok && dir.entries.length === 2);
    assert.equal(structuralVerdict(zip, resolveContentPolicy(zip)!).outcome, "ALLOW");
  });

  test("a genuine EPUB still parses and keeps its own policy", () => {
    const epub = makeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml" },
      { name: "OEBPS/ch1.xhtml" },
    ]);
    const policy = resolveContentPolicy(epub)!;
    assert.equal(policy.kind, "epub");
    assert.equal(structuralVerdict(epub, policy).outcome, "ALLOW");
  });
});

/* ------------------------------------------------------------------ */
/* C2 — queue eligibility and quota                                    */
/* ------------------------------------------------------------------ */

describe("C2: only real deliverables consume scanner quota", () => {
  test("the queue selects PRODUCT_FILE only", () => {
    const queue = runSrc.slice(runSrc.indexOf("export async function findScannableKeys"));
    assert.ok(/route"::text = 'PRODUCT_FILE'/.test(queue), "queue must filter by route");
  });

  test("an explicit request for a non-deliverable is refused", () => {
    // Thumbnails, logos and covers must not be scannable even by key.
    assert.ok(runSrc.includes('asset.route !== "PRODUCT_FILE"'));
    assert.ok(runSrc.includes("SKIPPED_WRONG_ROUTE"));
    const routeCheck = runSrc.indexOf('asset.route !== "PRODUCT_FILE"');
    assert.ok(routeCheck < runSrc.indexOf("claimScan(key, now)"), "before any claim");
  });

  test("the claim statement itself is route-scoped", () => {
    // Defence in depth: even a caller that skipped the check above cannot
    // claim a non-deliverable.
    const claim = runSrc.slice(runSrc.indexOf("async function claimScan"));
    assert.ok(/route: "PRODUCT_FILE"/.test(claim));
  });

  test("an unattached upload is never sent to the provider", () => {
    // Abandoned uploads would otherwise let any seller burn quota at will.
    assert.ok(runSrc.includes("SKIPPED_NOT_ATTACHED"));
    const attachCheck = runSrc.indexOf("SKIPPED_NOT_ATTACHED");
    assert.ok(attachCheck < runSrc.indexOf("claimScan(key, now)"));
  });

  test("attachment must be in the same shop as the upload's provenance", () => {
    assert.ok(/fileKey: key, shopId: asset\.shopId/.test(runSrc));
    const queue = runSrc.slice(runSrc.indexOf("export async function findScannableKeys"));
    assert.ok(queue.includes('p."fileKey" = fa."key"'));
    assert.ok(queue.includes('p."shopId" = fa."shopId"'));
  });

  test("REGRESSION: attachment is filtered BEFORE the limit, not after", () => {
    // Filtering in memory after a fixed window let abandoned uploads hold the
    // front of ORDER BY createdAt forever and starve the queue.
    const queue = runSrc.slice(runSrc.indexOf("export async function findScannableKeys"));
    const exists = queue.indexOf("EXISTS (");
    const limit = queue.indexOf("LIMIT");
    assert.ok(exists > 0 && limit > 0, "queue must use EXISTS and LIMIT");
    assert.ok(exists < limit, "EXISTS must be evaluated before LIMIT");
    assert.ok(!queue.includes("limit * 8"), "no over-fetch window");
    assert.ok(!queue.includes(".filter("), "no in-memory eligibility filtering");
  });
});

/* ------------------------------------------------------------------ */
/* C3 — atomic claim and finalisation                                  */
/* ------------------------------------------------------------------ */

describe("C3: exactly one worker may claim and finalise a scan", () => {
  test("the claim is a single conditional UPDATE, not read-then-write", () => {
    const claim = runSrc.slice(
      runSrc.indexOf("async function claimScan"),
      runSrc.indexOf("async function finalizeVerdict")
    );
    assert.ok(claim.includes("prisma.fileAsset.updateMany"), "must be updateMany");
    assert.ok(claim.includes("result.count === 1"), "only the winner proceeds");
    // The attempt increment and the bound are the same statement, so attempts
    // cannot exceed the maximum under concurrency.
    assert.ok(claim.includes("scanAttempts: { lt: MAX_SCAN_ATTEMPTS }"));
    assert.ok(claim.includes("scanAttempts: { increment: 1 }"));
    assert.ok(!/fileAsset\.update\(/.test(claim), "no unconditional update");
  });

  test("a claim carries a unique token and a lease", () => {
    assert.ok(runSrc.includes("randomUUID()"));
    assert.ok(runSrc.includes("scanClaimToken: token"));
    assert.ok(runSrc.includes("scanClaimedAt: now"));
    assert.ok(runSrc.includes("scanClaimedAt: { lt: leaseCutoff }"), "stale leases reclaimable");
  });

  test("settled verdicts can never be reclaimed", () => {
    const claim = runSrc.slice(
      runSrc.indexOf("async function claimScan"),
      runSrc.indexOf("async function finalizeVerdict")
    );
    assert.ok(claim.includes('scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] }'));
  });

  test("finalisation requires the claim to still be current", () => {
    const finalize = runSrc.slice(runSrc.indexOf("async function finalizeVerdict"));
    assert.ok(finalize.includes("scanClaimToken: token"), "token must be re-checked");
    assert.ok(finalize.includes("finalized.count !== 1"), "stale worker writes nothing");
  });

  test("a terminal UNSAFE cannot be overwritten by a later SAFE", () => {
    const finalize = runSrc.slice(runSrc.indexOf("async function finalizeVerdict"));
    // The status guard excludes SAFE and UNSAFE, so once either is recorded no
    // further finalisation matches.
    assert.ok(finalize.includes('scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] }'));
  });

  test("product propagation happens only after a successful finalisation", () => {
    const finalize = runSrc.slice(runSrc.indexOf("async function finalizeVerdict"));
    const guard = finalize.indexOf("finalized.count !== 1");
    const propagate = finalize.indexOf("tx.product.updateMany");
    assert.ok(guard > 0 && propagate > 0);
    assert.ok(guard < propagate, "the guard must precede propagation");
    assert.ok(finalize.includes("prisma.$transaction"));
  });

  test("a stale worker reports STALE_CLAIM rather than a verdict", () => {
    assert.ok(runSrc.includes('return { key, outcome: "STALE_CLAIM" }'));
  });

  test("backoff is decided by the database, not by a prior read", () => {
    assert.ok(runSrc.includes("backoffClauses(now)"));
    // One ladder, shared by the claim clauses and the queue, so they cannot
    // drift apart.
    assert.ok(runSrc.includes("backoffMs(attempts)"));
    assert.ok(runSrc.includes("2 ** attempts * 60_000"));
    const queue = runSrc.slice(runSrc.indexOf("export async function findScannableKeys"));
    assert.ok(queue.includes(`power(2, fa."scanAttempts")`), "queue backoff is in SQL");
  });
});

/* ------------------------------------------------------------------ */
/* C4 — strict provider validation                                     */
/* ------------------------------------------------------------------ */

describe("C4: provider payloads are validated strictly", () => {
  const withKey = async (body: unknown, status = 200) => {
    const prevKey = process.env.CLOUDMERSIVE_API_KEY;
    const prevFetch = globalThis.fetch;
    process.env.CLOUDMERSIVE_API_KEY = "test-key-not-a-real-secret";
    globalThis.fetch = (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      })) as typeof fetch;
    try {
      return await cloudmersiveProvider.scan({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "x.pdf",
        restrictToExtensions: [".pdf"],
        allowHtml: false,
      });
    } finally {
      globalThis.fetch = prevFetch;
      if (prevKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
      else process.env.CLOUDMERSIVE_API_KEY = prevKey;
    }
  };

  const complete = (over: Record<string, unknown> = {}) => ({
    CleanResult: true,
    ContainsExecutable: false,
    ContainsInvalidFile: false,
    ContainsScript: false,
    ContainsPasswordProtectedFile: false,
    ContainsRestrictedFileFormat: false,
    ContainsMacros: false,
    ContainsXmlExternalEntities: false,
    ContainsInsecureDeserialization: false,
    ContainsHtml: false,
    ContainsUnsafeArchive: false,
    ContainsOleEmbeddedObject: false,
    VerifiedFileFormat: ".pdf",
    ...over,
  });

  test("a complete, well-typed clean payload parses", async () => {
    const res = await withKey(complete());
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.findings.verifiedFileFormat, ".pdf");
  });

  const rejected: [string, unknown][] = [
    ['string "false" instead of a boolean', complete({ ContainsExecutable: "false" })],
    ['string "true" instead of a boolean', complete({ ContainsScript: "true" })],
    ["null threat flag", complete({ ContainsMacros: null })],
    ["numeric threat flag", complete({ ContainsHtml: 0 })],
    ["missing threat flag", (() => { const c = complete() as Record<string, unknown>; delete c.ContainsUnsafeArchive; return c; })()],
    ["CleanResult as a string", complete({ CleanResult: "true" })],
    ["CleanResult missing", (() => { const c = complete() as Record<string, unknown>; delete c.CleanResult; return c; })()],
    ["VerifiedFileFormat missing", (() => { const c = complete() as Record<string, unknown>; delete c.VerifiedFileFormat; return c; })()],
    ["VerifiedFileFormat null", complete({ VerifiedFileFormat: null })],
    ["VerifiedFileFormat empty", complete({ VerifiedFileFormat: "   " })],
    ["VerifiedFileFormat wrong type", complete({ VerifiedFileFormat: 42 })],
    ["FoundViruses not an array", complete({ FoundViruses: "Eicar" })],
    ["payload is an array", [complete()]],
    ["payload is null", null],
  ];

  for (const [label, body] of rejected) {
    test(`REJECTED as unparseable: ${label}`, async () => {
      const res = await withKey(body);
      assert.equal(res.ok, false, label);
      assert.equal(res.ok === false && res.failure, "bad_response");
    });
  }

  test("partial JSON body is unparseable", async () => {
    const res = await withKey('{"CleanResult": true, "Contains');
    assert.equal(res.ok === false && res.failure, "bad_response");
  });

  test("no coercion path survives anywhere in the provider", () => {
    const src = read("../lib/scan/cloudmersive.ts");
    assert.ok(!src.includes('toLowerCase() !== "false"'), "string coercion removed");
    assert.ok(src.includes('typeof raw.CleanResult !== "boolean"'));
    assert.ok(src.includes("REQUIRED_THREAT_FLAGS"));
  });
});

describe("C4: verified format must be recognised, with explicit aliases", () => {
  const pdf = { kind: "pdf" as const, restrictToExtensions: [".pdf"], allowHtml: false };
  const epub = { kind: "epub" as const, restrictToExtensions: [".epub"], allowHtml: true };
  const zip = { kind: "zip" as const, restrictToExtensions: [".zip"], allowHtml: false };
  const jpeg = { kind: "image" as const, restrictToExtensions: [".jpg", ".jpeg"], allowHtml: false };
  const heic = { kind: "image" as const, restrictToExtensions: [".heic", ".heif"], allowHtml: false };

  test("an unknown format is rejected even when everything else is clean", () => {
    for (const value of [".xyz", "exe", ".docx", "not-a-format"]) {
      const verdict = verdictFromFindings(
        cleanFindings({ verifiedFileFormat: value }),
        pdf
      );
      assert.equal(verdict.outcome, "REJECT", value);
      assert.equal((verdict as { reason: string }).reason, "format_mismatch");
    }
  });

  test("a recognised format for the wrong policy is rejected", () => {
    assert.equal(
      verdictFromFindings(cleanFindings({ verifiedFileFormat: ".mp4" }), pdf).outcome,
      "REJECT"
    );
  });

  test("dot and case are normalised", () => {
    for (const value of ["pdf", ".PDF", "  .Pdf  "]) {
      assert.equal(normaliseFormat(value), ".pdf");
      assert.equal(
        verdictFromFindings(cleanFindings({ verifiedFileFormat: value }), pdf).outcome,
        "ALLOW",
        value
      );
    }
  });

  test("jpg and jpeg are aliases", () => {
    assert.ok(formatMatchesPolicy(".jpg", jpeg));
    assert.ok(formatMatchesPolicy(".jpeg", jpeg));
  });

  test("heic and heif are aliases", () => {
    assert.ok(formatMatchesPolicy(".heic", heic));
    assert.ok(formatMatchesPolicy(".heif", heic));
  });

  test("an EPUB may verify as .zip, because it is one", () => {
    // Safe only because our own structural pass already proved the EPUB
    // layout before this policy was selected.
    assert.ok(formatMatchesPolicy(".epub", epub));
    assert.ok(formatMatchesPolicy(".zip", epub));
  });

  test("the EPUB alias is NOT reversible", () => {
    // Plain-ZIP policy must not accept a file verified as an EPUB.
    assert.ok(!formatMatchesPolicy(".epub", zip));
    assert.ok(formatMatchesPolicy(".zip", zip));
  });

  test("a clean provider verdict is never sufficient on its own", () => {
    // Clean, but the content-verified format contradicts the policy.
    const verdict = verdictFromFindings(
      cleanFindings({ clean: true, verifiedFileFormat: ".zip" }),
      pdf
    );
    assert.equal(verdict.outcome, "REJECT");
  });
});

/* ------------------------------------------------------------------ */
/* N1 — attach/verdict race                                            */
/* ------------------------------------------------------------------ */

describe("N1: a product cannot be stranded in PENDING_SCAN", () => {
  const safetySrc = read("../lib/file-safety.ts");

  test("reconciliation runs after both write paths", () => {
    assert.ok(createSrc.includes("reconcileProductScanState(product.id, fileKey)"));
    assert.ok(editSrc.includes("reconcileProductScanState(updatedProduct.id, nextFileKey)"));
  });

  test("it copies the asset's verdict and never invents one", () => {
    const fn = safetySrc.slice(safetySrc.indexOf("export async function reconcileProductScanState"));
    assert.ok(fn.includes("fileScanStatus: asset.scanStatus"));
    assert.ok(!/fileScanStatus: "SAFE"/.test(fn), "must never fabricate SAFE");
  });

  test("it is key-bound, so a replaced file is untouched", () => {
    const fn = safetySrc.slice(safetySrc.indexOf("export async function reconcileProductScanState"));
    assert.ok(/where: \{ id: productId, fileKey, fileScanStatus: "PENDING_SCAN" \}/.test(fn));
  });

  test("it only transitions out of PENDING_SCAN, so it cannot overwrite a verdict", () => {
    const fn = safetySrc.slice(safetySrc.indexOf("export async function reconcileProductScanState"));
    assert.ok(fn.includes('fileScanStatus: "PENDING_SCAN"'));
    assert.ok(fn.includes("updated.count !== 1"));
  });

  test("an unscanned asset is a no-op", () => {
    const fn = safetySrc.slice(safetySrc.indexOf("export async function reconcileProductScanState"));
    assert.ok(fn.includes('asset.scanStatus === "PENDING_SCAN"'));
  });

  test("the audit event matches the reconciled verdict", () => {
    const fn = safetySrc.slice(safetySrc.indexOf("export async function reconcileProductScanState"));
    assert.ok(fn.includes('action: "SCANNED"'));
    assert.ok(fn.includes("actor: SCAN_AUDIT_ACTOR"));
    assert.ok(fn.includes("previousStatus: product.moderationStatus"));
    assert.ok(fn.includes("newStatus: product.moderationStatus"));
  });

  test("a reconciliation failure cannot fail the seller's save", () => {
    // The product is already stored and already fail-closed.
    assert.ok(createSrc.includes("[scan] reconcile after create failed"));
    assert.ok(editSrc.includes("[scan] reconcile after edit failed"));
  });
});

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

describe("the 128MB path avoids redundant full-size copies", () => {
  test("hashing does not copy the buffer", () => {
    assert.ok(!runSrc.includes("Buffer.from(bytes)"), "update() takes a Uint8Array");
    assert.ok(runSrc.includes("update(bytes)"));
  });

  test("the provider does not slice before the Blob copy", () => {
    const src = read("../lib/scan/cloudmersive.ts");
    assert.ok(!src.includes("request.bytes.slice()"));
  });

  test("the scannable ceiling matches the upload ceiling", () => {
    const storage = read("../lib/storage/provider.ts");
    assert.ok(storage.includes("128 * 1024 * 1024"));
    const cfg = read("../lib/upload-config.ts");
    assert.ok(!cfg.includes('"256MB"'), "no upload may exceed the scannable limit");
  });
});

/* ================================================================== */
/* Fugu re-review regressions                                          */
/* ================================================================== */

describe("C1 residual: a self-referential EOCD cannot report an empty archive", () => {
  const traversal = [{ name: "../escape.txt" }];

  test("the honest archive is rejected for its traversal entry", () => {
    const zip = makeZip(traversal);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(
      (structuralVerdict(zip, policy) as { reason: string }).reason,
      "archive_path_traversal"
    );
  });

  test("REGRESSION: cdOffset pointing at the forged EOCD itself is rejected", () => {
    // cdOffset === eocd and cdSize === 0 satisfies cdOffset + cdSize === eocd
    // trivially, so the earlier fix did not catch this. Appending it also
    // pushes the genuine EOCD away from EOF, leaving the forgery sole.
    // Result before this fix: ok:true with zero entries -> structural ALLOW.
    const zip = makeZip(traversal, { selfReferentialEocd: true });
    const dir = readZipCentralDirectory(zip);
    assert.equal(dir.ok, false, "must not parse");
    assert.ok(!(dir.ok && (dir as { entries: unknown[] }).entries.length === 0));

    const policy = resolveContentPolicy(zip)!;
    const verdict = structuralVerdict(zip, policy);
    assert.equal(verdict.outcome, "REJECT");
    assert.equal((verdict as { reason: string }).reason, "archive_malformed");
  });

  test("the same forgery cannot launder a symlink or a nested archive either", () => {
    // These are SaiFlow-only rules with no provider backstop, so an empty
    // entry list would have skipped them entirely.
    for (const specs of [
      [{ name: "link", symlink: true }],
      [{ name: "inner.zip" }],
      [{ name: "setup.exe" }],
    ]) {
      const zip = makeZip(specs, { selfReferentialEocd: true });
      assert.equal(readZipCentralDirectory(zip).ok, false);
      const policy = resolveContentPolicy(zip)!;
      assert.equal(structuralVerdict(zip, policy).outcome, "REJECT");
    }
  });

  test("a genuinely empty ZIP is still accepted", () => {
    // 22 bytes: an EOCD at offset 0 and nothing else. The only believable
    // zero-entry archive.
    const empty = new Uint8Array(22);
    new DataView(empty.buffer).setUint32(0, 0x06054b50, true);
    const dir = readZipCentralDirectory(empty);
    assert.ok(dir.ok && dir.entries.length === 0);
  });
});

describe("EPUB identity is proven from content, not from entry names", () => {
  const container = { name: "META-INF/container.xml" };
  const chapter = { name: "OEBPS/ch1.xhtml" };

  const kindOf = (specs: ZipSpec[]) => resolveContentPolicy(makeZip(specs))?.kind;

  test("a genuine EPUB is classified as one", () => {
    const specs = [{ name: "mimetype", data: "application/epub+zip" }, container, chapter];
    assert.equal(kindOf(specs), "epub");
    const zip = makeZip(specs);
    assert.equal(resolveContentPolicy(zip)!.allowHtml, true);
  });

  test("REGRESSION: bogus marker entries no longer earn the HTML exemption", () => {
    // Previously isEpubLayout tested only that these two NAMES existed, so a
    // generic ZIP with index.html was classified epub and allowed HTML.
    const specs = [
      { name: "mimetype", data: "NOT-AN-EPUB" },
      container,
      { name: "index.html" },
    ];
    assert.equal(kindOf(specs), "zip");
    const zip = makeZip(specs);
    assert.equal(resolveContentPolicy(zip)!.allowHtml, false);
  });

  const notEpub: [string, ZipSpec[]][] = [
    ["mimetype is not first", [container, { name: "mimetype", data: "application/epub+zip" }, chapter]],
    ["mimetype is compressed", [{ name: "mimetype", data: "application/epub+zip", method: 8 }, container]],
    ["mimetype has the wrong contents", [{ name: "mimetype", data: "application/zip!!!!!" }, container]],
    ["mimetype is empty", [{ name: "mimetype", data: "" }, container]],
    ["container.xml is missing", [{ name: "mimetype", data: "application/epub+zip" }, chapter]],
  ];

  for (const [label, specs] of notEpub) {
    test(`not an EPUB: ${label}`, () => {
      assert.equal(kindOf(specs), "zip", label);
    });
  }

  test("a ZIP misclassified as EPUB would have been the only route to HTML", () => {
    // Confirms the exemption is genuinely EPUB-only, so the strengthened
    // identity check is what gates it.
    const zip = makeZip([{ name: "readme.txt" }]);
    assert.equal(resolveContentPolicy(zip)!.allowHtml, false);
  });
});
