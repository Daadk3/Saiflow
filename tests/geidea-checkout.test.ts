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
 *
 * Unless a test says otherwise, every request is a browser that already
 * holds its own checkout identity: the cookie the route issues, with nothing
 * else, to a request that has none. The tests of that first request, and of
 * everything that keeps one browser to one payable session, are at the end.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";

const KEY = "abc123XY_key-one";
const PW = "unit-test-password-not-real";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const SCRIPT_URL = "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js";
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
/** Lets a test stage a race: what the lookup sees before the insert. */
let findUniqueOverride: ((where: Record<string, unknown>) => unknown) | null = null;
/** Lets a test make the attempt insert itself fail. */
let createError: Error | null = null;
/**
 * Lets a test commit a concurrent write just before an updateMany is
 * evaluated, the way another transaction's commit lands before Postgres
 * re-checks an UPDATE's WHERE clause on the same row.
 */
let beforeUpdate: ((where: Record<string, unknown>) => void) | null = null;
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
  createResult: null as
    | null
    | ((input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>),
  createError: null as Error | null,
  scriptError: null as Error | null,
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

/** A WHERE clause of plain equalities, or `{ not }`; a column never written is NULL, as in the database. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v !== null && typeof v === "object" && "not" in (v as object)) return (row[k] ?? null) !== (v as { not: unknown }).not;
    return (row[k] ?? null) === v;
  });
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
    // This browser's current attempt for a product, found by its unique key.
    findUnique: async ({ where }: { where: { currentAttemptKey?: string } }) => {
      ops.push("paymentSession.findUnique");
      if (findUniqueOverride) return findUniqueOverride(where);
      const row = db.attempts.find((r) => typeof r.currentAttemptKey === "string" && r.currentAttemptKey === where.currentAttemptKey);
      return row ? { ...row, order: (row.order as { id: string } | undefined) ?? null } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      ops.push("paymentSession.create");
      if (createError) throw createError;
      // The database's unique index on currentAttemptKey.
      if (typeof data.currentAttemptKey === "string" && db.attempts.some((r) => r.currentAttemptKey === data.currentAttemptKey)) {
        ops.push("paymentSession.create:P2002");
        throw Object.assign(new Error("Unique constraint failed on the fields: (`currentAttemptKey`)"), { code: "P2002" });
      }
      writes.push({ op: "paymentSession.create", data });
      const row: AttemptRow = { id: `ps_${db.attempts.length + 1}`, status: "CREATED", createdAt: new Date(), ...data };
      db.attempts.push(row);
      return { id: row.id };
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      ops.push("paymentSession.updateMany");
      if (beforeUpdate) beforeUpdate(where);
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
      checkoutScriptUrl: () => {
        if (state.scriptError) throw state.scriptError;
        return SCRIPT_URL;
      },
      checkoutRedirectUrl: (sessionId: string) => `https://www.ksamerchant.geidea.net/hpp/checkout/?${sessionId}`,
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
  findUniqueOverride = null;
  createError = null;
  beforeUpdate = null;
  ops.length = 0;
  writes.length = 0;
  sessionCalls.length = 0;
  state.preLaunch = false;
  state.configured = true;
  state.mode = "test";
  state.siteUrl = "https://saiflow.test";
  state.createResult = canned;
  state.createError = null;
  state.scriptError = null;
}
beforeEach(reset);

const IDENTITY_COOKIE = "saiflow_checkout";

/**
 * A browser that already holds its own checkout identity, so the request
 * goes past the identity step: a fresh one for each call, unless the test
 * passes one in its cookie header.
 */
function identified(headers: Record<string, string>): Record<string, string> {
  const cookie = headers.cookie ?? "";
  if (cookie.includes(`${IDENTITY_COOKIE}=`)) return headers;
  const identity = `${IDENTITY_COOKIE}=${randomBytes(32).toString("base64url")}`;
  return { ...headers, cookie: cookie === "" ? identity : `${cookie}; ${identity}` };
}

let ipCounter = 0;
async function checkout(body: unknown = { productId: "prod_1", buyerEmail: "buyer@example.com" }, headers: Record<string, string> = {}) {
  // The real rate limiter is in play: each request gets its own address
  // unless a test pins one on purpose.
  ipCounter++;
  const address = `10.9.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  const res = await POST(
    new Request("https://saiflow.test/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": address, ...identified(headers) },
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
    assert.deepEqual(ops, [
      "product.findUnique",
      "paymentSession.findUnique",
      "paymentSession.create",
      "createSession",
      "paymentSession.updateMany",
    ]);
    assert.equal(sessionCalls.length, 1);

    const created = writes[0].data;
    assert.equal(created.provider, "GEIDEA");
    assert.equal(created.productId, "prod_1");
    assert.equal(created.amount, db.product!.price, "the stored amount is the row's Decimal, untouched");
    assert.equal(created.currency, "SAR");
    assert.equal(created.environment, "TEST");
    assert.equal(created.status, "CREATED");
    assert.equal(created.buyerEmail, "buyer@example.com", "the receipt address the page collected");
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
    assert.equal(input.callbackUrl, "https://project-w5bhm.vercel.app/api/geidea-callback", "test-account callbacks go to the relay");
    assert.equal(input.returnUrl, `https://saiflow.test/success?ref=${input.merchantReferenceId}`);
    assert.equal(input.language, "ar", "Arabic-first default");
  });

  test("a fractional price is canonicalised, not rounded", async () => {
    db.product = product({ price: new FakeDecimal("19.5") });
    await checkout();
    assert.equal(sessionCalls[0].amount, "19.50");
  });

  test("every new browser's attempt gets a fresh reference", async () => {
    await checkout();
    await checkout();
    assert.notEqual(sessionCalls[0].merchantReferenceId, sessionCalls[1].merchantReferenceId);
    assert.equal(db.attempts.length, 2);
  });

  test("the hosted page follows the visitor's locale cookie, and only ar or en", async () => {
    await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, { cookie: "NEXT_LOCALE=en" });
    assert.equal(sessionCalls[0].language, "en");
    await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, { cookie: "other=1; NEXT_LOCALE=ar; x=2" });
    assert.equal(sessionCalls[1].language, "ar");
    await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, { cookie: "NEXT_LOCALE=fr" });
    assert.equal(sessionCalls[2].language, "ar");
    await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, { cookie: "NEXT_LOCALE=en; NEXT_LOCALE_X=1" });
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
    assert.equal(sessionCalls[0].returnUrl, `https://saiflow.test/success?ref=${sessionCalls[0].merchantReferenceId}`);
  });

  test("the test-account callback goes to the fixed relay; a production account keeps its own URL", () => {
    const src = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes('const TEST_CALLBACK_RELAY_URL = "https://project-w5bhm.vercel.app/api/geidea-callback";'));
    assert.match(
      src,
      /const callbackUrl =\s*environment === "TEST" \? TEST_CALLBACK_RELAY_URL : new URL\("\/api\/webhooks\/geidea", origin\)\.toString\(\);/
    );
    assert.equal(src.split("TEST_CALLBACK_RELAY_URL").length - 1, 2, "defined once, used once, never from config or the request");
  });

  test("localhost over http is allowed to form URLs during development", async () => {
    state.siteUrl = "http://localhost:3000";
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.equal(sessionCalls[0].returnUrl, `http://localhost:3000/success?ref=${sessionCalls[0].merchantReferenceId}`);
  });
});

