/**
 * Checkout on Geidea, without Geidea.
 *
 * The real POST handler runs against real Requests. Prisma, the env module
 * and the Geidea client are doubles: the client records what it was asked to
 * create and answers a canned session or throws; global fetch throws, so
 * nothing can leave the process. The gate tests live in
 * stage-d3-checkout.test.ts; this file covers what happens after the gates:
 * trusted values, the attempt row, the URLs, the failure paths, and the
 * response the BuyButton relies on.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KEY = "abc123XY_key-one";
const PW = "unit-test-password-not-real";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class FakeDecimal {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  price: unknown;
  currency: string;
  slug: string;
  isActive: boolean;
  moderationStatus: string;
  fileUrl: string | null;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
  shop: { isActive: boolean; slug: string };
}

interface AttemptRow extends Record<string, unknown> {
  id: string;
  status: string;
}

const db: { product: ProductRow | null; attempts: AttemptRow[] } = { product: null, attempts: [] };
const ops: string[] = [];
const writes: { op: string; data: Record<string, unknown>; where?: Record<string, unknown> }[] = [];
const sessionCalls: Record<string, unknown>[] = [];
const logs: string[] = [];
const responses: Record<string, unknown>[] = [];

const state = {
  preLaunch: false,
  configured: true,
  mode: "test" as "test" | "production" | null,
  siteUrl: "https://saiflow.test" as string | undefined,
  createResult: null as null | ((input: Record<string, unknown>) => Record<string, unknown>),
  createError: null as Error | null,
};

const canned = (input: Record<string, unknown>) => ({
  session: {
    sessionId: SESSION_ID,
    amount: 49,
    currency: "SAR",
    status: "Initiated",
    expiryDate: "2026-09-21T20:02:17.5018991Z",
    merchantReferenceId: input.merchantReferenceId,
  },
  redirectUrl: `https://www.ksamerchant.geidea.net/hpp/checkout/?${SESSION_ID}`,
  timestamp: "2026/09/21 19:47:17",
});

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => row[k] === v);
}

const fakePrisma = {
  product: {
    findUnique: async () => {
      ops.push("product.findUnique");
      return db.product;
    },
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
  },
  paymentSession: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      ops.push("paymentSession.create");
      writes.push({ op: "paymentSession.create", data });
      const row: AttemptRow = { id: `ps_${db.attempts.length + 1}`, status: "CREATED", ...data };
      db.attempts.push(row);
      return { id: row.id };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      ops.push("paymentSession.updateMany");
      writes.push({ op: "paymentSession.updateMany", data, where });
      let count = 0;
      for (const row of db.attempts) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    },
  },
  order: {
    create: async () => {
      ops.push("order.create");
      throw new Error("checkout must never create an Order");
    },
  },
};

let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
  mock.module("@/lib/env", {
    namedExports: {
      env: {
        get PRE_LAUNCH_MODE() {
          return state.preLaunch;
        },
        get NEXTAUTH_URL() {
          return state.siteUrl;
        },
      },
    },
  });
  mock.module("@/lib/payments/geidea/client", {
    namedExports: {
      isGeideaConfigured: () => state.configured,
      geideaMode: () => state.mode,
      createSession: async (input: Record<string, unknown>) => {
        ops.push("createSession");
        sessionCalls.push(input);
        if (state.createError) throw state.createError;
        if (!state.createResult) throw new Error("test provided no result");
        return state.createResult(input);
      },
    },
  });
  globalThis.fetch = (async () => {
    throw new Error("network access is not permitted in tests");
  }) as typeof fetch;
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  }
  POST = (await import("../app/api/checkout/route.ts")).POST as typeof POST;
});

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: "prod_1",
  name: "Arabic Templates Pack",
  description: "A pack",
  price: new FakeDecimal("49"),
  currency: "SAR",
  slug: "arabic-templates-pack",
  isActive: true,
  moderationStatus: "APPROVED",
  fileUrl: "https://app.ufs.sh/f/abc123XY_key-one",
  fileKey: KEY,
  fileScanStatus: "SAFE",
  fileScanKey: KEY,
  shop: { isActive: true, slug: "my-shop" },
  ...over,
});

function reset() {
  db.product = product();
  db.attempts = [];
  ops.length = 0;
  writes.length = 0;
  sessionCalls.length = 0;
  state.preLaunch = false;
  state.configured = true;
  state.mode = "test";
  state.siteUrl = "https://saiflow.test";
  state.createResult = canned;
  state.createError = null;
}
beforeEach(reset);

let ipCounter = 0;
async function checkout(body: unknown = { productId: "prod_1" }, headers: Record<string, string> = {}) {
  // The real rate limiter is in play: each request gets its own address
  // unless a test pins one on purpose.
  ipCounter++;
  const address = `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  const res = await POST(
    new Request("https://saiflow.test/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": address, ...headers },
      body: JSON.stringify(body),
    })
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  responses.push(parsed);
  return { status: res.status, body: parsed };
}

const attempt = () => db.attempts[0];

function assertNoAttemptAndNoGeidea() {
  assert.equal(db.attempts.length, 0, "no attempt may be recorded");
  assert.equal(sessionCalls.length, 0, "Geidea must not be asked");
  assert.ok(!ops.includes("order.create"));
}

/* ------------------------------------------------------------------ */
/* Success                                                             */
/* ------------------------------------------------------------------ */

