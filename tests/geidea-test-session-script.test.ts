/**
 * The one-off Geidea test-session script, exercised without Geidea.
 *
 * The client module is replaced by a recorder, global fetch throws, and the
 * script's `run()` is called directly with a capturing printer. What is
 * asserted: exactly what the script would send to `createSession`, exactly
 * what it prints on success and on failure, that it refuses without a valid
 * capture URL and outside test mode, that it never prints the capture URL,
 * and that nothing it prints could carry a credential. A structural pass over
 * the source pins that it reuses the client rather than duplicating any
 * signing, authentication or HTTP logic, and that no capture URL is embedded.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CALLBACK = "https://webhook.example.test/test-token";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const calls: { input: Record<string, unknown>; deps: unknown }[] = [];
const state = {
  configured: true,
  mode: "test" as "test" | "production",
  result: null as null | ((input: Record<string, unknown>) => unknown),
  error: null as Error | null,
};

type ScriptModule = typeof import("../scripts/geidea-test-session.ts");
let script: ScriptModule;

before(async () => {
  mock.module("@/lib/payments/geidea/client", {
    namedExports: {
      isGeideaConfigured: () => state.configured,
      geideaMode: () => state.mode,
      createSession: async (input: Record<string, unknown>, deps?: unknown) => {
        calls.push({ input, deps });
        if (state.error) throw state.error;
        if (!state.result) throw new Error("test provided no result");
        return state.result(input);
      },
    },
  });
  globalThis.fetch = (async () => {
    throw new Error("network access is not permitted in tests");
  }) as typeof fetch;
  script = await import("../scripts/geidea-test-session.ts");
});

const success = (input: Record<string, unknown>) => ({
  session: {
    sessionId: SESSION_ID,
    amount: 1,
    currency: "SAR",
    status: "Initiated",
    expiryDate: "2026-09-21T12:49:56.0000000Z",
    merchantReferenceId: input.merchantReferenceId,
  },
  redirectUrl: `https://www.ksamerchant.geidea.net/hpp/checkout/?${SESSION_ID}`,
  timestamp: "2026/09/21 12:34:56",
});

beforeEach(() => {
  calls.length = 0;
  state.configured = true;
  state.mode = "test";
  state.result = success;
  state.error = null;
});

// No default parameter: an explicit `undefined` must reach the script as a missing argument.
async function runCapturing(callbackUrl: unknown): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await script.run(callbackUrl, (line) => lines.push(line));
  return { code, lines };
}

/* ------------------------------------------------------------------ */
/* What it sends                                                       */
/* ------------------------------------------------------------------ */

describe("what the script sends", () => {
  test("one createSession call, through the client, with exactly the agreed fields", async () => {
    await runCapturing(CALLBACK);
    assert.equal(calls.length, 1);
    const { input, deps } = calls[0];
    assert.deepEqual(Object.keys(input).sort(), [
      "amount",
      "callbackUrl",
      "currency",
      "language",
      "merchantReferenceId",
      "returnUrl",
    ]);
    assert.equal(input.amount, "1.00");
    assert.equal(input.currency, "SAR");
    assert.equal(input.language, "en");
    assert.equal(input.callbackUrl, CALLBACK);
    assert.equal(input.returnUrl, `${CALLBACK}?leg=return`);
    assert.match(String(input.merchantReferenceId), UUID_V4);
    assert.equal(deps, undefined, "no injected fetch: a real run uses the client's own transport");
  });

  test("every run generates a fresh reference", async () => {
    await runCapturing(CALLBACK);
    await runCapturing(CALLBACK);
    assert.notEqual(calls[0].input.merchantReferenceId, calls[1].input.merchantReferenceId);
  });

  test("the exported constants are the agreed values", () => {
    assert.equal(script.AMOUNT, "1.00");
    assert.equal(script.CURRENCY, "SAR");
    assert.equal(script.LANGUAGE, "en");
  });

  test("the return URL keeps any existing query and adds leg=return", () => {
    const url = script.resolveCallbackUrl("https://webhook.example.test/test-token?x=1");
    assert.ok(url);
    assert.equal(script.returnUrlFor(url), "https://webhook.example.test/test-token?x=1&leg=return");
  });
});

/* ------------------------------------------------------------------ */
/* What it prints                                                      */
/* ------------------------------------------------------------------ */

