/**
 * Geidea Checkout v2 — the API client, exercised without a network.
 *
 * `@/lib/env` is replaced with a fixture configuration and `fetch` with a
 * recorder that answers canned responses, both before the client is
 * imported. Every host here is `*.geidea.test`, which does not resolve, so
 * even a bug that bypassed the recorder could not reach Geidea.
 *
 * What is asserted is the request as it would leave the process — URL,
 * method, headers, body, signature — and what the client makes of what comes
 * back: a typed object for the documented shape, a specific refusal for
 * everything else. The console is captured for the whole file, and the last
 * test asserts it stayed silent. Every credential here is a fixture.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatGeideaTimestamp,
  signCreateSession,
} from "../lib/payments/geidea/signature.ts";

/* ------------------------------------------------------------------ */
/* Fixtures — none of these is a real credential                       */
/* ------------------------------------------------------------------ */

const PK = "d1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b";
const PW = "unit-test-password-not-real";
/** base64("PK:PW"), computed independently. */
const BASIC =
  "Basic ZDFmMmEzYjQtNWM2ZC00ZTdmLThhOWItMGMxZDJlM2Y0YTViOnVuaXQtdGVzdC1wYXNzd29yZC1ub3QtcmVhbA==";
const API = "https://api.geidea.test";
const HPP = "https://hpp.geidea.test";
const REF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const ORDER_ID = "3c0e2b5a-9d4f-4c1b-8e2a-6f7b8c9d0e1f";
const NOW = new Date(Date.UTC(2026, 8, 21, 12, 34, 56));
const TS = formatGeideaTimestamp(NOW);

const envState: Record<string, string | undefined> = {};
function resetEnv() {
  envState.GEIDEA_MERCHANT_PUBLIC_KEY = PK;
  envState.GEIDEA_API_PASSWORD = PW;
  // Trailing slashes on purpose: the client must normalise them.
  envState.GEIDEA_API_BASE_URL = `${API}/`;
  envState.GEIDEA_HPP_BASE_URL = `${HPP}/`;
  envState.GEIDEA_ENV = "test";
}
resetEnv();

interface RecordedCall {
  url: string;
  init: RequestInit;
}
const calls: RecordedCall[] = [];
const canned: { response: (() => Response) | null; failure: Error | null } = {
  response: null,
  failure: null,
};
const logs: string[] = [];

async function fetchStub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  calls.push({ url: String(input), init: init ?? {} });
  if (canned.failure) throw canned.failure;
  if (!canned.response) throw new Error("test provided no canned response");
  return canned.response();
}

type ClientModule = typeof import("../lib/payments/geidea/client.ts");
let client: ClientModule;

before(async () => {
  mock.module("@/lib/env", {
    namedExports: {
      env: new Proxy(
        {},
        { get: (_target, key) => envState[String(key)] }
      ),
    },
  });
  globalThis.fetch = fetchStub as typeof fetch;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  }
  client = await import("../lib/payments/geidea/client.ts");
});

beforeEach(() => {
  calls.length = 0;
  canned.response = null;
  canned.failure = null;
  resetEnv();
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const text = (body: string, status = 200) => () => new Response(body, { status });

const sessionOk = (over: Record<string, unknown> = {}) => ({
  session: {
    id: SESSION_ID,
    amount: 19.99,
    currency: "SAR",
    callbackUrl: "https://saiflow.test/api/webhooks/geidea",
    expiryDate: "2026-09-21T12:49:56.0000000Z",
    status: "Initiated",
    merchantId: "4907f9f6-af43-434a-340a-08da8933ece3",
    language: "ar",
    merchantReferenceId: REF,
    paymentOperation: "Pay",
    ...over,
  },
  responseMessage: "Success",
  responseCode: "000",
});

const orderOk = (over: Record<string, unknown> = {}) => ({
  order: {
    orderId: ORDER_ID,
    status: "Success",
    detailedStatus: "Paid",
    amount: 19.99,
    currency: "SAR",
    merchantReferenceId: REF,
    ...over,
  },
  responseMessage: "Success",
  detailedResponseMessage: "The operation was successful",
  responseCode: "000",
  detailedResponseCode: "000",
});

const validInput = () => ({
  amount: 19.99,
  currency: "SAR",
  merchantReferenceId: REF,
  callbackUrl: "https://saiflow.test/api/webhooks/geidea",
  returnUrl: `https://saiflow.test/success?ref=${REF}`,
  language: "ar" as const,
});

const deps = () => ({ now: () => NOW });

async function rejectsWith<T extends Error>(
  promise: Promise<unknown>,
  ctor: new (...args: never[]) => T
): Promise<T> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof ctor, `expected ${ctor.name}, got ${String(caught)}`);
  return caught;
}