/* ------------------------------------------------------------------ */
/* Nothing from the browser but the product id                         */
/* ------------------------------------------------------------------ */

describe("the browser controls nothing but which product, and where its receipt goes", () => {
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
      buyerEmail: "  Receipt@Example.TEST ",
      language: "fr",
    });
    assert.equal(res.status, 200);
    const input = sessionCalls[0];
    assert.equal(input.amount, "49.00");
    assert.equal(input.currency, "SAR");
    assert.equal(input.callbackUrl, "https://project-w5bhm.vercel.app/api/geidea-callback", "test-account callbacks go to the relay");
    assert.ok(String(input.returnUrl).startsWith("https://saiflow.test/success?ref="));
    assert.notEqual(input.merchantReferenceId, "00000000-0000-4000-8000-000000000000");
    assert.equal(input.language, "ar");
    const created = writes[0].data;
    assert.equal(created.environment, "TEST");
    assert.equal(created.provider, "GEIDEA");
    assert.equal(created.buyerEmail, "receipt@example.test", "the receipt address, trimmed and lower-cased, and nothing else from the body");
    assert.equal(created.currency, "SAR");
  });

  test("the route reads only productId and the receipt address from the body, structurally", () => {
    const src = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
    assert.ok(src.includes("const { productId, buyerEmail: submittedEmail } = await req.json();"));
    assert.ok(src.includes("const buyerEmail = normalizeBuyerEmail(submittedEmail);"));
    assert.equal(src.split("submittedEmail").length - 1, 2, "the submitted address is used only through the shared rule");
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

  test("no usable receipt address: refused before the product is read, nothing recorded, Geidea not asked", async () => {
    const addresses: unknown[] = [undefined, null, "", "   ", "buyer", "buyer@example", "a@@b.co", "buyer@example.com\r\nBcc: x@y.co", 42];
    for (const buyerEmail of addresses) {
      reset();
      const res = await checkout({ productId: "prod_1", buyerEmail });
      assert.equal(res.status, 400, JSON.stringify(buyerEmail));
      assert.deepEqual(res.body, { error: "invalid_email" });
      assert.deepEqual(ops, [], "not even the product is loaded");
      assertNoAttemptAndNoGeidea();
    }
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
    // No session id reached any browser, so it stops being current at once.
    assert.equal(writes[1].data.currentAttemptKey, null);
    assert.equal(attempt().currentAttemptKey, null);
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
      const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, fixed);
      assert.equal(res.status, 200, `request ${i + 1} must still succeed`);
    }
    ops.length = 0;
    writes.length = 0;
    sessionCalls.length = 0;
    db.attempts = [];
    const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, fixed);
    assert.equal(res.status, 429);
    assert.deepEqual(res.body, { error: "Too many requests" });
    assert.deepEqual(ops, [], "no product lookup, no attempt, no provider call");
    assertNoAttemptAndNoGeidea();
  });

  test("a limited caller learns nothing about whether a product exists", async () => {
    const fixed = { "x-forwarded-for": "203.0.113.56" };
    for (let i = 0; i < 15; i++) await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, fixed);
    db.product = null;
    ops.length = 0;
    const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, fixed);
    assert.equal(res.status, 429, "429, never 404");
    assert.deepEqual(ops, []);
  });

  test("addresses are limited independently", async () => {
    const a = { "x-forwarded-for": "203.0.113.57" };
    const b = { "x-forwarded-for": "203.0.113.58" };
    for (let i = 0; i < 15; i++) await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, a);
    assert.equal((await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, a)).status, 429);
    assert.equal((await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" }, b)).status, 200);
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

/* ------------------------------------------------------------------ */
/* The embedded (drop-in) presentation                                  */
/* ------------------------------------------------------------------ */

const DROPIN_APPEARANCE = {
  uiMode: "dropin",
  showEmail: false,
  showAddress: false,
  showPhone: false,
  receiptPage: false,
  merchant: { name: "SaiFlow" },
  styles: { headerColor: "#14b8a6", hideGeideaLogo: true, hppProfile: "compressed" },
};

async function checkoutWith(query: string, body: unknown = { productId: "prod_1", buyerEmail: "buyer@example.com" }, headers: Record<string, string> = {}) {
  ipCounter++;
  const address = `10.8.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  const res = await POST(
    new Request(`https://saiflow.test/api/checkout${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": address, ...identified(headers) },
      body: JSON.stringify(body),
    })
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  responses.push(parsed);
  return { status: res.status, body: parsed };
}
const dropin = (body?: unknown, headers?: Record<string, string>) => checkoutWith("?presentation=dropin", body, headers);

