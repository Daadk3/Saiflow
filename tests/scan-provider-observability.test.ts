/**
 * Diagnostic detail on provider failures.
 *
 * The first real production scan failed with `provider_bad_response_terminal`
 * and nothing else — three attempts, no way to tell a 401 from a malformed
 * body from a schema mismatch. This pins the detail that fixes that, and,
 * more importantly, pins the limits on it: the reason column is an audit
 * field, and the whole point of a discriminated union plus a sink guard is
 * that no provider response can widen what lands there.
 *
 * The provider is never really called. `globalThis.fetch` is replaced per
 * test and the key is a local fake, so no network request and no real
 * credential is involved.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { cloudmersiveProvider } from "../lib/scan/cloudmersive";
import {
  formatFailureDetail,
  isRetryableFailure,
  type ScanFailureDetail,
  type ScanProviderResult,
  type ScanRequest,
} from "../lib/scan/provider";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runSrc = readFileSync(resolve(ROOT, "lib/scan/run.ts"), "utf8");

/** Local and fake. Never a real credential. */
const FAKE_KEY = "test-only-not-a-real-cloudmersive-key";

const REQUEST: ScanRequest = {
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), // "%PDF"
  fileName: "sample.pdf",
  restrictToExtensions: [".pdf"],
  allowHtml: false,
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.CLOUDMERSIVE_API_KEY;
});

async function scanWith(response: () => Response): Promise<ScanProviderResult> {
  process.env.CLOUDMERSIVE_API_KEY = FAKE_KEY;
  globalThis.fetch = (async () => response()) as typeof fetch;
  return cloudmersiveProvider.scan(REQUEST);
}

/**
 * The persisted reason, composed exactly as lib/scan/run.ts composes it.
 * A source assertion below keeps this mirror honest.
 */
function persistedReason(result: ScanProviderResult): string {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  const detail = formatFailureDetail(result.detail);
  const base = detail
    ? `provider_${result.failure}_${detail}`
    : `provider_${result.failure}`;
  return isRetryableFailure(result.failure) ? base : `${base}_terminal`;
}

/* ------------------------------------------------------------------ */
/* The new, distinguishable reasons                                    */
/* ------------------------------------------------------------------ */

describe("bad_response now says WHY", () => {
  for (const status of [400, 401, 402, 403, 404]) {
    test(`HTTP ${status} persists a reason naming ${status}`, async () => {
      const res = await scanWith(() => new Response("{}", { status }));
      assert.equal(res.ok === false && res.failure, "bad_response");
      assert.equal(
        persistedReason(res),
        `provider_bad_response_http_${status}_terminal`
      );
    });
  }

  test("a non-JSON body persists json_parse", async () => {
    const res = await scanWith(
      () => new Response("<html>gateway error</html>", { status: 200 })
    );
    assert.equal(res.ok === false && res.failure, "bad_response");
    assert.equal(
      persistedReason(res),
      "provider_bad_response_json_parse_terminal"
    );
  });

  test("an empty body persists json_parse", async () => {
    const res = await scanWith(() => new Response("", { status: 200 }));
    assert.equal(persistedReason(res), "provider_bad_response_json_parse_terminal");
  });

  test("valid JSON that is not a scan result persists schema", async () => {
    const res = await scanWith(
      () => new Response(JSON.stringify({ SomethingElse: true }), { status: 200 })
    );
    assert.equal(res.ok === false && res.failure, "bad_response");
    assert.equal(persistedReason(res), "provider_bad_response_schema_terminal");
  });

  test("a payload missing threat flags persists schema, never SAFE", async () => {
    const res = await scanWith(
      () => new Response(JSON.stringify({ CleanResult: true }), { status: 200 })
    );
    assert.equal(res.ok, false);
    assert.equal(persistedReason(res), "provider_bad_response_schema_terminal");
  });

  test("the three causes are distinguishable from one another", async () => {
    const reasons = new Set([
      persistedReason(await scanWith(() => new Response("{}", { status: 401 }))),
      persistedReason(await scanWith(() => new Response("nope", { status: 200 }))),
      persistedReason(
        await scanWith(() => new Response(JSON.stringify({ a: 1 }), { status: 200 }))
      ),
    ]);
    assert.equal(reasons.size, 3, "each cause must persist a distinct reason");
  });
});

