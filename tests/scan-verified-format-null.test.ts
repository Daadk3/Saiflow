/**
 * VerifiedFileFormat is nullable, and null must REJECT rather than error.
 *
 * Cloudmersive documents VerifiedFileFormat as null in two ordinary cases:
 * the format is not supported for contents verification, and a virus or
 * malware was found. The parser previously required a non-empty string, so
 * both were recorded as SCAN_ERROR — a malware detection presented as a
 * scanner outage, retried to the attempt ceiling, and never surfaced as
 * unsafe.
 *
 * The fix parses null and lets POLICY refuse it. The whole burden of these
 * tests is that the refusal is total: this file exists to prove that no input
 * carrying a null format can produce SAFE, not merely that the common cases
 * behave.
 *
 * The provider is never called. `globalThis.fetch` is replaced per test and
 * the key is a local fake.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { cloudmersiveProvider } from "../lib/scan/cloudmersive";
import {
  formatMatchesPolicy,
  resolveContentPolicy,
  verdictFromFindings,
  type ContentPolicy,
} from "../lib/scan/policy";
import type { ScanFindings, ScanRequest } from "../lib/scan/provider";

const FAKE_KEY = "test-only-not-a-real-cloudmersive-key";

/**
 * "%PDF" followed by padding. The magic alone is not enough: sniffFormat
 * refuses anything under 12 bytes outright, so a 4-byte fixture sniffs as
 * "unknown" and resolveContentPolicy returns null.
 */
const PDF_BYTES = (() => {
  const b = new Uint8Array(16);
  b.set([0x25, 0x50, 0x44, 0x46]); // %PDF
  return b;
})();

const REQUEST: ScanRequest = {
  bytes: PDF_BYTES,
  fileName: "sample.pdf",
  restrictToExtensions: [".pdf"],
  allowHtml: false,
};

const PDF_POLICY = resolveContentPolicy(PDF_BYTES) as ContentPolicy;

const THREAT_FLAGS = [
  "ContainsExecutable",
  "ContainsInvalidFile",
  "ContainsScript",
  "ContainsPasswordProtectedFile",
  "ContainsRestrictedFileFormat",
  "ContainsMacros",
  "ContainsXmlExternalEntities",
  "ContainsInsecureDeserialization",
  "ContainsHtml",
  "ContainsUnsafeArchive",
  "ContainsOleEmbeddedObject",
] as const;

/** A complete, well-formed response. Overrides applied on top. */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    CleanResult: true,
    VerifiedFileFormat: ".pdf",
    FoundViruses: null,
  };
  for (const f of THREAT_FLAGS) base[f] = false;
  return { ...base, ...over };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CLOUDMERSIVE_API_KEY;
});

async function scan(body: unknown) {
  process.env.CLOUDMERSIVE_API_KEY = FAKE_KEY;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  return cloudmersiveProvider.scan(REQUEST);
}

/** Parse, then apply policy. Mirrors what scanFileAsset does after a scan. */
async function outcome(
  body: unknown
): Promise<{ parsed: boolean; verdict?: string; findings?: ScanFindings }> {
  const res = await scan(body);
  if (!res.ok) return { parsed: false };
  const v = verdictFromFindings(res.findings, PDF_POLICY);
  return {
    parsed: true,
    verdict: v.outcome === "ALLOW" ? "ALLOW" : `REJECT:${v.reason}`,
    findings: res.findings,
  };
}

/* ------------------------------------------------------------------ */
/* The two documented null cases                                       */
/* ------------------------------------------------------------------ */