describe("what the script prints", () => {
  test("on success: the reference, the session id, the expiry and the checkout URL, nothing else", async () => {
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 0);
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^merchantReferenceId: [0-9a-f-]{36}$/);
    assert.equal(lines[1], `sessionId:           ${SESSION_ID}`);
    assert.equal(lines[2], "expires:             2026-09-21T12:49:56.0000000Z");
    assert.equal(lines[3], `checkout URL:        https://www.ksamerchant.geidea.net/hpp/checkout/?${SESSION_ID}`);
    assert.equal(lines[0].slice("merchantReferenceId: ".length), calls[0].input.merchantReferenceId);
  });

  test("never prints the capture URL, on any path", async () => {
    const all: string[] = [];
    all.push(...(await runCapturing(CALLBACK)).lines);
    state.error = Object.assign(new Error("Geidea createSession: HTTP 401"), { name: "GeideaHttpError", status: 401 });
    all.push(...(await runCapturing(CALLBACK)).lines);
    state.error = null;
    state.mode = "production";
    all.push(...(await runCapturing(CALLBACK)).lines);
    for (const line of all) {
      assert.ok(!line.includes("webhook"), line);
      assert.ok(!line.includes("test-token"), line);
    }
  });

  test("warns when the checkout URL is not the documented KSA format", async () => {
    state.result = (input) => ({
      ...success(input),
      redirectUrl: `https://www.merchant.geidea.net/hpp/checkout/?${SESSION_ID}`,
    });
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 0);
    assert.equal(lines.length, 5);
    assert.match(lines[4], /^WARNING: .*KSA format/);
  });

  test("on a Geidea refusal: the class, the client's message, the status and the codes", async () => {
    state.error = Object.assign(new Error("Geidea createSession: rejected with responseCode 100/123 (HTTP 400)"), {
      name: "GeideaResponseError",
      kind: "rejected",
      status: 400,
      responseCode: "100",
      detailedResponseCode: "123",
    });
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 1);
    assert.deepEqual(lines.slice(1), [
      "FAILED",
      "  error: GeideaResponseError",
      "  detail: Geidea createSession: rejected with responseCode 100/123 (HTTP 400)",
      "  http status: 400",
      "  responseCode: 100",
      "  detailedResponseCode: 123",
    ]);
  });

  test("on a transport failure: the class and the client's message, no status", async () => {
    state.error = Object.assign(new Error("Geidea createSession: no response (TypeError)"), {
      name: "GeideaHttpError",
      status: 0,
    });
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 1);
    assert.deepEqual(lines.slice(1), [
      "FAILED",
      "  error: GeideaHttpError",
      "  detail: Geidea createSession: no response (TypeError)",
    ]);
  });

  test("a non-Geidea error is reported by name only, whatever its message says", async () => {
    state.error = Object.assign(new Error("boom SECRET-x9-must-never-print Authorization: Basic abc"), {
      name: "TypeError",
    });
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 1);
    assert.deepEqual(lines.slice(1), ["FAILED", "  error: TypeError"]);
  });

  test("nothing printed could carry a credential", async () => {
    const all: string[] = [];
    all.push(...(await runCapturing(CALLBACK)).lines);
    state.error = Object.assign(new Error("Geidea createSession: HTTP 401"), { name: "GeideaHttpError", status: 401 });
    all.push(...(await runCapturing(CALLBACK)).lines);
    for (const line of all) {
      assert.ok(!/authorization|basic |signature|password|secret/i.test(line), line);
      assert.ok(!line.includes("{"), "no object dumps");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Guard rails                                                         */
/* ------------------------------------------------------------------ */

describe("the script refuses to run without a valid capture URL or outside a configured TEST environment", () => {
  test("a missing, non-https or unparseable capture URL is refused before anything is sent", async () => {
    for (const bad of [undefined, "", "http://webhook.example.test/test-token", "not a url", "webhook.example.test/test-token", 42]) {
      const { code, lines } = await runCapturing(bad);
      assert.equal(code, 2, String(bad));
      assert.equal(calls.length, 0, String(bad));
      assert.match(lines[0], /^REFUSED: pass the https capture URL/);
      assert.equal(lines.length, 1);
    }
  });

  test("not configured: refused before anything is sent", async () => {
    state.configured = false;
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 2);
    assert.equal(calls.length, 0);
    assert.match(lines[0], /^REFUSED: Geidea is not configured/);
    assert.equal(lines.length, 1);
  });

  test("production mode: refused before anything is sent", async () => {
    state.mode = "production";
    const { code, lines } = await runCapturing(CALLBACK);
    assert.equal(code, 2);
    assert.equal(calls.length, 0);
    assert.match(lines[0], /^REFUSED: GEIDEA_ENV is not "test"/);
  });
});

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

describe("the script reuses the client, duplicates nothing and embeds no capture URL", () => {
  const src = readFileSync(new URL("../scripts/geidea-test-session.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  test("imports only the client, node:crypto and node:url", () => {
    const sources = [...src.matchAll(/from "([^"]+)";/g)].map((m) => m[1]).sort();
    assert.deepEqual(sources, ["@/lib/payments/geidea/client", "node:crypto", "node:url"]);
  });

  test("contains no signing, authentication, transport or database logic of its own", () => {
    for (const forbidden of [
      "fetch(",
      "createHmac",
      "signCreateSession",
      "Authorization",
      "Basic ",
      "payment-intent",
      "process.env",
      "@/lib/env",
      "@/lib/prisma",
      "prisma",
      "JSON.stringify",
      "console.dir",
      "console.error",
      ".stack",
    ]) {
      assert.ok(!src.includes(forbidden), `must not contain ${forbidden}`);
    }
  });

  test("embeds no capture URL: no webhook host and no https literal in the code", () => {
    assert.ok(!/webhook/i.test(src));
    assert.ok(!/https:\/\//.test(src), "the only https text may be inside the escaped KSA regex");
    assert.ok(src.includes("process.argv[2]"), "the capture URL comes from the first argument");
  });

  test("generates the reference with crypto.randomUUID and auto-runs only when invoked directly", () => {
    assert.ok(src.includes("randomUUID()"));
    assert.ok(src.includes("import.meta.url === pathToFileURL(process.argv[1]).href"));
  });

  test("the only console call is the default printer", () => {
    assert.equal((src.match(/console\.\w+/g) ?? []).length, 1);
    assert.ok(src.includes("(line) => console.log(line)"));
  });
});