describe("the embedded presentation asks for Geidea's drop-in and changes nothing else", () => {
  test("Geidea is asked for the documented drop-in appearance, beside the same trusted values", async () => {
    await dropin();
    const input = sessionCalls[0];
    assert.deepEqual(Object.keys(input).sort(), ["amount", "appearance", "callbackUrl", "currency", "language", "merchantReferenceId", "returnUrl"]);
    assert.deepEqual(input.appearance, DROPIN_APPEARANCE);
    assert.equal(input.amount, "49.00");
    assert.equal(input.currency, "SAR");
    assert.equal(input.callbackUrl, "https://project-w5bhm.vercel.app/api/geidea-callback", "test-account callbacks go to the relay");
    assert.equal(input.returnUrl, `https://saiflow.test/success?ref=${input.merchantReferenceId}`);
    assert.equal(input.language, "ar");
  });

  test("the reply is exactly the session, Geidea's library, the expiry and SaiFlow's success path", async () => {
    const res = await dropin();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ["expiresAt", "scriptUrl", "sessionId", "successPath"]);
    assert.equal(res.body.sessionId, SESSION_ID);
    assert.equal(res.body.scriptUrl, SCRIPT_URL, "the library URL comes from the configured client, never the request");
    assert.equal(res.body.expiresAt, "2026-09-21T20:02:17.501Z", "Geidea's own expiry, as recorded on the attempt");
    const ref = String(writes[0].data.merchantReferenceId);
    assert.equal(res.body.successPath, `/success?ref=${ref}`, "the same reference the hosted page would return with");
    assert.equal((writes[1].data.expiresAt as Date).toISOString(), res.body.expiresAt);
  });

  test("the attempt row, the order of operations and the stored values are identical in both presentations", async () => {
    await checkout();
    await dropin();
    const [redirectRow, dropinRow] = writes.filter((w) => w.op === "paymentSession.create").map((w) => w.data);
    // Each call is its own browser, with its own identity, so its bearer
    // differs; the presentation is recorded so a resume never switches it.
    const comparable = (row: Record<string, unknown>) => {
      const {
        merchantReferenceId: _ref,
        expiresAt: _exp,
        clientTokenHash: _hash,
        currentAttemptKey: _key,
        presentation: _presentation,
        ...rest
      } = row;
      void [_ref, _exp, _hash, _key, _presentation];
      return rest;
    };
    assert.deepEqual(comparable(dropinRow), comparable(redirectRow));
    assert.equal(redirectRow.presentation, "REDIRECT");
    assert.equal(dropinRow.presentation, "DROPIN");
    assert.deepEqual(
      ops,
      ["product.findUnique", "paymentSession.findUnique", "paymentSession.create", "createSession", "paymentSession.updateMany",
       "product.findUnique", "paymentSession.findUnique", "paymentSession.create", "createSession", "paymentSession.updateMany"]
    );
  });

  test("without the selector the request and the reply are exactly what they were", async () => {
    const res = await checkout();
    assert.deepEqual(res.body, { url: `https://www.ksamerchant.geidea.net/hpp/checkout/?${SESSION_ID}` });
    assert.ok(!("appearance" in sessionCalls[0]), "the hosted page keeps Geidea's defaults");
  });

  test("an unknown presentation is refused before the body, the product or Geidea is touched", async () => {
    for (const query of ["?presentation=modal", "?presentation=redirection", "?presentation=", "?presentation=DROPIN", "?presentation=dropin%20"]) {
      reset();
      const res = await checkoutWith(query);
      assert.equal(res.status, 400, query);
      assert.deepEqual(res.body, { error: "invalid_presentation" });
      assert.deepEqual(ops, [], `${query}: nothing was read`);
      assertNoAttemptAndNoGeidea();
    }
  });

  test("the query string chooses the presentation and nothing else", async () => {
    const res = await checkoutWith(
      "?presentation=dropin&amount=0.01&currency=USD&returnUrl=https%3A%2F%2Fattacker.example%2F&successPath=%2F%2Fattacker.example&scriptUrl=https%3A%2F%2Fattacker.example%2Fx.js"
    );
    assert.equal(res.status, 200);
    const input = sessionCalls[0];
    assert.equal(input.amount, "49.00");
    assert.equal(input.currency, "SAR");
    assert.ok(String(input.returnUrl).startsWith("https://saiflow.test/success?ref="));
    assert.equal(res.body.scriptUrl, SCRIPT_URL);
    assert.match(String(res.body.successPath), /^\/success\?ref=[0-9a-f-]{36}$/);
  });

  test("a hosted-page host that cannot serve the library refuses before any attempt is recorded", async () => {
    state.scriptError = Object.assign(new Error("GEIDEA_HPP_BASE_URL must be https to serve the checkout script"), { name: "GeideaConfigError" });
    const res = await dropin();
    assert.equal(res.status, 503);
    assert.deepEqual(Object.keys(res.body).sort(), ["error", "message"]);
    assert.equal(res.body.error, "payment_unavailable");
    assertNoAttemptAndNoGeidea();
    assert.ok(logs.some((l) => l.includes("[Checkout] refused") && l.includes("reason=script_url")));
  });

  test("the hosted-page presentation never needs the library, so its failure cannot affect it", async () => {
    state.scriptError = new Error("unreachable");
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ["url"]);
  });

  test("every gate still applies: pre-launch, an unsafe product, an unconfigured Geidea, a live account", async () => {
    state.preLaunch = true;
    assert.equal((await dropin()).status, 503);
    assertNoAttemptAndNoGeidea();

    reset();
    db.product = product({ fileScanStatus: "SCAN_ERROR" });
    const unsafe = await dropin();
    assert.equal(unsafe.status, 400);
    assert.equal(unsafe.body.error, "file_not_ready");
    assertNoAttemptAndNoGeidea();

    reset();
    db.product = product({ moderationStatus: "PENDING" });
    assert.equal((await dropin()).status, 400);
    assertNoAttemptAndNoGeidea();

    reset();
    state.configured = false;
    assert.equal((await dropin()).status, 503);
    assertNoAttemptAndNoGeidea();

    reset();
    state.mode = "production";
    assert.equal((await dropin()).status, 503);
    assertNoAttemptAndNoGeidea();
  });

  test("a failed Geidea session closes the attempt as failed, exactly as for the hosted page", async () => {
    state.createError = new Error("upstream");
    const res = await dropin();
    assert.equal(res.status, 502);
    assert.equal(res.body.error, "payment_unavailable");
    assert.equal(attempt().status, "FAILED");
    assert.equal(attempt().failureReason, "session_create_failed");
    assert.ok(!ops.includes("order.create"));
  });

  test("the reply carries no credential, no order id, no hosted URL and no amount", async () => {
    const res = await dropin();
    const text = JSON.stringify(res.body);
    for (const leak of [PW, KEY, "hpp/checkout", "orderId", "amount", "price", "Decimal"]) {
      assert.ok(!text.includes(leak), `reply carries ${leak}`);
    }
  });

  test("the session-created log line names the presentation, and the reference stays redacted", async () => {
    logs.length = 0;
    await dropin();
    const line = logs.filter((l) => l.includes("[Checkout] session_created")).pop();
    assert.ok(line);
    assert.ok(line.includes("presentation=dropin"));
    assert.ok(!line.includes(String(writes[0].data.merchantReferenceId)));
  });
});