/* ------------------------------------------------------------------ */
/* Unchanged classifications                                           */
/* ------------------------------------------------------------------ */

describe("every other failure is classified exactly as before", () => {
  test("429 stays rate_limited and stays retryable", async () => {
    const res = await scanWith(() => new Response("{}", { status: 429 }));
    assert.equal(res.ok === false && res.failure, "rate_limited");
    assert.equal(res.ok === false && res.detail, undefined);
    assert.equal(persistedReason(res), "provider_rate_limited");
  });

  test("413 stays too_large and stays terminal", async () => {
    const res = await scanWith(() => new Response("{}", { status: 413 }));
    assert.equal(res.ok === false && res.failure, "too_large");
    assert.equal(res.ok === false && res.detail, undefined);
    assert.equal(persistedReason(res), "provider_too_large_terminal");
  });

  for (const status of [500, 502, 503]) {
    test(`${status} stays server_error and stays retryable`, async () => {
      const res = await scanWith(() => new Response("{}", { status }));
      assert.equal(res.ok === false && res.failure, "server_error");
      assert.equal(persistedReason(res), "provider_server_error");
    });
  }

  test("a timeout is unchanged", async () => {
    process.env.CLOUDMERSIVE_API_KEY = FAKE_KEY;
    globalThis.fetch = (async () => {
      const e = new Error("timed out");
      e.name = "TimeoutError";
      throw e;
    }) as typeof fetch;
    const res = await cloudmersiveProvider.scan(REQUEST);
    assert.equal(res.ok === false && res.failure, "timeout");
    assert.equal(persistedReason(res), "provider_timeout");
  });

  test("a transport error is unchanged", async () => {
    process.env.CLOUDMERSIVE_API_KEY = FAKE_KEY;
    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const res = await cloudmersiveProvider.scan(REQUEST);
    assert.equal(res.ok === false && res.failure, "network");
    assert.equal(persistedReason(res), "provider_network");
  });

  test("an absent key still short-circuits without a request", async () => {
    delete process.env.CLOUDMERSIVE_API_KEY;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const res = await cloudmersiveProvider.scan(REQUEST);
    assert.equal(res.ok === false && res.failure, "unconfigured");
    assert.equal(called, false, "no request may be made without a key");
  });

  test("retryability is decided by the failure alone, never the detail", () => {
    // The detail is diagnosis. If it ever influenced this, a 401 could become
    // retryable and burn the attempt budget on a deterministic failure.
    assert.equal(isRetryableFailure("bad_response"), false);
    assert.equal(isRetryableFailure("too_large"), false);
    assert.equal(isRetryableFailure("unconfigured"), false);
    assert.equal(isRetryableFailure("timeout"), true);
    assert.equal(isRetryableFailure("network"), true);
    assert.equal(isRetryableFailure("rate_limited"), true);
    assert.equal(isRetryableFailure("server_error"), true);
  });
});

/* ------------------------------------------------------------------ */
/* The sink guard                                                      */
/* ------------------------------------------------------------------ */