function headersOf(call: RecordedCall): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

function assertNoSecrets(error: Error) {
  const texts = [
    error.message,
    String(error.stack),
    JSON.stringify(error, Object.getOwnPropertyNames(error)),
  ];
  for (const t of texts) {
    assert.ok(!t.includes(PW), "leaked the API password");
    assert.ok(!t.includes(PK), "leaked the public key");
    assert.ok(!t.includes(BASIC.slice(6)), "leaked the Basic token");
  }
}

/* ------------------------------------------------------------------ */
/* createSession: the request                                          */
/* ------------------------------------------------------------------ */

describe("createSession builds the documented request", () => {
  test("POSTs the signed body to the session endpoint with Basic auth", async () => {
    canned.response = json(sessionOk());
    await client.createSession(validInput(), deps());

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, `${API}/payment-intent/api/v2/direct/session`);
    assert.equal(call.init.method, "POST");

    const headers = headersOf(call);
    assert.equal(headers.Authorization, BASIC);
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers.Accept, "application/json");
    assert.equal(call.init.cache, "no-store");
    assert.ok(call.init.signal instanceof AbortSignal, "the call must carry a timeout signal");

    const body = JSON.parse(String(call.init.body));
    assert.deepEqual(body, {
      amount: 19.99,
      currency: "SAR",
      timestamp: TS,
      merchantReferenceId: REF,
      signature: signCreateSession(
        {
          merchantPublicKey: PK,
          amount: 19.99,
          currency: "SAR",
          merchantReferenceId: REF,
          timestamp: TS,
        },
        PW
      ),
      callbackUrl: "https://saiflow.test/api/webhooks/geidea",
      returnUrl: `https://saiflow.test/success?ref=${REF}`,
      language: "ar",
      paymentOperation: "Pay",
    });
  });

  test("the body never carries a credential", async () => {
    canned.response = json(sessionOk());
    await client.createSession(validInput(), deps());
    const raw = String(calls[0].init.body);
    assert.ok(!raw.includes(PW));
    assert.ok(!raw.includes(PK));
  });

  test("the timestamp in the body is the one that was signed", async () => {
    canned.response = json(sessionOk());
    const result = await client.createSession(validInput(), deps());
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.timestamp, TS);
    assert.equal(result.timestamp, TS);
    assert.match(body.timestamp, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("a decimal-string amount is sent as a number and signed with two decimals", async () => {
    canned.response = json(sessionOk({ amount: 19.9 }));
    await client.createSession({ ...validInput(), amount: "19.9" }, deps());
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.amount, 19.9);
    assert.equal(
      body.signature,
      signCreateSession(
        { merchantPublicKey: PK, amount: "19.90", currency: "SAR", merchantReferenceId: REF, timestamp: TS },
        PW
      )
    );
  });

  test("trailing slashes on the configured hosts are normalised", async () => {
    canned.response = json(sessionOk());
    const result = await client.createSession(validInput(), deps());
    assert.ok(!calls[0].url.includes("//payment-intent"));
    assert.equal(result.redirectUrl, `${HPP}/hpp/checkout/?${SESSION_ID}`);
  });

  test("invalid input is refused before anything is sent", async () => {
    const bad: [string, Record<string, unknown>][] = [
      ["zero amount", { amount: 0 }],
      ["three decimals", { amount: 19.999 }],
      ["negative amount", { amount: -1 }],
      ["lower-case currency", { currency: "sar" }],
      ["non-UUID reference", { merchantReferenceId: "order-1" }],
      ["http callback", { callbackUrl: "http://saiflow.test/api/webhooks/geidea" }],
      ["unparseable callback", { callbackUrl: "not a url" }],
      ["http return", { returnUrl: "http://saiflow.test/success" }],
      ["unsupported language", { language: "fr" }],
      ["missing language", { language: undefined }],
    ];
    for (const [name, over] of bad) {
      const error = await rejectsWith(
        client.createSession({ ...validInput(), ...over } as never, deps()),
        client.GeideaRequestError
      );
      assert.equal(calls.length, 0, `${name}: must not send`);
      assertNoSecrets(error);
    }
  });

  test("missing configuration is refused before anything is sent, naming the variable", async () => {
    envState.GEIDEA_API_PASSWORD = undefined;
    assert.equal(client.isGeideaConfigured(), false);
    const error = await rejectsWith(
      client.createSession(validInput(), deps()),
      client.GeideaConfigError
    );
    assert.ok(error.message.includes("GEIDEA_API_PASSWORD"));
    assert.equal(calls.length, 0);

    envState.GEIDEA_API_PASSWORD = "";
    assert.equal(client.isGeideaConfigured(), false);

    resetEnv();
    assert.equal(client.isGeideaConfigured(), true);
    assert.equal(client.geideaMode(), "test");
  });

  test("GEIDEA_ENV is required and never defaulted", async () => {
    envState.GEIDEA_ENV = undefined;
    assert.equal(client.isGeideaConfigured(), false);
    assert.equal(client.geideaMode(), null);
    const error = await rejectsWith(client.createSession(validInput(), deps()), client.GeideaConfigError);
    assert.ok(error.message.includes("GEIDEA_ENV"));
    assert.equal(calls.length, 0);

    envState.GEIDEA_ENV = "production";
    assert.equal(client.geideaMode(), "production");
    assert.equal(client.isGeideaConfigured(), true);
  });
});