/* ------------------------------------------------------------------ */
/* One current attempt per browser and product                         */
/* ------------------------------------------------------------------ */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Geidea's own expiry for a session, as an ISO string some minutes from now. */
const expiryIn = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();
/** A canned Geidea session that expires in fifteen minutes, unlike the fixed 2026-09-21 one. */
const liveSession = (input: Record<string, unknown>) => {
  const reply = canned(input);
  return { ...reply, session: { ...reply.session, expiryDate: expiryIn(15) } };
};
/** The same, for a named session id. */
const liveSessionWithId = (sessionId: string) => (input: Record<string, unknown>) => {
  const reply = liveSession(input);
  return { ...reply, session: { ...reply.session, sessionId } };
};
const SESSION_A = "aaaaaaaa-1111-4222-8333-444444444444";
const SESSION_B = "bbbbbbbb-5555-4666-8777-888888888888";

async function send(query: string, cookie?: string, body: unknown = { productId: "prod_1", buyerEmail: "buyer@example.com" }) {
  ipCounter++;
  const address = `10.7.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  const res = await POST(
    new Request(`https://saiflow.test/api/checkout${query}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": address,
        ...(cookie === undefined ? {} : { cookie }),
      },
      body: JSON.stringify(body),
    })
  );
  const parsed = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: parsed, setCookie: res.headers.get("set-cookie") };
}
type Reply = Awaited<ReturnType<typeof send>>;
const DROPIN = "?presentation=dropin";
const HOSTED = "";
const bearerIn = (setCookie: string | null): string => {
  const match = /(?:^|;\s*)saiflow_checkout=([A-Za-z0-9_-]{43})(?:;|$)/.exec(setCookie ?? "");
  assert.ok(match, `a bearer cookie was set: ${setCookie}`);
  return match![1];
};
const cookieFor = (bearer: string) => `NEXT_LOCALE=en; saiflow_checkout=${bearer}`;
const bearerOf = (cookie: string) => cookie.split("saiflow_checkout=")[1];
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const keyFor = (bearer: string) => `${sha256(bearer)}:prod_1`;
const statusPathOf = (row: AttemptRow) => `/success?ref=${row.merchantReferenceId}`;

/** A browser's first checkout request: it holds no identity yet. Returns the cookie it is issued. */
async function identify(query = DROPIN): Promise<string> {
  const res = await send(query);
  assert.equal(res.status, 428);
  return cookieFor(bearerIn(res.setCookie));
}

/** A browser that has started one embedded attempt; returns its first reply and its cookie. */
async function startedBrowser() {
  state.createResult = liveSession;
  const cookie = await identify();
  const first = await send(DROPIN, cookie);
  assert.equal(first.status, 200);
  return { first, cookie };
}

/** An attempt already in the database, made for `bearer`; by default a live drop-in session. */
function seedAttempt(bearer: string, over: Record<string, unknown> = {}): AttemptRow {
  const row: AttemptRow = {
    id: `ps_seed_${db.attempts.length + 1}`,
    status: "SESSION_CREATED",
    merchantReferenceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    clientTokenHash: sha256(bearer),
    currentAttemptKey: keyFor(bearer),
    productId: "prod_1",
    provider: "GEIDEA",
    environment: "TEST",
    amount: new FakeDecimal("49"),
    currency: "SAR",
    presentation: "DROPIN",
    providerSessionId: SESSION_ID,
    failureReason: null,
    createdAt: new Date(Date.now() - 5 * MINUTE),
    expiresAt: new Date(Date.now() + 10 * MINUTE),
    ...over,
  };
  db.attempts.push(row);
  return row;
}

/** An attempt whose session request stored no session id, older than the pending window. */
const seedUnstarted = (bearer: string) =>
  seedAttempt(bearer, { status: "CREATED", providerSessionId: null, createdAt: new Date(Date.now() - 3 * MINUTE) });

/** What the verified callback's fulfilment transaction commits, together: the claim and the Order. */
function fulfil(row: AttemptRow) {
  row.status = "PAID";
  row.order = { id: `order_${row.id}` };
}

function assertNoSecondSession() {
  assert.equal(db.attempts.length, 1, "still exactly one attempt");
  assert.equal(sessionCalls.length, 1, "Geidea was asked once, ever");
}

/* ------------------------------------------------------------------ */
/* A. The identity exists before anything payable does                 */
/* ------------------------------------------------------------------ */