describe("a sellable product starts a Geidea session", () => {
  test("returns the hosted checkout URL in the shape the BuyButton expects", async () => {
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { url: `https://www.ksamerchant.geidea.net/hpp/checkout/?${SESSION_ID}` });
  });

  test("records the attempt before asking Geidea, then stores what Geidea returned", async () => {
    await checkout();
    assert.deepEqual(ops, ["product.findUnique", "paymentSession.create", "createSession", "paymentSession.updateMany"]);
    assert.equal(sessionCalls.length, 1);

    const created = writes[0].data;
    assert.equal(created.provider, "GEIDEA");
    assert.equal(created.productId, "prod_1");
    assert.equal(created.amount, db.product!.price, "the stored amount is the row's Decimal, untouched");
    assert.equal(created.currency, "SAR");
    assert.equal(created.environment, "TEST");
    assert.equal(created.status, "CREATED");
    assert.equal(created.buyerEmail, null);
    assert.match(String(created.merchantReferenceId), UUID_V4);
    const expiresAt = created.expiresAt as Date;
    assert.ok(expiresAt instanceof Date);
    assert.ok(Math.abs(expiresAt.getTime() - (Date.now() + 15 * 60 * 1000)) < 5000, "about 15 minutes ahead");

    const updated = writes[1];
    assert.deepEqual(updated.where, { id: "ps_1", status: "CREATED" });
    assert.equal(updated.data.providerSessionId, SESSION_ID);
    assert.equal(updated.data.status, "SESSION_CREATED");
    assert.equal((updated.data.expiresAt as Date).toISOString(), "2026-09-21T20:02:17.501Z", "Geidea's own expiry, truncated to milliseconds");

    assert.equal(attempt().status, "SESSION_CREATED");
    assert.equal(attempt().providerSessionId, SESSION_ID);
  });

  test("asks Geidea for the trusted amount, SAR, the fresh reference and SaiFlow's own URLs", async () => {
    await checkout();
    const input = sessionCalls[0];
    assert.deepEqual(Object.keys(input).sort(), ["amount", "callbackUrl", "currency", "language", "merchantReferenceId", "returnUrl"]);
    assert.equal(input.amount, "49.00");
    assert.equal(input.currency, "SAR");
    assert.equal(input.merchantReferenceId, writes[0].data.merchantReferenceId);
    assert.equal(input.callbackUrl, "https://saiflow.test/api/webhooks/geidea");
    assert.equal(input.returnUrl, `https://saiflow.test/success?ref=${input.merchantReferenceId}`);
    assert.equal(input.language, "ar", "Arabic-first default");
  });

  test("a fractional price is canonicalised, not rounded", async () => {
    db.product = product({ price: new FakeDecimal("19.5") });
    await checkout();
    assert.equal(sessionCalls[0].amount, "19.50");
  });

  test("every request gets a fresh reference", async () => {
    await checkout();
    await checkout();
    assert.notEqual(sessionCalls[0].merchantReferenceId, sessionCalls[1].merchantReferenceId);
    assert.equal(db.attempts.length, 2);
  });

  test("the hosted page follows the visitor's locale cookie, and only ar or en", async () => {
    await checkout({ productId: "prod_1" }, { cookie: "NEXT_LOCALE=en" });
    assert.equal(sessionCalls[0].language, "en");
    await checkout({ productId: "prod_1" }, { cookie: "other=1; NEXT_LOCALE=ar; x=2" });
    assert.equal(sessionCalls[1].language, "ar");
    await checkout({ productId: "prod_1" }, { cookie: "NEXT_LOCALE=fr" });
    assert.equal(sessionCalls[2].language, "ar");
    await checkout({ productId: "prod_1" }, { cookie: "NEXT_LOCALE=en; NEXT_LOCALE_X=1" });
    assert.equal(sessionCalls[3].language, "en");
  });

  test("an unparseable Geidea expiry falls back to fifteen minutes", async () => {
    state.createResult = (input) => ({ ...canned(input), session: { ...canned(input).session, expiryDate: "soon" } });
    await checkout();
    const expiresAt = writes[1].data.expiresAt as Date;
    assert.ok(Math.abs(expiresAt.getTime() - (Date.now() + 15 * 60 * 1000)) < 5000);
  });

  test("the origin's path is ignored: URLs are built on the origin alone", async () => {
    state.siteUrl = "https://saiflow.test/some/base";
    await checkout();
    assert.equal(sessionCalls[0].callbackUrl, "https://saiflow.test/api/webhooks/geidea");
  });

  test("localhost over http is allowed to form URLs during development", async () => {
    state.siteUrl = "http://localhost:3000";
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.equal(sessionCalls[0].callbackUrl, "http://localhost:3000/api/webhooks/geidea");
  });
});