/* ------------------------------------------------------------------ */
/* createSession: the response                                         */
/* ------------------------------------------------------------------ */

describe("createSession decodes the documented response and nothing more", () => {
  test("returns the typed session and the hosted-page URL", async () => {
    canned.response = json(sessionOk());
    const result = await client.createSession(validInput(), deps());
    assert.deepEqual(result.session, {
      sessionId: SESSION_ID,
      amount: 19.99,
      currency: "SAR",
      status: "Initiated",
      expiryDate: "2026-09-21T12:49:56.0000000Z",
      merchantReferenceId: REF,
    });
    assert.equal(result.redirectUrl, `${HPP}/hpp/checkout/?${SESSION_ID}`);
  });

  test("unknown fields are dropped, not passed through", async () => {
    canned.response = json({
      ...sessionOk({ evil: "<script>", merchantId: "x", paymentMethod: { token: "t" } }),
      extra: { nested: true },
      signature: "whatever",
    });
    const result = await client.createSession(validInput(), deps());
    assert.deepEqual(Object.keys(result.session).sort(), [
      "amount",
      "currency",
      "expiryDate",
      "merchantReferenceId",
      "sessionId",
      "status",
    ]);
    assert.deepEqual(Object.keys(result).sort(), ["redirectUrl", "session", "timestamp"]);
    assert.ok(!JSON.stringify(result).includes("<script>"));
  });

  test("an absent merchantReferenceId is null, not an error", async () => {
    canned.response = json(sessionOk({ merchantReferenceId: undefined }));
    const result = await client.createSession(validInput(), deps());
    assert.equal(result.session.merchantReferenceId, null);
  });

  test("a malformed body is refused, naming the path and never the value", async () => {
    const cases: [string, () => Response, string][] = [
      ["not JSON", text("<html>maintenance</html>"), "$"],
      ["empty body", text(""), "$"],
      ["a JSON array", json([sessionOk()]), "$"],
      ["JSON null", text("null"), "$"],
      ["no responseCode", json({ session: sessionOk().session }), "$.responseCode"],
      ["overlong responseCode", json({ ...sessionOk(), responseCode: "0".repeat(40) }), "$.responseCode"],
      ["no session", json({ responseCode: "000" }), "$.session"],
      ["session not an object", json({ responseCode: "000", session: "x" }), "$.session"],
      ["id missing", json(sessionOk({ id: undefined })), "$.session.id"],
      ["id not a UUID", json(sessionOk({ id: "not-a-uuid-value" })), "$.session.id"],
      ["id with a path", json(sessionOk({ id: `${SESSION_ID}/../admin` })), "$.session.id"],
      ["amount as string", json(sessionOk({ amount: "19.99" })), "$.session.amount"],
      ["amount missing", json(sessionOk({ amount: undefined })), "$.session.amount"],
      ["currency lower-case", json(sessionOk({ currency: "sar" })), "$.session.currency"],
      ["status empty", json(sessionOk({ status: "" })), "$.session.status"],
      ["expiryDate missing", json(sessionOk({ expiryDate: undefined })), "$.session.expiryDate"],
      ["merchantReferenceId not a string", json(sessionOk({ merchantReferenceId: 10 })), "$.session.merchantReferenceId"],
    ];
    for (const [name, response, path] of cases) {
      canned.response = response;
      const error = await rejectsWith(
        client.createSession(validInput(), deps()),
        client.GeideaResponseError
      );
      assert.equal(error.kind, "malformed", name);
      assert.equal(error.path, path, name);
      assert.ok(!error.message.includes("not-a-uuid-value"), "message must not echo the value");
      assert.ok(!error.message.includes("<html>"));
      assertNoSecrets(error);
    }
  });

  test("a non-000 responseCode is refused with Geidea's codes", async () => {
    canned.response = json({
      ...sessionOk(),
      responseCode: "100",
      detailedResponseCode: "123",
      responseMessage: "Bad request",
    });
    const error = await rejectsWith(
      client.createSession(validInput(), deps()),
      client.GeideaResponseError
    );
    assert.equal(error.kind, "rejected");
    assert.equal(error.responseCode, "100");
    assert.equal(error.detailedResponseCode, "123");
    assertNoSecrets(error);
  });

  test("a session that does not match what was sent is refused as a mismatch", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["amount", { amount: 20 }, "$.session.amount"],
      ["currency", { currency: "EGP" }, "$.session.currency"],
      ["reference", { merchantReferenceId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }, "$.session.merchantReferenceId"],
    ];
    for (const [name, over, path] of cases) {
      canned.response = json(sessionOk(over));
      const error = await rejectsWith(
        client.createSession(validInput(), deps()),
        client.GeideaResponseError
      );
      assert.equal(error.kind, "mismatch", name);
      assert.equal(error.path, path, name);
    }
  });

  test("HTTP failures are refused with the status and nothing from the body", async () => {
    canned.response = text("", 401);
    let error: Error = await rejectsWith(
      client.createSession(validInput(), deps()),
      client.GeideaHttpError
    );
    assert.equal((error as InstanceType<typeof client.GeideaHttpError>).status, 401);
    assertNoSecrets(error);

    canned.response = text(`<html>gateway error ${PW}</html>`, 502);
    error = await rejectsWith(client.createSession(validInput(), deps()), client.GeideaHttpError);
    assert.equal((error as InstanceType<typeof client.GeideaHttpError>).status, 502);
    assertNoSecrets(error);
  });

  test("a 4xx that carries Geidea codes surfaces the codes", async () => {
    canned.response = json({ responseCode: "300", detailedResponseCode: "301" }, 400);
    const error = await rejectsWith(
      client.createSession(validInput(), deps()),
      client.GeideaResponseError
    );
    assert.equal(error.kind, "rejected");
    assert.equal(error.responseCode, "300");
    assert.equal(error.status, 400);
  });

  test("a transport failure is refused without repeating its message", async () => {
    canned.failure = new Error(`connect ECONNREFUSED ${API} ${PW}`);
    const error = await rejectsWith(
      client.createSession(validInput(), deps()),
      client.GeideaHttpError
    );
    assert.equal(error.status, 0);
    assert.ok(!error.message.includes("ECONNREFUSED"));
    assertNoSecrets(error);
  });
});