describe("A. a browser holds its checkout identity before any payable session exists", () => {
  test("a request without one is issued one, and nothing else: no lookup, no attempt, no Geidea call", async () => {
    for (const query of [DROPIN, HOSTED]) {
      ops.length = 0;
      const res = await send(query);
      assert.equal(res.status, 428, query);
      assert.deepEqual(res.body, { error: "identity_required" });
      assert.match(bearerIn(res.setCookie), /^[A-Za-z0-9_-]{43}$/);
      assert.deepEqual(ops, ["product.findUnique"], "the gates ran; nothing about an attempt did");
    }
    assert.equal(db.attempts.length, 0);
    assert.equal(sessionCalls.length, 0);
  });

  test("it is an HttpOnly, SameSite=Lax, Secure cookie scoped to the checkout route, and only its hash is stored", async () => {
    state.createResult = liveSession;
    const issued = await send(DROPIN);
    const parts = (issued.setCookie ?? "").split("; ");
    for (const part of ["Path=/api/checkout", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=604800"]) {
      assert.ok(parts.includes(part), part);
    }
    const bearer = bearerIn(issued.setCookie);
    const res = await send(DROPIN, cookieFor(bearer));
    assert.equal(res.status, 200);
    const row = db.attempts[0];
    assert.equal(row.clientTokenHash, sha256(bearer));
    assert.equal(row.currentAttemptKey, keyFor(bearer));
    assert.equal(row.presentation, "DROPIN");
    assert.ok(!JSON.stringify(db.attempts).includes(bearer), "the bearer itself is never stored");
    assert.ok(!JSON.stringify(res.body).includes(bearer), "nor sent in a body");
    assert.equal(bearerIn(res.setCookie), bearer, "the same identity, refreshed, never a new one");
  });

  test("concurrent first requests from several tabs start nothing payable between them", async () => {
    // Mocked concurrency: the requests interleave at every await, as they
    // would in one process; each still sees no identity.
    const replies = await Promise.all([send(DROPIN), send(DROPIN), send(HOSTED), send(DROPIN)]);
    for (const reply of replies) {
      assert.equal(reply.status, 428);
      assert.deepEqual(reply.body, { error: "identity_required" });
    }
    assert.equal(new Set(replies.map((r) => bearerIn(r.setCookie))).size, 4, "one identity per request");
    assert.equal(db.attempts.length, 0, "no attempt");
    assert.equal(sessionCalls.length, 0, "no Geidea session");
    assert.ok(!ops.includes("paymentSession.create"));
  });

  test("the tabs then ask under the one identity the browser kept: one attempt, one session, which the other tab resumes", async () => {
    const issued = await Promise.all([send(DROPIN), send(DROPIN)]);
    // The cookie jar keeps one value: whichever Set-Cookie landed last.
    const kept = cookieFor(bearerIn(issued[1].setCookie));
    state.createResult = liveSession;
    const both = await Promise.all([send(DROPIN, kept), send(DROPIN, kept)]);
    assert.equal(db.attempts.length, 1, "one attempt");
    assert.equal(sessionCalls.length, 1, "one Geidea session");
    const session = both.find((r) => r.status === 200);
    assert.ok(session, "one tab received the session");
    for (const reply of both) {
      assert.ok(
        reply.status === 200 || (reply.status === 409 && reply.body.error === "attempt_pending"),
        `the other tab is told to wait, never given another session: ${JSON.stringify(reply.body)}`
      );
    }
    const retry = await send(DROPIN, kept);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.sessionId, session.body.sessionId, "and then resumes the same one");
    assertNoSecondSession();
  });

  test("a reload while the first session request is still waiting on Geidea: the reloaded page waits, then resumes that session", async () => {
    const cookie = await identify();
    const seen: { reload?: Reply } = {};
    state.createResult = async (input) => {
      // The reloaded page asks while Geidea is still answering the first.
      seen.reload = await send(DROPIN, cookie);
      return liveSession(input);
    };
    const first = await send(DROPIN, cookie);
    state.createResult = liveSession;
    assert.ok(seen.reload);
    assert.equal(seen.reload.status, 409);
    assert.equal(seen.reload.body.error, "attempt_pending");
    assert.equal(first.status, 200);
    const retry = await send(DROPIN, cookie);
    assert.equal(retry.body.sessionId, first.body.sessionId);
    assertNoSecondSession();
  });

  test("a lost reply: asked again under the same identity, the session it carried is resumed", async () => {
    const { first, cookie } = await startedBrowser();
    // The first reply never reached the page; the buyer tries again.
    const again = await send(DROPIN, cookie);
    assert.equal(again.status, 200);
    assert.equal(again.body.sessionId, first.body.sessionId);
    assert.equal(again.body.successPath, first.body.successPath);
    assertNoSecondSession();
  });

  test("a malformed identity is no identity: a fresh one is issued, and nothing is looked up or started", async () => {
    for (const cookie of ["saiflow_checkout=forged-value", "saiflow_checkout=", "xsaiflow_checkout=" + "a".repeat(43)]) {
      ops.length = 0;
      const res = await send(DROPIN, cookie);
      assert.equal(res.status, 428, cookie);
      assert.ok(!ops.includes("paymentSession.findUnique"), cookie);
    }
    assert.equal(db.attempts.length, 0);
    assert.equal(sessionCalls.length, 0);
  });

  test("pre-launch and every gate still come first: no identity is issued, and a held one is not even read", async () => {
    state.preLaunch = true;
    const closed = await send(DROPIN);
    assert.equal(closed.status, 503);
    assert.equal(closed.setCookie, null);
    state.preLaunch = false;

    const cookie = cookieFor(randomBytes(32).toString("base64url"));
    db.product = product({ fileScanStatus: "UNSAFE" });
    ops.length = 0;
    for (const held of [undefined, cookie]) {
      const unsafe = await send(DROPIN, held);
      assert.equal(unsafe.status, 400);
      assert.equal(unsafe.setCookie, null);
    }
    assert.ok(!ops.includes("paymentSession.findUnique"));
    assert.equal(db.attempts.length, 0);
  });

  test("logs never carry the bearer or its hash", async () => {
    logs.length = 0;
    const { cookie } = await startedBrowser();
    await send(DROPIN, cookie);
    await send(HOSTED, cookie);
    const text = logs.join("\n");
    assert.ok(!text.includes(bearerOf(cookie)));
    assert.ok(!text.includes(sha256(bearerOf(cookie))));
    assert.ok(logs.some((l) => l.includes("identity_issued")), "the issue is logged, by event name only");
  });
});

/* ------------------------------------------------------------------ */
/* Reload, retry and repeated clicks                                   */
/* ------------------------------------------------------------------ */

