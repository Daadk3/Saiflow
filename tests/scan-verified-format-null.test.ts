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
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { cloudmersiveProvider } from "../lib/scan/cloudmersive";
import {
  formatMatchesPolicy,
  resolveContentPolicy,
  verdictFromFindings,
  type ContentPolicy,
} from "../lib/scan/policy";
import type { ScanFindings, ScanRequest } from "../lib/scan/provider";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const runSrc = read("lib/scan/run.ts");

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
  const verdict =
    v.outcome === "ALLOW"
      ? "ALLOW"
      : v.outcome === "UNVERIFIABLE"
        ? `SCAN_ERROR:${v.reason}`
        : `UNSAFE:${v.reason}`;
  return { parsed: true, verdict, findings: res.findings };
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
    assert.equal(r.verdict, "UNSAFE:malware");
    assert.deepEqual(r.findings?.virusNames, ["Eicar-Test-Signature"]);
  });

  test("clean + null format -> recoverable SCAN_ERROR, never SAFE", async () => {
    // Cloudmersive returns a null format for families outside its content
    // verification coverage — which includes formats SaiFlow sells. Branding
    // those UNSAFE would be permanent and untrue; SCAN_ERROR keeps them
    // unsellable while leaving the state revisitable.
    const r = await outcome(payload({ VerifiedFileFormat: null }));
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "SCAN_ERROR:format_not_verified");
  });

  test("absent format is treated exactly as null", async () => {
    // Every field is documented optional, so absence carries the same meaning.
    const body = payload();
    delete body.VerifiedFileFormat;
    const r = await outcome(body);
    assert.equal(r.parsed, true);
    assert.equal(r.verdict, "SCAN_ERROR:format_not_verified");
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
      assert.ok(r.verdict !== "ALLOW", `${flag} must reject`);
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
    assert.equal(r.verdict, "UNSAFE:format_mismatch");
  });

  test("malware with a VALID format still rejects as malware", async () => {
    const r = await outcome(payload({ CleanResult: false }));
    assert.equal(r.verdict, "UNSAFE:malware");
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
    assert.equal(
      (await outcome(payload({ VerifiedFileFormat: null }))).verdict,
      "SCAN_ERROR:format_not_verified"
    );
    assert.notEqual(
      (await outcome(payload({ VerifiedFileFormat: ".exe" }))).verdict,
      "ALLOW"
    );
  });
});

/* ------------------------------------------------------------------ */
/* The worker maps the third verdict to a recoverable state            */
/* ------------------------------------------------------------------ */

describe("run.ts settles UNVERIFIABLE as SCAN_ERROR, not UNSAFE or SAFE", () => {
  test("UNVERIFIABLE is settled as SCAN_ERROR", () => {
    assert.ok(
      /if \(verdict\.outcome === "UNVERIFIABLE"\) \{\s*return settle\("SCAN_ERROR", verdict\.reason, digest\);/.test(
        runSrc
      ),
      "UNVERIFIABLE must settle SCAN_ERROR carrying its reason"
    );
  });

  test("REJECT still settles UNSAFE", () => {
    assert.ok(
      /if \(verdict\.outcome === "REJECT"\) \{\s*return settle\("UNSAFE", verdict\.reason, digest\);/.test(
        runSrc
      )
    );
  });

  test("SAFE requires an explicit ALLOW — no verdict can fall through to it", () => {
    // The failure mode this guards: adding a fourth outcome later and
    // forgetting to handle it, so it reaches the SAFE line by omission.
    assert.ok(/verdict\.outcome !== "ALLOW"/.test(runSrc));
    assert.ok(/settle\("SCAN_ERROR", "unknown_verdict", digest\)/.test(runSrc));

    const tail = runSrc.slice(runSrc.indexOf("const verdict = verdictFromFindings"));
    const guardAt = tail.indexOf('verdict.outcome !== "ALLOW"');
    const safeAt = tail.indexOf('settle("SAFE"');
    assert.ok(guardAt !== -1 && safeAt !== -1);
    assert.ok(guardAt < safeAt, "the ALLOW guard must precede the SAFE settle");
  });

  test("SAFE is still settled exactly once, with no reason recorded", () => {
    assert.equal((runSrc.match(/settle\("SAFE"/g) ?? []).length, 1);
    assert.ok(/settle\("SAFE", null, digest\)/.test(runSrc));
  });
});

/* ------------------------------------------------------------------ */
/* Untouched machinery                                                 */
/* ------------------------------------------------------------------ */

describe("retry, claim and the delivery gates are unchanged", () => {
  test("the attempt ceiling is still three", () => {
    assert.ok(/export const MAX_SCAN_ATTEMPTS = 3;/.test(runSrc));
  });

  test("claim eligibility still covers exactly PENDING_SCAN and SCAN_ERROR", () => {
    // This is why UNVERIFIABLE -> SCAN_ERROR is revisitable and UNSAFE is not.
    assert.ok(
      /scanStatus: \{ in: \["PENDING_SCAN", "SCAN_ERROR"\] \}/.test(runSrc)
    );
    assert.ok(/scanAttempts: \{ lt: MAX_SCAN_ATTEMPTS \}/.test(runSrc));
  });

  test("a settled UNSAFE is never re-claimed", () => {
    const claim = runSrc.slice(
      runSrc.indexOf("async function claimScan"),
      runSrc.indexOf("async function finalizeVerdict")
    );
    assert.ok(!/"UNSAFE"/.test(claim), "UNSAFE must not appear in the claim filter");
  });

  test("the deliverable gate predicate is untouched", () => {
    // Three clauses, unchanged. Everything above only decides what gets
    // written; this decides what may be sold.
    const safety = read("lib/file-safety.ts");
    assert.ok(/product\.fileKey !== null/.test(safety));
    assert.ok(/product\.fileScanStatus === "SAFE"/.test(safety));
    assert.ok(/product\.fileScanKey === product\.fileKey/.test(safety));
  });

  test("checkout and download still refuse anything not SAFE", () => {
    const checkout = read("app/api/checkout/route.ts");
    const download = read("app/api/download/[productId]/route.ts");
    for (const src of [checkout, download]) {
      assert.ok(/isDeliverableSafe\(product\)/.test(src));
      assert.ok(/!isDeliverableSafe/.test(src));
    }
  });

  test("SCAN_ERROR is as unsellable as an unscanned file", () => {
    // The whole basis for preferring it over UNSAFE: it is not a softer state.
    //
    // Scoped to isDeliverableSafe deliberately. file-safety.ts does name
    // SCAN_ERROR elsewhere — deliverableGateReason maps it to "scan_error" so
    // the inspection UI can say why a file is blocked — and that is labelling,
    // not permission. The predicate below is what decides, and it admits one
    // status only.
    const safety = read("lib/file-safety.ts");
    const predicate = safety.slice(
      safety.indexOf("export function isDeliverableSafe"),
      safety.indexOf("export function deliverableGateReason")
    );
    assert.ok(predicate.length > 0);
    assert.ok(
      !/SCAN_ERROR/.test(predicate),
      "the predicate must not mention SCAN_ERROR at all"
    );
    assert.ok(
      /fileScanStatus === "SAFE"/.test(predicate),
      "SAFE is the only admitted status, so SCAN_ERROR fails like any other"
    );
  });

  test("the gate reason for SCAN_ERROR is not a safe one", () => {
    const safety = read("lib/file-safety.ts");
    assert.ok(/case "SCAN_ERROR":\s*return "scan_error";/.test(safety));
    // "safe" is returned for exactly one state, and it is not this one.
    assert.ok(/\? "safe"/.test(safety));
  });
});