/* ------------------------------------------------------------------ */
/* getOrder                                                            */
/* ------------------------------------------------------------------ */

describe("getOrder builds the documented request and decodes the order", () => {
  test("GETs the order endpoint with Basic auth and no body", async () => {
    canned.response = json(orderOk());
    const order = await client.getOrder(ORDER_ID);

    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.equal(call.url, `${API}/pgw/api/v1/direct/order/${ORDER_ID}`);
    assert.equal(call.init.method, "GET");
    const headers = headersOf(call);
    assert.equal(headers.Authorization, BASIC);
    assert.equal(headers.Accept, "application/json");
    assert.equal(headers["Content-Type"], undefined);
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.cache, "no-store");
    assert.ok(call.init.signal instanceof AbortSignal);

    assert.deepEqual(order, {
      orderId: ORDER_ID,
      status: "Success",
      detailedStatus: "Paid",
      amount: 19.99,
      currency: "SAR",
      merchantReferenceId: REF,
      totalRefundedAmount: null,
    });
  });

  test("optional fields decode when present and drop to null when absent", async () => {
    canned.response = json(
      orderOk({ detailedStatus: undefined, merchantReferenceId: null, totalRefundedAmount: 5.5 })
    );
    const order = await client.getOrder(ORDER_ID);
    assert.equal(order.detailedStatus, null);
    assert.equal(order.merchantReferenceId, null);
    assert.equal(order.totalRefundedAmount, 5.5);
  });

  test("unknown fields are dropped", async () => {
    canned.response = json(orderOk({ transactions: [{ token: "t" }], customerEmail: "x@y.z" }));
    const order = await client.getOrder(ORDER_ID);
    assert.deepEqual(Object.keys(order).sort(), [
      "amount",
      "currency",
      "detailedStatus",
      "merchantReferenceId",
      "orderId",
      "status",
      "totalRefundedAmount",
    ]);
    assert.ok(!JSON.stringify(order).includes("x@y.z"));
  });

  test("an id that is not a UUID never reaches the URL", async () => {
    for (const orderId of [
      "",
      "abc",
      "../../admin",
      `${ORDER_ID}?x=1`,
      `${ORDER_ID}/..`,
      `${ORDER_ID} `,
      "3c0e2b5a-9d4f-4c1b-8e2a-6f7b8c9d0e1g",
    ]) {
      await rejectsWith(client.getOrder(orderId), client.GeideaRequestError);
      assert.equal(calls.length, 0, JSON.stringify(orderId));
    }
    await rejectsWith(client.getOrder(undefined as unknown as string), client.GeideaRequestError);
    assert.equal(calls.length, 0);
  });

  test("a malformed order is refused, naming the path", async () => {
    const cases: [string, () => Response, string][] = [
      ["not JSON", text("oops"), "$"],
      ["no order", json({ responseCode: "000" }), "$.order"],
      ["orderId not a UUID", json(orderOk({ orderId: "42" })), "$.order.orderId"],
      ["status missing", json(orderOk({ status: undefined })), "$.order.status"],
      ["amount as string", json(orderOk({ amount: "19.99" })), "$.order.amount"],
      ["currency missing", json(orderOk({ currency: undefined })), "$.order.currency"],
      ["totalRefundedAmount as string", json(orderOk({ totalRefundedAmount: "5" })), "$.order.totalRefundedAmount"],
    ];
    for (const [name, response, path] of cases) {
      canned.response = response;
      const error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaResponseError);
      assert.equal(error.kind, "malformed", name);
      assert.equal(error.path, path, name);
      assertNoSecrets(error);
    }
  });

  test("an order with a different id is refused as a mismatch", async () => {
    canned.response = json(orderOk({ orderId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }));
    const error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaResponseError);
    assert.equal(error.kind, "mismatch");
    assert.equal(error.path, "$.order.orderId");
  });

  test("a non-000 responseCode is refused with the codes", async () => {
    canned.response = json({ ...orderOk(), responseCode: "200", detailedResponseCode: "203" });
    const error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaResponseError);
    assert.equal(error.kind, "rejected");
    assert.equal(error.responseCode, "200");
    assert.equal(error.detailedResponseCode, "203");
  });

  test("HTTP and transport failures are refused without leaking", async () => {
    canned.response = text("forbidden", 403);
    let error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaHttpError);
    assert.equal(error.status, 403);
    assertNoSecrets(error);

    canned.response = null;
    canned.failure = new Error(`timeout ${PW}`);
    error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaHttpError);
    assert.equal(error.status, 0);
    assertNoSecrets(error);
  });

  test("missing configuration is refused before anything is sent", async () => {
    envState.GEIDEA_API_BASE_URL = undefined;
    envState.GEIDEA_HPP_BASE_URL = undefined;
    const error = await rejectsWith(client.getOrder(ORDER_ID), client.GeideaConfigError);
    assert.ok(error.message.includes("GEIDEA_API_BASE_URL"));
    assert.ok(error.message.includes("GEIDEA_HPP_BASE_URL"));
    assert.equal(calls.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* The hosted-page URL                                                 */
/* ------------------------------------------------------------------ */

describe("checkoutRedirectUrl", () => {
  test("is the hosted checkout page on GEIDEA_HPP_BASE_URL", () => {
    assert.equal(client.checkoutRedirectUrl(SESSION_ID), `${HPP}/hpp/checkout/?${SESSION_ID}`);
  });

  test("refuses anything that is not a UUID", () => {
    for (const id of ["", "abc", `${SESSION_ID}&x=1`, `${SESSION_ID}#f`]) {
      assert.throws(() => client.checkoutRedirectUrl(id), client.GeideaRequestError);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Nothing leaked, nothing left the process                            */
/* ------------------------------------------------------------------ */

describe("no secret leaves the client, and no request leaves the process", () => {
  test("the client never logs", () => {
    assert.deepEqual(logs, []);
  });

  test("every recorded request targeted the fixture host, never Geidea", async () => {
    canned.response = json(sessionOk());
    await client.createSession(validInput(), deps());
    canned.response = json(orderOk());
    await client.getOrder(ORDER_ID);
    for (const call of calls) {
      assert.ok(call.url.startsWith(`${API}/`), call.url);
      assert.ok(!call.url.includes("geidea.net"), call.url);
    }
  });

  test("the module is silent and reads configuration only through lib/env", () => {
    const src = readFileSync(new URL("../lib/payments/geidea/client.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!src.includes("console."), "must not log");
    assert.ok(!src.includes("process.env"), "must read env only through lib/env");
    const sources = [...src.matchAll(/from "([^"]+)";/g)].map((m) => m[1]).sort();
    assert.deepEqual(
      sources,
      ["@/lib/env", "@/lib/payments/geidea/signature"],
      "the client may import only the env schema and the signature helper"
    );
    assert.ok(src.includes('typeof window !== "undefined"'), "must refuse to load in a browser");
  });
});