describe("reload, retry and repeated clicks resume the same Geidea session", () => {
  test("a reload of the checkout page: the same session, the same status path, no new attempt, no Geidea call", async () => {
    const { first, cookie } = await startedBrowser();
    const callsBefore = sessionCalls.length;
    const again = await send(DROPIN, cookie);
    assert.equal(again.status, 200);
    assert.equal(again.body.sessionId, first.body.sessionId);
    assert.equal(again.body.successPath, first.body.successPath);
    assert.equal(again.body.expiresAt, first.body.expiresAt);
    assert.equal(again.body.scriptUrl, SCRIPT_URL);
    assert.equal(sessionCalls.length, callsBefore);
    assertNoSecondSession();
    assert.equal(bearerIn(again.setCookie), bearerOf(cookie), "the same bearer, refreshed");
  });

  test("try again after a cancel or a decline reported by Geidea: still the same session", async () => {
    const { first, cookie } = await startedBrowser();
    for (const status of ["CANCELLED", "FAILED"]) {
      db.attempts[0].status = status;
      db.attempts[0].failureReason = status === "FAILED" ? "declined" : "cancelled";
      const again = await send(DROPIN, cookie);
      assert.equal(again.status, 200, status);
      assert.equal(again.body.sessionId, first.body.sessionId, status);
    }
    assertNoSecondSession();
  });

  test("a hosted attempt resumes as the same hosted page", async () => {
    state.createResult = liveSession;
    const cookie = await identify(HOSTED);
    const first = await send(HOSTED, cookie);
    const again = await send(HOSTED, cookie);
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, first.body);
    assertNoSecondSession();
  });

  test("two clicks racing past the lookup: the database's unique key lets one in, and the other resumes it", async () => {
    const { first, cookie } = await startedBrowser();
    // The second request looked before the first had committed.
    findUniqueOverride = () => {
      findUniqueOverride = null;
      return null;
    };
    const again = await send(DROPIN, cookie);
    assert.ok(ops.includes("paymentSession.create:P2002"));
    assert.equal(again.status, 200);
    assert.equal(again.body.sessionId, first.body.sessionId);
    assertNoSecondSession();
  });

  test("a click while the first request is still creating the session: a short wait, never a second session", async () => {
    const bearer = randomBytes(32).toString("base64url");
    const row = seedAttempt(bearer, { status: "CREATED", providerSessionId: null, createdAt: new Date(Date.now() - 5000) });
    const res = await send(DROPIN, cookieFor(bearer));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "attempt_pending", statusPath: statusPathOf(row) });
    assert.equal(sessionCalls.length, 0);
    assert.equal(db.attempts.length, 1);
  });
});

describe("the hosted fallback never starts a second payable session", () => {
  test("asking for the hosted page while the embedded attempt can still be paid: its status page instead", async () => {
    const { first, cookie } = await startedBrowser();
    const fallback = await send(HOSTED, cookie);
    assert.equal(fallback.status, 409);
    assert.deepEqual(fallback.body, { error: "attempt_open", statusPath: first.body.successPath });
    assertNoSecondSession();
  });

  test("and an embedded request for a hosted attempt is answered the same way", async () => {
    state.createResult = liveSession;
    const cookie = await identify(HOSTED);
    await send(HOSTED, cookie);
    const res = await send(DROPIN, cookie);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "attempt_open");
    assertNoSecondSession();
  });

  test("an embedded payment completing after the fallback was asked for still settles the one attempt", async () => {
    const { first, cookie } = await startedBrowser();
    await send(HOSTED, cookie);
    // The delayed callback for the embedded payment arrives now.
    fulfil(db.attempts[0]);
    const after = await send(DROPIN, cookie);
    assert.equal(after.status, 409);
    assert.deepEqual(after.body, { error: "already_paid", statusPath: first.body.successPath });
    assertNoSecondSession();
  });
});

/* ------------------------------------------------------------------ */
/* B. No clock replaces a session that may have reached a browser      */
/* ------------------------------------------------------------------ */