/* ------------------------------------------------------------------ */
/* Nothing from the browser but the product id                         */
/* ------------------------------------------------------------------ */

describe("the browser controls nothing but which product", () => {
  test("price, amount, currency, provider, environment and both URLs in the body are ignored", async () => {
    const res = await checkout({
      productId: "prod_1",
      price: 0,
      amount: "0.01",
      currency: "USD",
      provider: "STRIPE",
      environment: "PRODUCTION",
      callbackUrl: "https://attacker.example/cb",
      returnUrl: "https://attacker.example/return",
      successUrl: "https://attacker.example/ok",
      merchantReferenceId: "00000000-0000-4000-8000-000000000000",
      buyerEmail: "attacker@example.test",
      language: "fr",
    });
    assert.equal(res.status, 200);
    const input = sessionCalls[0];
    assert.equal(input.amount, "49.00");
    assert.equal(input.currency, "SAR");
    assert.equal(input.callbackUrl, "https://saiflow.test/api/webhooks/geidea");
    assert.ok(String(input.returnUrl).startsWith("https://saiflow.test/success?ref="));
    assert.notEqual(input.merchantReferenceId, "00000000-0000-4000-8000-000000000000");
    assert.equal(input.language, "ar");
    const created = writes[0].data;
    assert.equal(created.environment, "TEST");
    assert.equal(created.provider, "GEIDEA");
    assert.equal(created.buyerEmail, null);
    assert.equal(created.currency, "SAR");
  });

  test("the route reads only productId from the body, structurally", () => {
    const src = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes("const { productId } = await req.json();"));
    assert.ok(!/req\.json\(\)[\s\S]*?(amount|price|currency|callbackUrl|returnUrl|email)\b\s*[=:]/.test(src.split("await req.json()")[1].slice(0, 80)));
  });
});

/* ------------------------------------------------------------------ */
/* Refusals before any attempt is recorded                             */
/* ------------------------------------------------------------------ */

