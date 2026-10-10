/**
 * The Geidea client's drop-in additions, against the real client.
 *
 * Two additions only: the optional `appearance` a session may carry, limited
 * to the fields and values Geidea's Create Session v2 reference documents,
 * and the URL of Geidea's Checkout v2 library, derived from the configured
 * hosted-page host. The environment is a stand-in and fetch records instead
 * of sending, so no request can leave the process.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatGeideaTimestamp, signCreateSession } from "../lib/payments/geidea/signature.ts";

const PK = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PW = "unit-test-password-not-real";
const API = "https://api.geidea.test";
const HPP = "https://hpp.geidea.test";
const REF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const NOW = new Date(Date.UTC(2026, 8, 21, 12, 34, 56));
const TS = formatGeideaTimestamp(NOW);

const envState: Record<string, string | undefined> = {};
function resetEnv() {
  envState.GEIDEA_MERCHANT_PUBLIC_KEY = PK;
  envState.GEIDEA_API_PASSWORD = PW;
  envState.GEIDEA_API_BASE_URL = `${API}/`;
  envState.GEIDEA_HPP_BASE_URL = `${HPP}/`;
  envState.GEIDEA_ENV = "test";
}
resetEnv();

const calls: { url: string; body: Record<string, unknown> }[] = [];
let reply: Record<string, unknown> = {};

type ClientModule = typeof import("../lib/payments/geidea/client.ts");
let client: ClientModule;

before(async () => {
  mock.module("@/lib/env", {
    namedExports: { env: new Proxy({}, { get: (_t, key) => envState[String(key)] }) },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  client = await import("../lib/payments/geidea/client.ts");
});

beforeEach(() => {
  calls.length = 0;
  resetEnv();
  reply = {
    session: {
      id: SESSION_ID,
      amount: 19.99,
      currency: "SAR",
      status: "Initiated",
      expiryDate: "2026-09-21T12:49:56.0000000Z",
      merchantReferenceId: REF,
    },
    responseCode: "000",
  };
});

const baseInput = () => ({
  amount: 19.99,
  currency: "SAR",
  merchantReferenceId: REF,
  callbackUrl: "https://saiflow.test/api/webhooks/geidea",
  returnUrl: `https://saiflow.test/success?ref=${REF}`,
  language: "ar" as const,
});

const DROPIN = {
  uiMode: "dropin",
  showEmail: false,
  showAddress: false,
  showPhone: false,
  receiptPage: false,
  merchant: { name: "SaiFlow" },
  styles: { headerColor: "#14b8a6", hideGeideaLogo: true, hppProfile: "compressed" },
} as const;

const deps = { now: () => NOW };

async function refused(appearance: unknown): Promise<Error> {
  let caught: unknown;
  try {
    await client.createSession({ ...baseInput(), appearance } as Parameters<ClientModule["createSession"]>[0], deps);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof client.GeideaRequestError, `expected GeideaRequestError, got ${String(caught)}`);
  assert.equal(calls.length, 0, "nothing may be sent");
  return caught as Error;
}

describe("a session may carry Geidea's documented appearance", () => {
  test("the drop-in appearance is sent as given, and nothing else in the body changes", async () => {
    await client.createSession(baseInput(), deps);
    await client.createSession({ ...baseInput(), appearance: DROPIN }, deps);
    const [plain, embedded] = calls.map((c) => c.body);
    assert.ok(!("appearance" in plain), "no appearance means no appearance key at all");
    const { appearance, ...rest } = embedded;
    assert.deepEqual(appearance, DROPIN);
    assert.deepEqual(rest, plain, "amount, currency, reference, URLs, language, operation and signature are identical");
    assert.equal(
      rest.signature,
      signCreateSession({ merchantPublicKey: PK, amount: 19.99, currency: "SAR", merchantReferenceId: REF, timestamp: TS }, PW),
      "the appearance is not part of what is signed"
    );
  });

  test("only the fields given are sent; an omitted field stays omitted", async () => {
    await client.createSession({ ...baseInput(), appearance: { uiMode: "dropin", styles: { hppProfile: "simple" } } }, deps);
    assert.deepEqual(calls[0].body.appearance, { uiMode: "dropin", styles: { hppProfile: "simple" } });
  });

  test("the appearance is rebuilt, not passed through: a later change to the caller's object cannot reach Geidea", async () => {
    const mutable = { uiMode: "dropin" as const, merchant: { name: "SaiFlow" } };
    const pending = client.createSession({ ...baseInput(), appearance: mutable }, deps);
    mutable.merchant.name = "Changed";
    await pending;
    assert.deepEqual(calls[0].body.appearance, { uiMode: "dropin", merchant: { name: "SaiFlow" } });
  });

  test("the documented values are accepted, each one", async () => {
    for (const uiMode of ["modal", "dropin", "redirection"] as const) {
      calls.length = 0;
      await client.createSession({ ...baseInput(), appearance: { uiMode } }, deps);
      assert.equal((calls[0].body.appearance as { uiMode: string }).uiMode, uiMode);
    }
    await client.createSession(
      { ...baseInput(), appearance: { merchant: { name: "SaiFlow", logoUrl: "https://www.saiflow.io/logo.png" } } },
      deps
    );
  });

  test("anything undocumented, mistyped or out of range is refused before a byte is sent", async () => {
    const cases: unknown[] = [
      null,
      "dropin",
      [],
      { uiMode: "fullscreen" },
      { uiMode: "DROPIN" },
      { showEmail: "false" },
      { receiptPage: 0 },
      { theme: "dark" },
      { styles: { hppProfile: "wide" } },
      { styles: { headerColor: "teal" } },
      { styles: { headerColor: "#14b8a" } },
      { styles: { headerColor: "#14b8a6ff" } },
      { styles: { fontFamily: "Tajawal" } },
      { styles: [] },
      { merchant: { name: "" } },
      { merchant: { name: "x".repeat(61) } },
      { merchant: { name: "Sai\nFlow" } },
      { merchant: { logoUrl: "http://www.saiflow.io/logo.png" } },
      { merchant: { logoUrl: "javascript:alert(1)" } },
      { merchant: { email: "a@b.test" } },
      JSON.parse('{"__proto__": {"uiMode": "dropin"}}'),
    ];
    for (const appearance of cases) {
      await refused(appearance);
    }
  });

  test("a refusal names the field and never echoes the value", async () => {
    const error = await refused({ styles: { headerColor: "SECRET-LOOKING-VALUE" } });
    assert.match(error.message, /appearance\.styles\.headerColor/);
    assert.ok(!error.message.includes("SECRET-LOOKING-VALUE"));
    const unknown = await refused({ secretKey: "x" });
    assert.match(unknown.message, /appearance\.secretKey is not a documented field/);
  });

  test("an appearance echoed back in Geidea's reply is ignored like every other unknown field", async () => {
    reply = { ...reply, session: { ...(reply.session as Record<string, unknown>), appearance: DROPIN } };
    const result = await client.createSession({ ...baseInput(), appearance: DROPIN }, deps);
    assert.deepEqual(Object.keys(result).sort(), ["redirectUrl", "session", "timestamp"]);
    assert.ok(!("appearance" in result.session));
  });
});

describe("Geidea's checkout library comes from the configured hosted-page host", () => {
  test("it sits beside the hosted checkout page, on GEIDEA_HPP_BASE_URL", () => {
    assert.equal(client.checkoutScriptUrl(), `${HPP}/hpp/geideaCheckout.min.js`);
    assert.equal(client.checkoutRedirectUrl(SESSION_ID), `${HPP}/hpp/checkout/?${SESSION_ID}`);
  });

  test("it follows whatever host the deployment configures; no host is written in the client", () => {
    envState.GEIDEA_HPP_BASE_URL = "https://another-host.example//";
    assert.equal(client.checkoutScriptUrl(), "https://another-host.example/hpp/geideaCheckout.min.js");
    const src = readFileSync(new URL("../lib/payments/geidea/client.ts", import.meta.url), "utf8");
    assert.ok(!/geidea\.(net|ae)|ksamerchant/.test(src), "no Geidea host is hard-coded");
  });

  test("a script is only ever loaded over https", () => {
    envState.GEIDEA_HPP_BASE_URL = "http://hpp.geidea.test";
    assert.throws(() => client.checkoutScriptUrl(), (error: Error) => {
      assert.equal(error.name, "GeideaConfigError");
      assert.match(error.message, /GEIDEA_HPP_BASE_URL must be https/);
      assert.ok(!error.message.includes("hpp.geidea.test"), "names the variable, not the value");
      return true;
    });
  });

  test("an unconfigured deployment gets no library URL", () => {
    envState.GEIDEA_HPP_BASE_URL = undefined;
    assert.throws(() => client.checkoutScriptUrl(), /GEIDEA_HPP_BASE_URL not set/);
    resetEnv();
    envState.GEIDEA_ENV = undefined;
    assert.throws(() => client.checkoutScriptUrl(), /GEIDEA_ENV not set/);
  });
});
