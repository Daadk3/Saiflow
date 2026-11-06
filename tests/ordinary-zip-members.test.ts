/**
 * Ordinary ZIP member whitelist.
 *
 * Structural policy already allows a ZIP of Markdown, text, and PDF. The
 * provider request used to send only `.zip`, and Cloudmersive applies that
 * list to members, so those members came back as ContainsRestrictedFileFormat
 * and the product was stored UNSAFE / format_mismatch. The admin copy for
 * that reason is "The file format is not one SaiFlow can sell…".
 *
 * The fix names the accepted member extensions on the provider request for
 * kind "zip" only. It does not ignore the flag, and it does not apply to a
 * local HTML app (that request stays `.zip`, with its own reviewed waiver).
 * No provider is called here.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ORDINARY_ZIP_MEMBER_EXTENSIONS,
  formatMatchesPolicy,
  providerRestrictToExtensions,
  resolveContentPolicy,
  structuralVerdict,
  verdictFromFindings,
} from "@/lib/scan/policy";
import type { ScanFindings } from "@/lib/scan/provider";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

function makeZip(entries: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder();
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

describe("ordinary MD/PDF and MD/TXT ZIPs", () => {
  const mdPdf = makeZip([
    { name: "guide/setup-guide-ar.md", data: "دليل الإعداد للمشتري، بلا روابط." },
    { name: "prompt-pack/prompt-pack-ar.pdf", data: "%PDF-1.4 synthetic member" },
  ]);
  const mdTxt = makeZip([
    { name: "README.md", data: "Store guide readme for the buyer." },
    { name: "create-agent.txt", data: "Plain text steps. No script." },
    { name: "knowledge-base.md", data: "Knowledge base." },
    { name: "setup-guide.md", data: "Setup." },
    { name: "system-prompt.md", data: "Prompt text, not a program." },
    { name: "test-cases.md", data: "Cases." },
  ]);

  for (const [label, zip] of [
    ["MD and PDF", mdPdf],
    ["MD and TXT", mdTxt],
  ] as const) {
    test(`${label}: structural ALLOW, ordinary zip, members named to the provider`, () => {
      const policy = resolveContentPolicy(zip);
      assert.ok(policy);
      assert.equal(policy.kind, "zip");
      assert.deepEqual(policy.restrictToExtensions, [".zip"]);
      assert.equal(policy.allowHtml, false);
      assert.notEqual(policy.allowScripts, true);
      assert.deepEqual(structuralVerdict(zip, policy), { outcome: "ALLOW" });
      const sent = providerRestrictToExtensions(policy);
      assert.ok(sent.includes(".zip"));
      assert.ok(sent.includes(".md"));
      if (label === "MD and PDF") assert.ok(sent.includes(".pdf"));
      if (label === "MD and TXT") assert.ok(sent.includes(".txt"));
      assert.equal(formatMatchesPolicy(".zip", policy), true);
      assert.equal(formatMatchesPolicy(".pdf", policy), false);
      assert.equal(formatMatchesPolicy(".md", policy), false);
    });
  }

  test("a clean provider result for that container is ALLOW, and it is not SAFE by itself", () => {
    const policy = resolveContentPolicy(mdTxt)!;
    assert.deepEqual(verdictFromFindings(findings(), policy), { outcome: "ALLOW" });
    // ALLOW here is the provider-policy function. SAFE is a later persisted
    // verdict bound to a storage key. This test never calls a provider.
  });

  test("ContainsRestrictedFileFormat is still format_mismatch", () => {
    const policy = resolveContentPolicy(mdPdf)!;
    assert.deepEqual(
      verdictFromFindings(findings({ clean: false, containsRestrictedFileFormat: true }), policy),
      { outcome: "REJECT", reason: "format_mismatch" }
    );
  });

  test("malware, script, executable, and HTML stay rejections", () => {
    const policy = resolveContentPolicy(mdTxt)!;
    assert.equal(verdictFromFindings(findings({ virusNames: ["Eicar-Test-Signature"] }), policy).outcome, "REJECT");
    assert.deepEqual(verdictFromFindings(findings({ clean: false, containsScript: true }), policy), {
      outcome: "REJECT",
      reason: "script",
    });
    assert.deepEqual(verdictFromFindings(findings({ clean: false, containsExecutable: true }), policy), {
      outcome: "REJECT",
      reason: "executable",
    });
    assert.deepEqual(verdictFromFindings(findings({ clean: false, containsHtml: true }), policy), {
      outcome: "REJECT",
      reason: "html_content",
    });
  });

  test("a .py member is still archive_script before any provider call", () => {
    const zip = makeZip([{ name: "prompt-pack/build_pdf.py", data: "print(1)\n" }, { name: "notes.md", data: "x" }]);
    const policy = resolveContentPolicy(zip)!;
    assert.equal(policy.kind, "zip");
    const verdict = structuralVerdict(zip, policy);
    assert.deepEqual(verdict, { outcome: "REJECT", reason: "archive_script" });
    assert.ok(!ORDINARY_ZIP_MEMBER_EXTENSIONS.includes(".py" as never));
  });

  test("a local HTML app keeps its own .zip-only provider list", () => {
    const local = {
      kind: "local_html_app" as const,
      restrictToExtensions: [".zip"],
      allowHtml: true,
      allowScripts: true,
    };
    assert.deepEqual(providerRestrictToExtensions(local), [".zip"]);
    assert.ok(!providerRestrictToExtensions(local).includes(".md"));
    assert.ok(!providerRestrictToExtensions(local).includes(".html"));
    assert.ok(!providerRestrictToExtensions(local).includes(".js"));
    const pdf = { kind: "pdf" as const, restrictToExtensions: [".pdf"], allowHtml: false };
    assert.deepEqual(providerRestrictToExtensions(pdf), [".pdf"]);
  });

  test("the worker sends providerRestrictToExtensions, and the admin copy is the format sentence", () => {
    const run = read("lib/scan/run.ts");
    assert.ok(run.includes("providerRestrictToExtensions(policy)"));
    const en = JSON.parse(read("messages/en.json"));
    assert.equal(
      en.admin.fileSafety.blockedBecause.format,
      "The file format is not one SaiFlow can sell, or it does not match its contents. It was not opened."
    );
  });
});