describe("formatFailureDetail refuses anything it cannot vouch for", () => {
  test("the two fixed categories", () => {
    assert.equal(formatFailureDetail({ kind: "json_parse" }), "json_parse");
    assert.equal(formatFailureDetail({ kind: "schema" }), "schema");
  });

  test("undefined yields nothing to append", () => {
    assert.equal(formatFailureDetail(undefined), null);
  });

  test("plausible statuses are rendered", () => {
    for (const status of [100, 200, 400, 401, 403, 429, 500, 599]) {
      assert.equal(formatFailureDetail({ kind: "http", status }), `http_${status}`);
    }
  });

  test("implausible or non-integer statuses are DROPPED, not persisted", () => {
    const bad = [0, 99, 600, 1000, -1, 401.5, NaN, Infinity, -Infinity];
    for (const status of bad) {
      assert.equal(
        formatFailureDetail({ kind: "http", status }),
        null,
        `status ${status} must not reach the column`
      );
    }
  });

  test("a smuggled non-numeric status is dropped", () => {
    // Defence against a future provider handing back something unchecked.
    const smuggled = { kind: "http", status: "401'; DROP TABLE" } as unknown as ScanFailureDetail;
    assert.equal(formatFailureDetail(smuggled), null);
  });

  test("every emitted token is short and character-safe", () => {
    const tokens = [
      formatFailureDetail({ kind: "json_parse" }),
      formatFailureDetail({ kind: "schema" }),
      formatFailureDetail({ kind: "http", status: 401 }),
    ];
    for (const tk of tokens) {
      assert.ok(tk !== null);
      assert.ok(/^[a-z0-9_]{1,20}$/.test(tk!), `unsafe token: ${tk}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Nothing sensitive can reach the column                              */
/* ------------------------------------------------------------------ */

describe("no response content can reach the persisted reason", () => {
  test("a body full of secrets does not appear in the reason", async () => {
    const nasty = JSON.stringify({
      Apikey: "sk_live_SHOULD_NEVER_APPEAR",
      url: "https://utfs.io/f/PRIVATE_KEY_SHOULD_NEVER_APPEAR",
      Authorization: "Bearer SHOULD_NEVER_APPEAR",
      contents: "file bytes SHOULD_NEVER_APPEAR",
    });

    for (const status of [200, 400, 401]) {
      const res = await scanWith(() => new Response(nasty, { status }));
      const reason = persistedReason(res);
      assert.ok(!reason.includes("SHOULD_NEVER_APPEAR"), reason);
      assert.ok(!reason.includes("sk_live"), reason);
      assert.ok(!reason.includes("utfs.io"), reason);
      assert.ok(!reason.includes("Bearer"), reason);
      assert.ok(!/https?:\/\//.test(reason), reason);
      // Shape: lowercase tokens joined by underscores, nothing else.
      assert.ok(/^[a-z0-9_]+$/.test(reason), reason);
      assert.ok(reason.length <= 64, reason);
    }
  });

  test("the provider still logs nothing at all", () => {
    const src = readFileSync(resolve(ROOT, "lib/scan/cloudmersive.ts"), "utf8");
    assert.ok(!/console\./.test(src), "the provider must remain silent");
  });

  test("the detail type cannot carry free text", () => {
    const src = readFileSync(resolve(ROOT, "lib/scan/provider.ts"), "utf8");
    const block = src.slice(
      src.indexOf("export type ScanFailureDetail"),
      src.indexOf("export type ScanProviderResult")
    );
    // Only `status: number` may vary; no string field may be added.
    assert.ok(/status: number/.test(block));
    assert.ok(!/:\s*string/.test(block), "no free-text field may exist here");
  });
});

/* ------------------------------------------------------------------ */
/* The mirror above matches the real composition                       */
/* ------------------------------------------------------------------ */

describe("run.ts composes the reason the way these tests assume", () => {
  test("it calls the sink guard and appends the detail", () => {
    assert.ok(/formatFailureDetail\(result\.detail\)/.test(runSrc));
    assert.ok(
      /`provider_\$\{result\.failure\}_\$\{detail\}`/.test(runSrc),
      "detail must be appended after the failure"
    );
    assert.ok(/`\$\{base\}_terminal`/.test(runSrc));
  });

  test("retryability still reads the failure, not the detail", () => {
    assert.ok(/isRetryableFailure\(result\.failure\)/.test(runSrc));
    assert.ok(!/isRetryableFailure\(result\.detail/.test(runSrc));
  });

  test("attempt ceiling and eligibility are untouched", () => {
    assert.ok(/MAX_SCAN_ATTEMPTS = 3/.test(runSrc));
    assert.ok(/scanStatus: \{ in: \["PENDING_SCAN", "SCAN_ERROR"\] \}/.test(runSrc));
  });
});