describe("B. an attempt whose outcome is unknown stays blocked, on its status page, however long it waits", () => {
  test("31 minutes past Geidea's expiry, unpaid as far as SaiFlow knows: the status page, no new attempt, no Geidea call", async () => {
    const { first, cookie } = await startedBrowser();
    const row = db.attempts[0];
    row.expiresAt = new Date(Date.now() - 31 * MINUTE);
    writes.length = 0;
    for (const query of [DROPIN, HOSTED]) {
      const res = await send(query, cookie);
      assert.equal(res.status, 409, query);
      assert.deepEqual(res.body, { error: "attempt_open", statusPath: first.body.successPath });
    }
    assertNoSecondSession();
    assert.equal(row.currentAttemptKey, keyFor(bearerOf(cookie)), "still this browser's attempt");
    assert.deepEqual(writes, [], "nothing released, nothing written");
  });

  test("days later, in every state a callback can leave it in, still the status page", async () => {
    const { cookie } = await startedBrowser();
    const row = db.attempts[0];
    for (const status of ["SESSION_CREATED", "FAILED", "CANCELLED", "EXPIRED"]) {
      row.status = status;
      row.expiresAt = new Date(Date.now() - 6 * DAY);
      const res = await send(DROPIN, cookie);
      assert.equal(res.status, 409, status);
      assert.equal(res.body.error, "attempt_open", status);
    }
    assertNoSecondSession();
  });

  test("a payment that succeeded, whose callback arrives more than 30 minutes after expiry: never replaced while it waited, paid once it came", async () => {
    const { first, cookie } = await startedBrowser();
    const row = db.attempts[0];
    // The buyer paid just before Geidea's deadline. Callback delivery is late.
    row.expiresAt = new Date(Date.now() - 45 * MINUTE);
    const waiting = await send(DROPIN, cookie);
    assert.equal(waiting.status, 409);
    assert.deepEqual(waiting.body, { error: "attempt_open", statusPath: first.body.successPath });

    // The verified callback now claims the attempt and creates its Order.
    fulfil(row);
    for (const query of [DROPIN, HOSTED]) {
      const paid = await send(query, cookie);
      assert.equal(paid.status, 409, query);
      assert.deepEqual(paid.body, { error: "already_paid", statusPath: first.body.successPath });
    }
    assertNoSecondSession();
  });

  test("a paid attempt sends the buyer to its status page, however late, and never to a new payment", async () => {
    const { cookie } = await startedBrowser();
    fulfil(db.attempts[0]);
    db.attempts[0].expiresAt = new Date(Date.now() - 6 * DAY);
    for (const query of [DROPIN, HOSTED]) {
      const res = await send(query, cookie);
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "already_paid");
    }
    assertNoSecondSession();
  });

  test("PAID without its Order yet is still being fulfilled: the status page", async () => {
    const { cookie } = await startedBrowser();
    db.attempts[0].status = "PAID";
    const res = await send(DROPIN, cookie);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "attempt_open");
    assertNoSecondSession();
  });

  test("an InProgress callback leaves the attempt open, and it is resumed", async () => {
    const { first, cookie } = await startedBrowser();
    db.attempts[0].providerStatus = "InProgress";
    const res = await send(DROPIN, cookie);
    assert.equal(res.body.sessionId, first.body.sessionId);
    assertNoSecondSession();
  });

  test("a session Geidea never created stops being current at once, so the next try starts cleanly", async () => {
    const cookie = cookieFor(randomBytes(32).toString("base64url"));
    state.createError = new Error("upstream");
    const failed = await send(DROPIN, cookie);
    assert.equal(failed.status, 502);
    assert.equal(db.attempts[0].currentAttemptKey, null);
    assert.equal(db.attempts[0].failureReason, "session_create_failed");
    state.createError = null;
    state.createResult = liveSession;
    const next = await send(DROPIN, cookie);
    assert.equal(next.status, 200);
    assert.equal(db.attempts.length, 2);
  });

  test("an attempt whose session request stored no session id is replaced, and closed in the same statement", async () => {
    const bearer = randomBytes(32).toString("base64url");
    const old = seedUnstarted(bearer);
    state.createResult = liveSession;
    const res = await send(DROPIN, cookieFor(bearer));
    assert.equal(res.status, 200);
    assert.equal(db.attempts.length, 2);
    assert.equal(old.currentAttemptKey, null);
    assert.equal(old.status, "FAILED");
    assert.equal(old.failureReason, "superseded_before_session");
    const release = writes.find((w) => w.op === "paymentSession.updateMany" && w.where?.id === old.id);
    assert.ok(release);
    assert.deepEqual(release.where, { id: old.id, currentAttemptKey: keyFor(bearer), status: "CREATED", providerSessionId: null });
    assert.deepEqual(release.data, { currentAttemptKey: null, status: "FAILED", failureReason: "superseded_before_session" });
    assert.equal(db.attempts[1].currentAttemptKey, keyFor(bearer));
  });
});

/* ------------------------------------------------------------------ */
/* C. Fulfilment and replacement cannot both win                        */
/* ------------------------------------------------------------------ */

/*
 * MOCKED CONCURRENCY, NOT A DATABASE. The fake applies each statement whole,
 * and `beforeUpdate` lands another writer's commit immediately before an
 * UPDATE is evaluated, which is what Postgres does when an UPDATE waits on a
 * row another transaction is changing: it re-checks its WHERE clause against
 * the committed row. That Postgres behaviour is relied on here, not tested;
 * no real database runs in this suite.
 *
 * Only an attempt with no stored session id can reach the release, and no
 * browser can pay such an attempt, so a real callback cannot arrive for it.
 * These tests drive one in anyway, to show the release cannot win against
 * it even then.
 */
describe("C. a callback fulfilment and a replacement can never both win (mocked concurrency)", () => {
  test("before: the callback committed before checkout read the attempt: paid, nothing released, nothing started", async () => {
    const delivered = randomBytes(32).toString("base64url");
    fulfil(seedAttempt(delivered, { expiresAt: new Date(Date.now() - 45 * MINUTE) }));
    const unstarted = randomBytes(32).toString("base64url");
    fulfil(seedUnstarted(unstarted));
    for (const bearer of [delivered, unstarted]) {
      const res = await send(DROPIN, cookieFor(bearer));
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "already_paid");
    }
    assert.ok(!ops.includes("paymentSession.updateMany"), "nothing released");
    assert.equal(sessionCalls.length, 0);
    assert.equal(db.attempts.length, 2);
  });

  test("during: the callback commits between checkout's read and its release: the release matches nothing, and the buyer is sent to the paid attempt", async () => {
    const bearer = randomBytes(32).toString("base64url");
    const row = seedUnstarted(bearer);
    beforeUpdate = (where) => {
      if (where.id === row.id && "currentAttemptKey" in where) {
        beforeUpdate = null;
        fulfil(row);
      }
    };
    const res = await send(DROPIN, cookieFor(bearer));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "already_paid", statusPath: statusPathOf(row) });
    assert.equal(row.status, "PAID", "the callback's claim stands");
    assert.equal(row.currentAttemptKey, keyFor(bearer), "never released");
    assert.ok(!ops.includes("paymentSession.create"), "no replacement attempt");
    assert.equal(sessionCalls.length, 0, "no Geidea session");
    assert.ok(logs.some((l) => l.includes("attempt_release_refused")));
  });

  test("during: another request of the same browser released it first: nothing more is started here", async () => {
    const bearer = randomBytes(32).toString("base64url");
    const row = seedUnstarted(bearer);
    beforeUpdate = (where) => {
      if (where.id === row.id && "currentAttemptKey" in where) {
        beforeUpdate = null;
        // The other request's release and its new attempt, committed first.
        Object.assign(row, { currentAttemptKey: null, status: "FAILED", failureReason: "superseded_before_session" });
        seedAttempt(bearer, {
          id: "ps_other",
          merchantReferenceId: "0b8f3c52-51c1-4a0e-9d7e-3f2a1b6c9d10",
          status: "CREATED",
          providerSessionId: null,
          createdAt: new Date(),
        });
      }
    };
    const res = await send(DROPIN, cookieFor(bearer));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "attempt_pending", statusPath: "/success?ref=0b8f3c52-51c1-4a0e-9d7e-3f2a1b6c9d10" });
    assert.ok(!ops.includes("paymentSession.create"));
    assert.equal(sessionCalls.length, 0);
    assert.equal(db.attempts.length, 2, "the seeded attempt and the other request's, nothing from this one");
  });

  test("after: the release committed while the old request was still asking Geidea; that request's session id reaches no browser", async () => {
    const cookie = await identify();
    const seen: { second?: Reply } = {};
    let calls = 0;
    state.createResult = async (input) => {
      calls++;
      if (calls === 1) {
        // Request 1 is still waiting on Geidea past the pending window when
        // request 2 arrives: request 2 releases attempt 1, closing it, and
        // starts attempt 2.
        db.attempts[0].createdAt = new Date(Date.now() - 3 * MINUTE);
        seen.second = await send(DROPIN, cookie);
        return liveSessionWithId(SESSION_A)(input);
      }
      return liveSessionWithId(SESSION_B)(input);
    };
    const first = await send(DROPIN, cookie);
    assert.ok(seen.second);
    assert.equal(seen.second.status, 200);
    assert.equal(seen.second.body.sessionId, SESSION_B);
    // Request 1's store is refused, and it answers from the current attempt.
    assert.equal(first.status, 200);
    assert.equal(first.body.sessionId, SESSION_B);
    assert.ok(!JSON.stringify([first.body, seen.second.body]).includes(SESSION_A), "session A was given to no one");

    const [one, two] = db.attempts;
    assert.equal(one.status, "FAILED");
    assert.equal(one.failureReason, "superseded_before_session");
    assert.equal(one.currentAttemptKey, null);
    assert.equal(one.providerSessionId ?? null, null, "session A was never stored");
    assert.equal(two.status, "SESSION_CREATED");
    assert.equal(two.providerSessionId, SESSION_B);
    assert.equal(two.currentAttemptKey, keyFor(bearerOf(cookie)));
    assert.equal(sessionCalls.length, 2, "Geidea created two sessions; one of them can be paid");
    assert.ok(logs.some((l) => l.includes("session_withheld")));
  });

  test("after: a session that did reach a browser is never released, so its late callback has nothing to race (see B)", async () => {
    const { first, cookie } = await startedBrowser();
    db.attempts[0].expiresAt = new Date(Date.now() - 45 * MINUTE);
    await send(DROPIN, cookie);
    fulfil(db.attempts[0]);
    const res = await send(DROPIN, cookie);
    assert.deepEqual(res.body, { error: "already_paid", statusPath: first.body.successPath });
    assert.ok(!writes.some((w) => "currentAttemptKey" in (w.where ?? {})), "no release was ever attempted");
    assertNoSecondSession();
  });
});