describe("refusals record no attempt and ask Geidea nothing", () => {
  test("pre-launch still refuses first", async () => {
    state.preLaunch = true;
    const res = await checkout();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assert.deepEqual(ops, [], "not even the product is loaded");
    assertNoAttemptAndNoGeidea();
  });

  test("an unsafe or unsellable product still refuses, before payment", async () => {
    const cases: [string, Partial<ProductRow>][] = [
      ["pending scan", { fileScanStatus: "PENDING_SCAN", fileScanKey: null }],
      ["unsafe", { fileScanStatus: "UNSAFE" }],
      ["scan error", { fileScanStatus: "SCAN_ERROR" }],
      ["verdict for another key", { fileScanKey: "zzz999QQ_key-two" }],
      ["no file key", { fileKey: null, fileScanKey: null }],
      ["inactive", { isActive: false }],
      ["not approved", { moderationStatus: "PENDING" }],
      ["rejected", { moderationStatus: "REJECTED" }],
      ["inactive shop", { shop: { isActive: false, slug: "my-shop" } }],
      ["no file", { fileUrl: null }],
    ];
    for (const [name, over] of cases) {
      reset();
      db.product = product(over);
      const res = await checkout();
      assert.ok(res.status >= 400, name);
      assertNoAttemptAndNoGeidea();
    }
    reset();
    db.product = null;
    assert.equal((await checkout()).status, 404);
    assertNoAttemptAndNoGeidea();
  });

  test("a production Geidea account is refused during the test phase", async () => {
    state.mode = "production";
    const res = await checkout();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assertNoAttemptAndNoGeidea();
  });

  test("a missing GEIDEA_ENV fails closed as not configured", async () => {
    state.mode = null;
    state.configured = false;
    let res = await checkout();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assertNoAttemptAndNoGeidea();

    // Even if the client double claimed configured, a null mode is refused:
    // the route never infers an environment.
    reset();
    state.mode = null;
    state.configured = true;
    res = await checkout();
    assert.equal(res.status, 503);
    assertNoAttemptAndNoGeidea();
  });

  test("explicit test mode records TEST", async () => {
    state.mode = "test";
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.equal(writes[0].data.environment, "TEST");
  });

  test("an unconfigured Geidea is refused like pre-launch", async () => {
    state.configured = false;
    const res = await checkout();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assertNoAttemptAndNoGeidea();
  });

  test("a product not priced in SAR, or with an unsellable price, is refused", async () => {
    for (const over of [{ currency: "USD" }, { price: new FakeDecimal("0") }, { price: new FakeDecimal("0.00") }, { price: new FakeDecimal("1.005") }]) {
      reset();
      db.product = product(over);
      const res = await checkout();
      assert.equal(res.status, 400, JSON.stringify(over));
      assert.equal(res.body.error, "not_available");
      assertNoAttemptAndNoGeidea();
    }
  });

  test("a missing or untrusted site origin is refused before any attempt is recorded", async () => {
    for (const siteUrl of [undefined, "", "not a url", "http://www.saiflow.io", "ftp://saiflow.test", "http://evil.localhost.example"]) {
      reset();
      state.siteUrl = siteUrl;
      const res = await checkout();
      assert.equal(res.status, 503, String(siteUrl));
      assert.equal(res.body.error, "pre_launch");
      assertNoAttemptAndNoGeidea();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Geidea failure                                                      */
/* ------------------------------------------------------------------ */

describe("when Geidea cannot create the session", () => {
  test("the attempt is closed as failed, no Order exists, and the buyer gets a safe error", async () => {
    state.createError = Object.assign(new Error("Geidea createSession: rejected with responseCode 100/123 (HTTP 400)"), {
      name: "GeideaResponseError",
      kind: "rejected",
      status: 400,
      responseCode: "100",
      detailedResponseCode: "123",
    });
    const res = await checkout();
    assert.equal(res.status, 502);
    assert.deepEqual(Object.keys(res.body).sort(), ["error", "message"]);
    assert.equal(res.body.error, "payment_unavailable");
    assert.equal(attempt().status, "FAILED");
    assert.equal(attempt().failureReason, "session_create_failed");
    assert.equal(attempt().providerSessionId, undefined);
    assert.ok(!ops.includes("order.create"));
    assert.deepEqual(writes[1].where, { id: "ps_1", status: "CREATED" });
  });

  test("a transport failure is handled the same way", async () => {
    state.createError = Object.assign(new Error(`Geidea createSession: no response (TypeError)`), { name: "GeideaHttpError", status: 0 });
    const res = await checkout();
    assert.equal(res.status, 502);
    assert.equal(attempt().status, "FAILED");
  });

  test("a failure that already moved the attempt is not overwritten", async () => {
    state.createError = Object.assign(new Error("Geidea createSession: HTTP 500"), { name: "GeideaHttpError", status: 500 });
    const original = fakePrisma.paymentSession.updateMany;
    fakePrisma.paymentSession.updateMany = async (args) => {
      // Simulate the row having been settled by something else first.
      db.attempts[0].status = "PAID";
      return original(args);
    };
    try {
      await checkout();
      assert.equal(attempt().status, "PAID", "a conditional update must not downgrade it");
    } finally {
      fakePrisma.paymentSession.updateMany = original;
    }
  });
});

/* ------------------------------------------------------------------ */
/* Gates and authority unchanged                                       */
/* ------------------------------------------------------------------ */

describe("the pre-existing gates and the safety authority are unchanged", () => {
  const src = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");

  test("pre-launch, product, moderation, shop, file and the safety predicate precede any payment code", () => {
    const order = [
      "env.PRE_LAUNCH_MODE",
      "rateLimiters.checkout(",
      "await req.json()",
      "prisma.product.findUnique",
      'moderationStatus !== "APPROVED"',
      "!product.fileUrl",
      "if (!isDeliverableSafe(product))",
      "isGeideaConfigured()",
      "paymentSession.create",
      "await createSession(",
    ];
    let last = -1;
    for (const marker of order) {
      const at = src.indexOf(marker);
      assert.ok(at > last, `${marker} must come after the previous gate`);
      last = at;
    }
    assert.ok(src.includes('import { isDeliverableSafe } from "@/lib/file-safety"'));
    assert.ok(!/fileScanStatus\s*===/.test(src));
    assert.ok(!/fileScanKey\s*===/.test(src));
    assert.ok(!src.includes("deliverableGateReason"));
  });

  test("the route never creates an Order, signs, delivers or scans", () => {
    assert.ok(!src.includes("order.create"));
    assert.ok(!src.includes("createDeliveryUrl"));
    assert.ok(!src.includes("readPrivateObject"));
    assert.ok(!src.includes("scanFileAsset"));
    assert.ok(!src.includes("createHmac"));
    assert.ok(!src.includes("stripe"), "Stripe is gone from checkout");
  });

  test("the live-money guard is present and off, and the mode is read once, explicitly", () => {
    assert.ok(src.includes("const LIVE_GEIDEA_ALLOWED = false;"));
    assert.ok(src.includes('configuredMode !== "test"'));
    assert.ok(src.includes("configuredMode === null"), "a missing GEIDEA_ENV is refused as unconfigured");
  });
});

/* ------------------------------------------------------------------ */
/* Abuse limiting                                                      */
/* ------------------------------------------------------------------ */

describe("checkout is rate limited before anything is read", () => {
  test("fifteen requests in ten minutes from one address succeed; the sixteenth is refused untouched", async () => {
    const fixed = { "x-forwarded-for": "203.0.113.55" };
    for (let i = 0; i < 15; i++) {
      const res = await checkout({ productId: "prod_1" }, fixed);
      assert.equal(res.status, 200, `request ${i + 1} must still succeed`);
    }
    ops.length = 0;
    writes.length = 0;
    sessionCalls.length = 0;
    db.attempts = [];
    const res = await checkout({ productId: "prod_1" }, fixed);
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, { error: "Too many requests" });
    assert.deepEqual(ops, [], "no product lookup, no attempt, no provider call");
    assertNoAttemptAndNoGeidea();
  });

  test("a limited caller learns nothing about whether a product exists", async () => {
    const fixed = { "x-forwarded-for": "203.0.113.56" };
    for (let i = 0; i < 15; i++) await checkout({ productId: "prod_1" }, fixed);
    db.product = null;
    ops.length = 0;
    const res = await checkout({ productId: "prod_1" }, fixed);
    assert.equal(res.status, 429, "429, never 404");
    assert.deepEqual(ops, []);
  });

  test("addresses are limited independently", async () => {
    const a = { "x-forwarded-for": "203.0.113.57" };
    const b = { "x-forwarded-for": "203.0.113.58" };
    for (let i = 0; i < 15; i++) await checkout({ productId: "prod_1" }, a);
    assert.equal((await checkout({ productId: "prod_1" }, a)).status, 429);
    assert.equal((await checkout({ productId: "prod_1" }, b)).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

describe("the merchant reference never appears in a log line in full", () => {
  test("session-created and failure lines carry an eight-character prefix only", async () => {
    logs.length = 0;
    await checkout();
    const created = String(writes[0].data.merchantReferenceId);
    state.createError = Object.assign(new Error("Geidea createSession: HTTP 500"), { name: "GeideaHttpError", status: 500 });
    await checkout();
    const failed = String(writes[2].data.merchantReferenceId);
    assert.ok(logs.some((l) => l.includes("session_created")));
    assert.ok(logs.some((l) => l.includes("session_create_failed")));
    for (const line of logs) {
      assert.ok(!line.includes(created), `full reference in log: ${line}`);
      assert.ok(!line.includes(failed), `full reference in log: ${line}`);
    }
    assert.ok(logs.some((l) => l.includes(`ref=${created.slice(0, 8)}…`)), "a prefix remains for correlation");
  });
});

/* ------------------------------------------------------------------ */
/* Nothing leaks                                                       */
/* ------------------------------------------------------------------ */

describe("no secret appears in logs, errors or responses", () => {
  test("after success and failure", async () => {
    await checkout();
    state.createError = Object.assign(new Error(`boom ${PW} Authorization: Basic abc`), { name: "TypeError" });
    await checkout();
    const text = logs.join("\n") + "\n" + JSON.stringify(responses);
    for (const value of [PW, "Authorization", "Basic ", "signature", "boom"]) {
      assert.ok(!text.includes(value), `leaked ${value}`);
    }
    for (const line of logs) {
      assert.ok(line.startsWith("[Checkout] "), line);
      assert.ok(!line.includes("{"), "no object dumps");
      assert.ok(!line.includes("http"), "no URLs in logs");
    }
  });
});
