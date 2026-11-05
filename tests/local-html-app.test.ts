/**
 * The named local HTML app archive.
 *
 * Synthetic ZIPs only. Nothing here reads a creator file, a database, or an
 * environment value. The provider is stubbed the same way the other scan
 * tests stub it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import { extractFileFacts } from "@/lib/file-facts";
import { isLocalHtmlAppReview, LOCAL_HTML_APP_KIND } from "@/lib/local-html-review";
import { computeReviewChecks } from "@/lib/review-checklist";
import { cloudmersiveProvider } from "@/lib/scan/cloudmersive";
import {
  LOCAL_HTML_APP_MARKER_BODY,
  LOCAL_HTML_APP_MARKER_NAME,
} from "@/lib/scan/local-html-app";
import {
  resolveContentPolicy,
  structuralVerdict,
  verdictFromFindings,
} from "@/lib/scan/policy";
import type { ScanFindings } from "@/lib/scan/provider";
import { explainScanReason } from "@/lib/scan-explanation";
import { failureCategory } from "@/lib/seller-file-state";
import { PRODUCT_FILE_CONFIG } from "@/lib/upload-config";
import { decideUpload } from "@/lib/upload-accept";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

interface ZipSpec {
  name: string;
  data?: string;
  method?: number;
  encrypted?: boolean;
  symlink?: boolean;
  compressedSize?: number;
  uncompressedSize?: number;
}

/** A real ZIP the hardened parser will accept. Method 8 is actually deflated. */
function makeZip(specs: ZipSpec[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const cds: Uint8Array[] = [];
  let offset = 0;

  for (const spec of specs) {
    const name = enc.encode(spec.name);
    const raw = spec.data !== undefined ? enc.encode(spec.data) : new Uint8Array(8);
    const method = spec.method ?? 0;
    const stored = method === 8 ? deflateRawSync(raw) : raw;
    const compressedSize = spec.compressedSize ?? stored.byteLength;
    const uncompressedSize = spec.uncompressedSize ?? raw.byteLength;

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(6, spec.encrypted ? 1 : 0, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, stored.byteLength, true);
    localView.setUint32(22, uncompressedSize, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(8, spec.encrypted ? 1 : 0, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, compressedSize, true);
    centralView.setUint32(24, uncompressedSize, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(38, (((spec.symlink ? 0xa1ff : 0x81a4) << 16) >>> 0), true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, stored);
    cds.push(central);
    offset += local.length + stored.byteLength;
  }

  const cat = (parts: Uint8Array[]) => {
    const total = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let cursor = 0;
    for (const part of parts) {
      total.set(part, cursor);
      cursor += part.byteLength;
    }
    return total;
  };

  const localPart = cat(locals);
  const centralPart = cat(cds);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, specs.length, true);
  eocdView.setUint16(10, specs.length, true);
  eocdView.setUint32(12, centralPart.byteLength, true);
  eocdView.setUint32(16, localPart.byteLength, true);
  return cat([localPart, centralPart, eocd]);
}

const marker = (data = LOCAL_HTML_APP_MARKER_BODY, extra: Partial<ZipSpec> = {}): ZipSpec => ({
  name: LOCAL_HTML_APP_MARKER_NAME,
  data,
  ...extra,
});

const PAGE = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="app.css"></head><body><h1>عيادة</h1><script src="app.js"></script></body></html>`;
const CSS = "body { color: #222; font-family: sans-serif; }";
const JS = 'document.documentElement.lang = "ar";\n';
const README = "# عيادة\nLocal notes for the reviewer.\n";

function app(extra: ZipSpec[] = [], page = PAGE): ZipSpec[] {
  return [
    marker(),
    { name: "index.html", data: page },
    { name: "app.css", data: CSS },
    { name: "app.js", data: JS },
    { name: "README.md", data: README },
    { name: "data/clinic.json", data: '{"rooms":[]}' },
    { name: "notes/copy.txt", data: "نسخة محلية" },
    ...extra,
  ];
}

function reason(bytes: Uint8Array): string {
  const policy = resolveContentPolicy(bytes);
  assert.ok(policy, "bytes were not a recognised archive");
  const verdict = structuralVerdict(bytes, policy!);
  assert.equal(verdict.outcome, "REJECT");
  return verdict.outcome === "REJECT" ? verdict.reason : "";
}

const findings = (over: Partial<ScanFindings> = {}): ScanFindings => ({
  clean: true,
  verifiedFileFormat: ".zip",
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

describe("a local HTML app is its own archive type", () => {
  test("a safe static-and-script app is allowed and is not an EPUB", () => {
    const zip = makeZip(app());
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "local_html_app");
    assert.equal(policy.kind === LOCAL_HTML_APP_KIND, true);
    assert.deepEqual(policy.restrictToExtensions, [".zip"]);
    assert.equal(policy.allowHtml, true);
    assert.equal(policy.allowScripts, true);
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
    assert.equal(extractFileFacts(zip).kind, "local_html_app");
  });

  test("JavaScript is optional: HTML, CSS, JSON, Markdown and text are enough", () => {
    const zip = makeZip([
      marker(),
      { name: "index.html", data: "<!DOCTYPE html><html lang=\"ar\"><body><p>عيادة</p></body></html>" },
      { name: "app.css", data: CSS },
      { name: "README.md", data: README },
      { name: "copy.txt", data: "نص" },
      { name: "clinic.json", data: "{}" },
    ]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "local_html_app");
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
  });

  test("a nested copy of the marker does not opt a ZIP in", () => {
    const zip = makeZip([
      { name: "docs/saiflow-local-html-app.json", data: LOCAL_HTML_APP_MARKER_BODY },
      { name: "index.html", data: "<p>hi</p>" },
    ]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "zip");
    assert.equal(policy.allowHtml, false);
    assert.notEqual(policy.allowScripts, true);
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
  });

  const badMarker: [string, ZipSpec][] = [
    ["pretty printed", marker('{\n  "saiflowArchiveType": "local-html-app",\n  "version": 1\n}\n')],
    ["extra field", marker('{"saiflowArchiveType":"local-html-app","version":1,"extra":true}')],
    ["wrong version", marker('{"saiflowArchiveType":"local-html-app","version":2}')],
    ["compressed", marker(LOCAL_HTML_APP_MARKER_BODY, { method: 8 })],
  ];

  for (const [label, entry] of badMarker) {
    test(`a ${label} marker does not grant the HTML exemption`, () => {
      const zip = makeZip([entry, { name: "index.html", data: "<p>hi</p>" }]);
      const policy = resolveContentPolicy(zip)!;
      assert.equal(policy.kind, "zip", label);
      assert.equal(policy.allowHtml, false, label);
      assert.equal(reason(zip), "archive_type_marker", label);
    });
  }

  test("two marker entries are invalid", () => {
    const zip = makeZip([marker(), marker(), { name: "index.html", data: "<p>hi</p>" }]);
    assert.equal(resolveContentPolicy(zip)!.kind, "zip");
    assert.equal(reason(zip), "archive_type_marker");
  });

  test("the marker without an HTML page is not this product", () => {
    const zip = makeZip([marker(), { name: "README.md", data: "notes" }]);
    assert.equal(resolveContentPolicy(zip)!.kind, "local_html_app");
    assert.equal(reason(zip), "archive_not_html_app");
  });

  test("an EPUB that also carries the marker stays an EPUB and still rejects script", () => {
    const epub = makeZip([
      { name: "mimetype", data: "application/epub+zip" },
      { name: "META-INF/container.xml", data: "<container/>" },
      marker(),
      { name: "OEBPS/ch1.xhtml", data: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>فصل</body></html>" },
      { name: "OEBPS/app.js", data: JS },
    ]);
    const policy = resolveContentPolicy(epub)!;
    assert.equal(policy.kind, "epub");
    assert.equal(policy.allowHtml, true);
    assert.notEqual(policy.allowScripts, true);
    assert.equal(reason(epub), "archive_script");
    assert.equal(extractFileFacts(epub).kind, "zip");
  });

  test("a hand-built local-HTML policy cannot be applied to an ordinary ZIP", () => {
    const zip = makeZip([{ name: "index.html", data: "<p>hi</p>" }]);
    const verdict = structuralVerdict(zip, {
      kind: "local_html_app",
      restrictToExtensions: [".zip"],
      allowHtml: true,
      allowScripts: true,
    });
    assert.equal(verdict.outcome, "REJECT");
    assert.equal(verdict.outcome === "REJECT" && verdict.reason, "archive_type_marker");
  });
});

describe("member rules reject scripts, traversal, executables and active HTML", () => {
  const cases: [string, ZipSpec, string][] = [
    ["python", { name: "run.py", data: "print(1)\n" }, "archive_script"],
    ["shell", { name: "install.sh", data: "echo hi\n" }, "archive_script"],
    ["php", { name: "index.php", data: "<?php echo 1;\n" }, "archive_script"],
    ["module", { name: "app.mjs", data: JS }, "archive_script"],
    ["commonjs", { name: "app.cjs", data: JS }, "archive_script"],
    ["executable", { name: "setup.exe", data: "MZ" }, "archive_executable"],
    ["nested archive", { name: "inner.zip", data: "PK" }, "archive_nested"],
    ["traversal", { name: "../escape.txt", data: "x" }, "archive_path_traversal"],
    ["symlink", { name: "link", symlink: true, data: "index.html" }, "archive_symlink"],
    ["encrypted", { name: "secret.txt", encrypted: true, data: "hidden" }, "archive_encrypted"],
    ["image", { name: "logo.png", data: "not-really" }, "archive_member_type"],
    ["svg", { name: "icon.svg", data: "<svg></svg>" }, "archive_member_type"],
  ];

  for (const [label, entry, expected] of cases) {
    test(`${label} is rejected as ${expected}`, () => {
      assert.equal(reason(makeZip(app([entry]))), expected);
    });
  }

  test("a decompression bomb is still a bomb when the marker is present", () => {
    const zip = makeZip(app([{
      name: "big.txt",
      data: "x",
      compressedSize: 1000,
      uncompressedSize: 900_000_000,
    }]));
    assert.equal(reason(zip), "archive_decompression_bomb");
  });

  test("an invalid marker does not hide an executable", () => {
    const zip = makeZip([
      marker("not-the-contract"),
      { name: "setup.exe", data: "MZ" },
    ]);
    assert.equal(reason(zip), "archive_executable");
  });

  const active: [string, string][] = [
    ["inline script", "<script>alert(1)</script>"],
    ["remote script", '<script src="https://evil.example/app.js"></script>'],
    ["protocol-relative script", '<script src="//evil.example/app.js"></script>'],
    ["module script", '<script type="module" src="app.js"></script>'],
    ["event handler", '<button onclick="alert(1)">go</button>'],
    ["javascript url", '<a href="javascript:alert(1)">go</a>'],
    ["iframe", '<iframe src="app.html"></iframe>'],
    ["missing script target", '<script src="missing.js"></script>'],
  ];

  for (const [label, body] of active) {
    test(`HTML with ${label} is rejected`, () => {
      const page = `<!DOCTYPE html><html><head><link rel="stylesheet" href="app.css"></head><body>${body}</body></html>`;
      assert.equal(reason(makeZip(app([], page))), "archive_active_html");
    });
  }

  test("deflated HTML cannot hide an inline script", () => {
    const zip = makeZip([
      marker(),
      { name: "index.html", data: "<script>alert(1)</script>", method: 8 },
    ]);
    assert.equal(resolveContentPolicy(zip)!.kind, "local_html_app");
    assert.equal(reason(zip), "archive_active_html");
  });

  test("a script in a subdirectory is allowed when the page points at it", () => {
    const zip = makeZip([
      marker(),
      {
        name: "pages/index.html",
        data: '<link rel="stylesheet" href="../app.css"><script src="../app.js"></script><p>عيادة</p>',
      },
      { name: "app.css", data: CSS },
      { name: "app.js", data: JS },
    ]);
    assert.deepEqual(structuralVerdict(zip, resolveContentPolicy(zip)!), { outcome: "ALLOW" });
  });

  const scripts: [string, string][] = [
    ["shebang", "#!/usr/bin/env node\nconsole.log(1)\n"],
    ["require", 'require("fs")\n'],
    ["import", 'import x from "./app.js"\n'],
    ["eval", "eval('alert(1)')\n"],
    ["worker", 'new Worker("app.js")\n'],
  ];

  for (const [label, source] of scripts) {
    test(`browser JS that uses ${label} is rejected`, () => {
      const zip = makeZip([
        marker(),
        { name: "index.html", data: '<script src="app.js"></script>' },
        { name: "app.js", data: source },
      ]);
      assert.equal(reason(zip), "archive_script");
    });
  }

  test("CSS expression() and a remote url are rejected", () => {
    for (const css of [
      "div { width: expression(alert(1)); }",
      "body { background: url(https://evil.example/a.png); }",
    ]) {
      const zip = makeZip([
        marker(),
        { name: "index.html", data: '<link rel="stylesheet" href="app.css"><p>عيادة</p>' },
        { name: "app.css", data: css },
      ]);
      assert.equal(reason(zip), "archive_active_html");
    }
  });
});

describe("ordinary ZIP and PDF policy is unchanged", () => {
  test("a plain ZIP of an image and a text file is still allowed, without HTML or scripts", () => {
    const zip = makeZip([
      { name: "artwork.png", data: "png" },
      { name: "notes/readme.txt", data: "hello" },
    ]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "zip");
    assert.equal(policy.allowHtml, false);
    assert.notEqual(policy.allowScripts, true);
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
    assert.equal(extractFileFacts(zip).kind, "zip");
  });

  test("HTML inside a plain ZIP is not structurally extension-blocked, and still fails the HTML finding", () => {
    const zip = makeZip([{ name: "index.html", data: "<p>hi</p>" }]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "zip");
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
    const verdict = verdictFromFindings(findings({ containsHtml: true }), policy);
    assert.equal(verdict.outcome, "REJECT");
    assert.equal(verdict.outcome === "REJECT" && verdict.reason, "html_content");
  });

  test("a plain ZIP still rejects .js before the provider", () => {
    const zip = makeZip([{ name: "app.js", data: JS }]);
    assert.equal(resolveContentPolicy(zip)!.kind, "zip");
    assert.equal(reason(zip), "archive_script");
  });

  test("a PDF is still a PDF", () => {
    const bytes = new Uint8Array(16);
    bytes.set([0x25, 0x50, 0x44, 0x46]);
    const policy = resolveContentPolicy(bytes)!;
    assert.equal(policy.kind, "pdf");
    assert.equal(policy.allowHtml, false);
    assert.notEqual(policy.allowScripts, true);
  });

  test("standalone HTML is still refused at upload", () => {
    assert.equal(Object.prototype.hasOwnProperty.call(PRODUCT_FILE_CONFIG, "text/html"), false);
    const decision = decideUpload(PRODUCT_FILE_CONFIG, {
      name: "index.html",
      size: 32,
      type: "text/html",
    });
    assert.equal(decision.ok, false);
  });
});

describe("provider findings stay strict apart from the named exceptions", () => {
  test("HTML and classic script findings are allowed only under this policy", () => {
    const zip = makeZip(app());
    const policy = resolveContentPolicy(zip)!;
    assert.equal(
      verdictFromFindings(findings({ containsHtml: true, containsScript: true }), policy).outcome,
      "ALLOW"
    );
    const plain = resolveContentPolicy(makeZip([{ name: "readme.txt", data: "hi" }]))!;
    assert.equal(
      verdictFromFindings(findings({ containsScript: true }), plain).outcome,
      "REJECT"
    );
  });

  const stillRejected: [string, Partial<ScanFindings>, string][] = [
    ["malware", { clean: false, virusNames: ["Eicar-Test-Signature"] }, "malware"],
    ["executable", { containsExecutable: true }, "executable"],
    ["macros", { containsMacros: true }, "macros"],
    ["unsafe archive", { containsUnsafeArchive: true }, "unsafe_archive"],
    ["format reported as epub", { verifiedFileFormat: ".epub" }, "format_mismatch"],
  ];

  for (const [label, over, expected] of stillRejected) {
    test(`${label} is still rejected for a local HTML app`, () => {
      const policy = resolveContentPolicy(makeZip(app()))!;
      const verdict = verdictFromFindings(findings(over), policy);
      assert.equal(verdict.outcome, "REJECT");
      assert.equal(verdict.outcome === "REJECT" && verdict.reason, expected);
    });
  }

  test("Cloudmersive is asked to allow HTML and scripts only when the policy says so", async () => {
    const previousKey = process.env.CLOUDMERSIVE_API_KEY;
    const previousFetch = globalThis.fetch;
    process.env.CLOUDMERSIVE_API_KEY = "test-key-not-a-real-secret";
    const seen: Array<Record<string, string>> = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return new Response(JSON.stringify({
        CleanResult: true,
        ContainsExecutable: false,
        ContainsHtml: false,
        ContainsInsecureDeserialization: false,
        ContainsInvalidFile: false,
        ContainsMacros: false,
        ContainsOleEmbeddedObject: false,
        ContainsPasswordProtectedFile: false,
        ContainsRestrictedFileFormat: false,
        ContainsScript: false,
        ContainsUnsafeArchive: false,
        ContainsXmlExternalEntities: false,
        FoundViruses: null,
        VerifiedFileFormat: ".zip",
      }), { status: 200 });
    }) as typeof fetch;
    try {
      const policy = resolveContentPolicy(makeZip(app()))!;
      await cloudmersiveProvider.scan({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "clinic.zip",
        restrictToExtensions: policy.restrictToExtensions,
        allowHtml: policy.allowHtml,
        allowScripts: policy.allowScripts,
      });
      await cloudmersiveProvider.scan({
        bytes: new Uint8Array([1, 2, 3]),
        fileName: "notes.zip",
        restrictToExtensions: [".zip"],
        allowHtml: false,
      });
      assert.equal(seen[0].allowhtml, "true");
      assert.equal(seen[0].allowscripts, "true");
      assert.equal(seen[0].allowexecutables, "false");
      assert.equal(seen[0].allowmacros, "false");
      assert.equal(seen[1].allowhtml, "false");
      assert.equal(seen[1].allowscripts, "false");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.CLOUDMERSIVE_API_KEY;
      else process.env.CLOUDMERSIVE_API_KEY = previousKey;
    }
  });
});

describe("Cloudmersive HTML, script, and ZIP-whitelist flags on a local HTML app", () => {
  /** The provider shape for inner HTML/CSS/JS against restrictFileTypes=.zip. */
  const providerShape = (over: Partial<ScanFindings> = {}): ScanFindings =>
    findings({
      clean: false,
      verifiedFileFormat: ".zip",
      containsHtml: true,
      containsScript: true,
      containsRestrictedFileFormat: true,
      ...over,
    });

  function passedPolicy() {
    const zip = makeZip(app());
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "local_html_app");
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
    return policy;
  }

  test("a structurally safe app is not rejected for the whitelist or for CleanResult false", () => {
    const policy = passedPolicy();
    assert.deepEqual(verdictFromFindings(providerShape(), policy), { outcome: "ALLOW" });
    assert.deepEqual(
      verdictFromFindings(providerShape({ clean: true }), policy),
      { outcome: "ALLOW" }
    );
    assert.deepEqual(
      verdictFromFindings(providerShape({ verifiedFileFormat: "zip" }), policy),
      { outcome: "ALLOW" }
    );
  });

  test("each allowed flag on its own explains CleanResult false when the container is a ZIP", () => {
    const policy = passedPolicy();
    for (const over of [
      { containsHtml: true, containsScript: false, containsRestrictedFileFormat: false },
      { containsHtml: false, containsScript: true, containsRestrictedFileFormat: false },
      { containsHtml: false, containsScript: false, containsRestrictedFileFormat: true },
    ]) {
      assert.deepEqual(verdictFromFindings(providerShape(over), policy), { outcome: "ALLOW" }, JSON.stringify(over));
    }
  });

  test("a bare CleanResult false, with none of those flags, stays unattributed", () => {
    const policy = passedPolicy();
    const verdict = verdictFromFindings(
      providerShape({
        containsHtml: false,
        containsScript: false,
        containsRestrictedFileFormat: false,
        verifiedFileFormat: ".zip",
      }),
      policy
    );
    assert.deepEqual(verdict, { outcome: "REJECT", reason: "not_clean_unattributed" });
    const unverified = verdictFromFindings(
      providerShape({
        containsHtml: false,
        containsScript: false,
        containsRestrictedFileFormat: false,
        verifiedFileFormat: null,
      }),
      policy
    );
    assert.deepEqual(unverified, { outcome: "REJECT", reason: "not_clean_unattributed" });
  });

  test("a restricted-format flag is still a mismatch when the container is not a ZIP", () => {
    const policy = passedPolicy();
    for (const verifiedFileFormat of [".epub", ".html", ".js", null]) {
      const verdict = verdictFromFindings(providerShape({ verifiedFileFormat }), policy);
      assert.equal(verdict.outcome, "REJECT", String(verifiedFileFormat));
      assert.equal(verdict.outcome === "REJECT" && verdict.reason, "format_mismatch");
    }
  });

  const namedThreats: [string, Partial<ScanFindings>, string][] = [
    ["malware", { virusNames: ["Eicar-Test-Signature"] }, "malware"],
    ["executable", { containsExecutable: true }, "executable"],
    ["macros", { containsMacros: true }, "macros"],
    ["unsafe archive", { containsUnsafeArchive: true }, "unsafe_archive"],
    ["password protected", { containsPasswordProtectedFile: true }, "password_protected"],
    ["insecure deserialization", { containsInsecureDeserialization: true }, "insecure_deserialization"],
    ["xxe", { containsXmlExternalEntities: true }, "xxe"],
    ["embedded object", { containsOleEmbeddedObject: true }, "ole_embedded_object"],
    ["invalid file", { containsInvalidFile: true }, "malformed_file"],
  ];

  for (const [label, over, expected] of namedThreats) {
    test(`${label} is still rejected when the whitelist flags are also set`, () => {
      const verdict = verdictFromFindings(providerShape(over), passedPolicy());
      assert.deepEqual(verdict, { outcome: "REJECT", reason: expected });
    });
  }

  test("the same provider shape does not pass a plain ZIP, an EPUB, or a PDF", () => {
    const shape = providerShape();
    const plain = resolveContentPolicy(makeZip([{ name: "readme.txt", data: "hi" }]))!;
    assert.equal(plain.kind, "zip");
    assert.deepEqual(verdictFromFindings(shape, plain), { outcome: "REJECT", reason: "script" });
    const epub = { kind: "epub" as const, restrictToExtensions: [".epub"], allowHtml: true };
    assert.equal(verdictFromFindings(shape, epub).outcome, "REJECT");
    assert.deepEqual(
      verdictFromFindings(providerShape({ containsScript: false }), epub),
      { outcome: "REJECT", reason: "format_mismatch" }
    );
    assert.deepEqual(
      verdictFromFindings(
        providerShape({ containsScript: false, containsRestrictedFileFormat: false, verifiedFileFormat: ".epub" }),
        { kind: "epub", restrictToExtensions: [".epub"], allowHtml: true }
      ),
      { outcome: "REJECT", reason: "not_clean_unattributed" }
    );
    assert.deepEqual(
      verdictFromFindings(shape, { kind: "pdf", restrictToExtensions: [".pdf"], allowHtml: false }),
      { outcome: "REJECT", reason: "script" }
    );
    assert.deepEqual(
      verdictFromFindings(
        findings({ clean: false, verifiedFileFormat: ".zip", containsRestrictedFileFormat: true }),
        plain
      ),
      { outcome: "REJECT", reason: "format_mismatch" }
    );
  });

  test("a structural failure is settled before the provider waiver can apply", () => {
    const zip = makeZip([
      marker(),
      { name: "index.html", data: "<script>alert(1)</script>" },
    ]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "local_html_app");
    assert.deepEqual(structuralVerdict(zip, policy), { outcome: "REJECT", reason: "archive_active_html" });
    const run = read("lib/scan/run.ts");
    const structuralAt = run.indexOf('if (structural.outcome === "REJECT")');
    const providerAt = run.indexOf("result = await provider.scan");
    const verdictAt = run.indexOf("verdictFromFindings(result.findings, policy)");
    assert.ok(structuralAt !== -1 && structuralAt < providerAt && providerAt < verdictAt);
  });
});

describe("admins see a review label, and delivery is not rewired", () => {
  test("the checklist names the archive and the risk, and a ZIP does not", () => {
    const input = {
      name: "عيادة",
      description: "وصف طويل بما يكفي لنقطة المراجعة ولا يطلب استضافة.",
      fileKey: "key_a",
      fileScanStatus: "SAFE",
      fileScanKey: "key_a",
      facts: {
        kind: "local_html_app" as const,
        opens: true,
        pageCount: null,
        textChecked: true,
        contact: [],
        banned: [],
      },
    };
    const local = computeReviewChecks(input);
    assert.match(local.points[3].reason, /تطبيق HTML محلي/);
    assert.match(local.points[3].reason, /لا تستضيفه ولا تشغّله/);
    const ordinary = computeReviewChecks({
      ...input,
      facts: { ...input.facts, kind: "zip" },
    });
    assert.equal(ordinary.points[3].reason.includes("تطبيق HTML محلي"), false);
  });

  test("the review flag accepts only the exact kind", () => {
    assert.equal(isLocalHtmlAppReview({ kind: "local_html_app", note: "<script>" }), true);
    assert.equal(isLocalHtmlAppReview({ kind: "local_html_app<script>" }), false);
    assert.equal(isLocalHtmlAppReview({ kind: "zip" }), false);
    assert.equal(isLocalHtmlAppReview(null), false);
    assert.equal(isLocalHtmlAppReview("local_html_app"), false);
  });

  test("seller and admin reasons cover the new rejections", () => {
    assert.equal(failureCategory("archive_active_html"), "unsafe_content");
    assert.equal(failureCategory("archive_script"), "unsafe_content");
    assert.equal(failureCategory("archive_not_html_app"), "unsupported_format");
    assert.equal(failureCategory("archive_member_type"), "archive_problem");
    assert.equal(failureCategory("archive_type_marker"), "archive_problem");
    assert.equal(explainScanReason("archive_active_html"), "script");
    assert.equal(explainScanReason("archive_member_type"), "archive");
    assert.equal(explainScanReason("archive_not_html_app"), "format");
    assert.equal(explainScanReason("html_content"), "html");
  });

  test("classification does not read a product description, and purchase routes are untouched", () => {
    const policy = read("lib/scan/policy.ts");
    const local = read("lib/scan/local-html-app.ts");
    assert.equal(policy.includes("product.description"), false);
    assert.equal(local.includes("product.description"), false);
    assert.equal(typeof resolveContentPolicy, "function");
    assert.equal(resolveContentPolicy.length, 1);
    for (const file of [
      "app/api/checkout/route.ts",
      "app/api/download/[productId]/route.ts",
    ]) {
      const source = read(file);
      assert.equal(source.includes("local_html_app"), false, file);
      assert.equal(source.includes("localHtmlApp"), false, file);
    }
    assert.match(read("lib/scan/run.ts"), /allowScripts: policy\.allowScripts === true/);
    assert.match(read("app/dashboard/admin/products/[id]/preview/page.tsx"), /product\.localHtmlApp/);
    assert.match(read("app/api/admin/moderation/route.ts"), /localHtmlApp:/);
  });
});