/* ------------------------------------------------------------------ */
/* Trusted values                                                      */
/* ------------------------------------------------------------------ */

describe("a resume trusts the attempt's row and the product's row, never the browser", () => {
  test("the bearer must be the one the attempt was made for: another browser starts its own attempt", async () => {
    const { first } = await startedBrowser();
    const stranger = await send(DROPIN, cookieFor(randomBytes(32).toString("base64url")));
    assert.equal(stranger.status, 200);
    assert.notEqual(stranger.body.successPath, first.body.successPath);
    assert.equal(db.attempts.length, 2);
  });

  test("one bearer, another product: a separate attempt, never the first product's session", async () => {
    const { cookie } = await startedBrowser();
    db.product = product({ id: "prod_2", slug: "other" });
    const res = await send(DROPIN, cookie, { productId: "prod_2", buyerEmail: "buyer@example.com" });
    assert.equal(res.status, 200);
    assert.equal(db.attempts.length, 2);
    assert.equal(db.attempts[1].productId, "prod_2");
  });

  test("a price changed since the attempt began: not resumed at the old price, and not replaced", async () => {
    const { first, cookie } = await startedBrowser();
    db.product = product({ price: new FakeDecimal("59") });
    const res = await send(DROPIN, cookie);
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: "attempt_open", statusPath: first.body.successPath });
    assertNoSecondSession();
  });

  test("an attempt made for another environment is not resumed", async () => {
    const { cookie } = await startedBrowser();
    db.attempts[0].environment = "PRODUCTION";
    const res = await send(DROPIN, cookie);
    assert.equal(res.status, 409);
    assertNoSecondSession();
  });

  test("a corrected receipt address follows the same attempt, and changes nothing else", async () => {
    const { first, cookie } = await startedBrowser();
    writes.length = 0;
    const res = await send(DROPIN, cookie, { productId: "prod_1", buyerEmail: " New.Address@Example.com " });
    assert.equal(res.status, 200);
    assert.equal(res.body.sessionId, first.body.sessionId, "the same Geidea session");
    assertNoSecondSession();
    assert.equal(db.attempts[0].buyerEmail, "new.address@example.com");
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].data, { buyerEmail: "new.address@example.com" }, "only the address");
    assert.deepEqual(writes[0].where, { id: db.attempts[0].id, currentAttemptKey: db.attempts[0].currentAttemptKey, status: { not: "PAID" } });
  });

  test("the same receipt address again writes nothing", async () => {
    const { cookie } = await startedBrowser();
    writes.length = 0;
    const res = await send(DROPIN, cookie);
    assert.equal(res.status, 200);
    assert.equal(writes.length, 0);
  });

  test("money, provider, environment and references in the body change nothing about a resume", async () => {
    const { first, cookie } = await startedBrowser();
    const res = await send(DROPIN, cookie, {
      productId: "prod_1",
      buyerEmail: "buyer@example.com",
      amount: "1.00",
      price: 1,
      currency: "USD",
      environment: "PRODUCTION",
      merchantReferenceId: "0b8f3c52-51c1-4a0e-9d7e-3f2a1b6c9d10",
      sessionId: "11111111-2222-4333-8444-555555555555",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.sessionId, first.body.sessionId);
    assert.equal(res.body.successPath, first.body.successPath);
    assertNoSecondSession();
    assert.equal(db.attempts[0].amount, db.product!.price);
  });

  test("a product deleted between its read and the attempt's insert: refused by the database, no session", async () => {
    createError = Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" });
    const res = await send(DROPIN, cookieFor(randomBytes(32).toString("base64url")));
    assert.equal(res.status, 404);
    assert.equal(sessionCalls.length, 0);
    assert.equal(db.attempts.length, 0);
  });
});