describe("a null format now reaches a verdict instead of an error", () => {
  test("malware + null format -> UNSAFE malware, not SCAN_ERROR", async () => {
    // The case that mattered. Cloudmersive nulls the format when it finds
    // something, so this used to be indistinguishable from a broken provider.
    const r = await outcome(
      payload({
        CleanResult: false,
        VerifiedFileFormat: null,
        FoundViruses: [{ FileName: "x.pdf", VirusName: "Eicar-Test-Signature" }],
      })
    );
    assert.equal(r.parsed, true, "a documented response must parse");
    assert.equal(r.verdict, "REJECT:malware");
    assert.deepEqual(r.findings?.virusNames, ["Eicar-Test-Signature"]);
  });

  test("clean + null format -> UNSAFE format_mismatch, never SAFE", async () => {
    const r = await outcome(payload({ VerifiedFileFormat: null }));
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "REJECT:format_mismatch");
  });

  test("absent format is treated exactly as null", async () => {
    // Every field is documented optional, so absence carries the same meaning.
    const body = payload();
    delete body.VerifiedFileFormat;
    const r = await outcome(body);
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "REJECT:format_mismatch");
    assert.equal(r.findings?.verifiedFileFormat, null);
  });

  test("empty and whitespace-only formats normalise to null", async () => {
    for (const value of ["", "   ", "\t\n"]) {
      const r = await outcome(payload({ VerifiedFileFormat: value }));
      assert.equal(r.parsed, true, `"${value}" should parse`);
      assert.equal(r.findings?.verifiedFileFormat, null);
      assert.notEqual(r.verdict, "ALLOW");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Null never reaches ALLOW — exhaustively                             */
/* ------------------------------------------------------------------ */

describe("NO null-format input can produce SAFE", () => {
  test("null format with every threat flag individually set", async () => {
    for (const flag of THREAT_FLAGS) {
      const r = await outcome(
        payload({ VerifiedFileFormat: null, [flag]: true })
      );
      assert.equal(r.parsed, true, flag);
      assert.ok(r.verdict?.startsWith("REJECT:"), `${flag} must reject`);
    }
  });

  test("null format across every CleanResult / flag combination", async () => {
    // 2 (clean) x 12 (no flag, or one of 11) = 24 fixtures, none may ALLOW.
    let checked = 0;
    for (const clean of [true, false]) {
      for (const flag of [null, ...THREAT_FLAGS]) {
        const over: Record<string, unknown> = {
          CleanResult: clean,
          VerifiedFileFormat: null,
        };
        if (flag) over[flag] = true;
        const r = await outcome(payload(over));
        assert.equal(r.parsed, true);
        assert.notEqual(r.verdict, "ALLOW", JSON.stringify({ clean, flag }));
        checked++;
      }
    }
    assert.equal(checked, 24);
  });

  test("formatMatchesPolicy refuses null for every policy", async () => {
    // The single line the guarantee rests on.
    for (const bytes of [PDF_BYTES]) {
      const policy = resolveContentPolicy(bytes) as ContentPolicy;
      assert.equal(formatMatchesPolicy(null, policy), false);
    }
    assert.equal(formatMatchesPolicy(null, { restrictToExtensions: [] }), false);
    assert.equal(
      formatMatchesPolicy(null, { restrictToExtensions: [".pdf", ".epub"] }),
      false
    );
  });

  test("null is not treated as a wildcard", async () => {
    // A null must not match even when the policy would accept the real format.
    assert.equal(formatMatchesPolicy(".pdf", PDF_POLICY), true);
    assert.equal(formatMatchesPolicy(null, PDF_POLICY), false);
  });
});

/* ------------------------------------------------------------------ */
/* Nothing else was loosened                                           */
/* ------------------------------------------------------------------ */

describe("the strict checks around it are unchanged", () => {
  test("a wrong-typed format is still a parse failure", async () => {
    for (const value of [42, {}, [], true, 0, -1]) {
      const res = await scan(payload({ VerifiedFileFormat: value }));
      assert.equal(res.ok, false, JSON.stringify(value));
      assert.equal(
        res.ok === false && res.failure,
        "bad_response",
        JSON.stringify(value)
      );
    }
  });

  test("CleanResult is still strictly required", async () => {
    const missing = payload();
    delete missing.CleanResult;
    assert.equal((await scan(missing)).ok, false);
    assert.equal((await scan(payload({ CleanResult: "true" }))).ok, false);
    assert.equal((await scan(payload({ CleanResult: null }))).ok, false);
  });

  test("every threat flag is still strictly required", async () => {
    for (const flag of THREAT_FLAGS) {
      const missing = payload();
      delete missing[flag];
      assert.equal((await scan(missing)).ok, false, `missing ${flag}`);
      assert.equal(
        (await scan(payload({ [flag]: "false" }))).ok,
        false,
        `string ${flag}`
      );
    }
  });

  test("a complete clean response still passes — no regression", async () => {
    const r = await outcome(payload());
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "ALLOW");
    assert.equal(r.findings?.verifiedFileFormat, ".pdf");
  });

  test("a format that disagrees with the sniffed policy still rejects", async () => {
    const r = await outcome(payload({ VerifiedFileFormat: ".docx" }));
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "REJECT:format_mismatch");
  });

  test("malware with a VALID format still rejects as malware", async () => {
    const r = await outcome(payload({ CleanResult: false }));
    assert.equal(r.verdict, "REJECT:malware");
  });

  test("the SAFE set is exactly as narrow as before", async () => {
    // ALLOW requires: clean, no threat flag, and a format that matches. Drop
    // any one of the three and it must reject.
    assert.equal((await outcome(payload())).verdict, "ALLOW");
    assert.notEqual((await outcome(payload({ CleanResult: false }))).verdict, "ALLOW");
    assert.notEqual(
      (await outcome(payload({ ContainsScript: true }))).verdict,
      "ALLOW"
    );
    assert.notEqual(
      (await outcome(payload({ VerifiedFileFormat: null }))).verdict,
      "ALLOW"
    );
    assert.notEqual(
      (await outcome(payload({ VerifiedFileFormat: ".exe" }))).verdict,
      "ALLOW"
    );
  });
});
