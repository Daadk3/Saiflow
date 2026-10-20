/**
 * The founder-only live-payment switch (lib/payments/live-mode,
 * lib/payments/request-access, app/api/checkout).
 *
 * What must hold:
 * - LIVE_PAYMENTS_MODE missing, empty or unrecognised means "off": checkout
 *   behaves exactly as before, and no session is even read.
 * - founder_only: while PRE_LAUNCH_MODE is on, only a signed-in session whose
 *   email is on FOUNDER_TEST_EMAILS gets past the pre-launch gate, decided on
 *   the server from the session (never from the request body). Everyone
 *   else, signed in or not, gets the same 503 pre_launch as before.
 * - A founder test may use the production Geidea account, only for a price
 *   of at most 20 SAR, and its attempt is marked founderTest. Every other gate
 *   still runs (product, moderation, file safety).
 * - Public stays locked: with PRE_LAUNCH_MODE off, a production account is
 *   refused whatever LIVE_PAYMENTS_MODE says, and a test account works for
 *   everyone as before, unmarked.
 * - The mark follows the money: the callback copies it onto the Order, and
 *   payouts, seller totals and revenue leave founder tests out.
 *
 * Behavioural for the rules and the route (fake database, fake Geidea, fake
 * session); structural (reads the source) for the callback, payouts and page.
 */
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  FOUNDER_TEST_MAX_SAR,
  LIVE_PUBLIC_ALLOWED,
  accountAllowed,
  productionAccountHere,
  checkoutAccess,
  parseFounderEmails,
  parseLivePaymentsMode,
  withinFounderCap,
} from "../lib/payments/live-mode.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const FOUNDER = "founder@saiflow.test";

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

describe("the rules", () => {
  test("a missing, empty or unrecognised mode is off", () => {
    for (const raw of [undefined, null, "", "  ", "on", "true", "FOUNDER_ONLY", "founder-only", "Public", 1, {}]) {
      assert.equal(parseLivePaymentsMode(raw), "off", String(raw));
    }
    assert.equal(parseLivePaymentsMode("founder_only"), "founder_only");
    assert.equal(parseLivePaymentsMode(" founder_only "), "founder_only");
    assert.equal(parseLivePaymentsMode("public"), "public");
  });

  test("the founder list is addresses only, lower-cased", () => {
    assert.deepEqual([...parseFounderEmails(" Founder@SaiFlow.test, second@x.io  third@y.co ,,")].sort(), [
      "founder@saiflow.test",
      "second@x.io",
      "third@y.co",
    ]);
    for (const raw of [undefined, "", "not-an-email", "@x.io", "a@b", "*@x.io", "*", "a;b@x.io", "fоunder@saiflow.test"]) {
      assert.equal(parseFounderEmails(raw).size, 0, String(raw));
    }
    assert.deepEqual([...parseFounderEmails("a@x.io\nb@y.io")], ["a@x.io", "b@y.io"], "newlines separate too");
  });

  test("who may check out", () => {
    const founders = parseFounderEmails(FOUNDER);
    const closed = { kind: "closed" };
    assert.deepEqual(checkoutAccess({ preLaunch: false, mode: "off", founderEmails: founders, sessionEmail: null }), { kind: "public" });
    assert.deepEqual(checkoutAccess({ preLaunch: true, mode: "off", founderEmails: founders, sessionEmail: FOUNDER }), closed);
    assert.deepEqual(checkoutAccess({ preLaunch: true, mode: "public", founderEmails: founders, sessionEmail: FOUNDER }), closed);
    assert.deepEqual(checkoutAccess({ preLaunch: true, mode: "founder_only", founderEmails: founders, sessionEmail: null }), closed);
    assert.deepEqual(checkoutAccess({ preLaunch: true, mode: "founder_only", founderEmails: founders, sessionEmail: "other@x.io" }), closed);
    assert.deepEqual(checkoutAccess({ preLaunch: true, mode: "founder_only", founderEmails: new Set(), sessionEmail: FOUNDER }), closed);
    assert.deepEqual(
      checkoutAccess({ preLaunch: true, mode: "founder_only", founderEmails: founders, sessionEmail: " FOUNDER@saiflow.test " }),
      { kind: "founder_test" }
    );
  });

  test("which account: test always; production only for a founder test while the public release is locked", () => {
    assert.equal(LIVE_PUBLIC_ALLOWED, false);
    for (const mode of ["off", "founder_only", "public"] as const) {
      assert.equal(accountAllowed({ kind: "public" }, mode, "test"), true);
      assert.equal(accountAllowed({ kind: "public" }, mode, "production"), false, `public, ${mode}`);
      assert.equal(accountAllowed({ kind: "founder_test" }, mode, "production"), true);
    }
  });

  test("a production account is used only by the production deployment", () => {
    assert.equal(productionAccountHere("production"), true);
    for (const env of [undefined, "", "preview", "development", "Production"]) assert.equal(productionAccountHere(env), false, String(env));
  });

  test("the founder test cap is 20 SAR (Geidea's minimum for a real test is 10 SAR)", () => {
    assert.equal(FOUNDER_TEST_MAX_SAR, 20);
    for (const ok of ["0.01", "1.00", "10.00", "19.99", "20.00"]) assert.equal(withinFounderCap(ok), true, ok);
    for (const no of ["20.01", "25.00", "49.00", "0.00", "", "abc", "-1.00"]) assert.equal(withinFounderCap(no), false, no);
  });
});

/* ------------------------------------------------------------------ */
/* The route                                                           */
/* ------------------------------------------------------------------ */

const KEY = "abc123XY_key-one";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";

const state = {
  preLaunch: true,
  livePaymentsMode: undefined as string | undefined,
  founderEmails: FOUNDER as string | undefined,
  account: "production" as "test" | "production",
  session: null as null | { user: { email: string } },
  sessionError: null as Error | null,
  sessionReads: 0,
  price: "1.00",
  product: {} as Record<string, unknown>,
};
const attempts: Record<string, unknown>[] = [];
const sessionCalls: Record<string, unknown>[] = [];

class FakeDecimal {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

function product(over: Record<string, unknown> = {}) {
  return {
    id: "prod_1",
    name: "Test product",
    price: new FakeDecimal(state.price),
    currency: "SAR",
    slug: "test-product",
    isActive: true,
    moderationStatus: "APPROVED",
    fileUrl: "https://app.ufs.sh/f/abc123XY_key-one",
    fileKey: KEY,
    fileScanStatus: "SAFE",
    fileScanKey: KEY,
    // The founder's own test shop: she is its member, as on Production.
    shop: { isActive: true, slug: "my-shop", email: null, shopUsers: [{ user: { email: FOUNDER } }] },
    ...over,
  };
}

let POST: (req: Request) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          findUnique: async () => state.product,
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
        },
        paymentSession: {
          findUnique: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            attempts.push(data);
            return { id: `ps_${attempts.length}` };
          },
          updateMany: async () => ({ count: 1 }),
        },
      },
    },
  });
  mock.module("@/lib/env", {
    namedExports: {
      env: {
        get PRE_LAUNCH_MODE() {
          return state.preLaunch;
        },
        get LIVE_PAYMENTS_MODE() {
          return state.livePaymentsMode;
        },
        get FOUNDER_TEST_EMAILS() {
          return state.founderEmails;
        },
        NEXTAUTH_URL: "https://www.saiflow.test",
      },
    },
  });
  mock.module("next-auth", {
    namedExports: {
      getServerSession: async () => {
        state.sessionReads++;
        if (state.sessionError) throw state.sessionError;
        return state.session;
      },
    },
  });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/payments/geidea/client", {
    namedExports: {
      isGeideaConfigured: () => true,
      geideaMode: () => state.account,
      checkoutScriptUrl: () => "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js",
      checkoutRedirectUrl: (id: string) => `https://www.ksamerchant.geidea.test/hpp/checkout/?${id}`,
      findOrdersByReference: async () => {
        throw new Error("no lookup expected");
      },
      createSession: async (input: Record<string, unknown>) => {
        sessionCalls.push(input);
        return {
          session: {
            sessionId: SESSION_ID,
            amount: Number(input.amount),
            currency: "SAR",
            status: "Initiated",
            expiryDate: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            merchantReferenceId: input.merchantReferenceId,
          },
          redirectUrl: `https://www.ksamerchant.geidea.test/hpp/checkout/?${SESSION_ID}`,
        };
      },
    },
  });
  for (const level of ["log", "info", "warn", "error"] as const) console[level] = () => {};
  POST = (await import("../app/api/checkout/route.ts")).POST as typeof POST;
});

beforeEach(() => {
  // The production deployment, unless a test says otherwise.
  process.env.VERCEL_ENV = "production";
  state.sessionError = null;
  state.preLaunch = true;
  state.livePaymentsMode = undefined;
  state.founderEmails = FOUNDER;
  state.account = "production";
  state.session = null;
  state.sessionReads = 0;
  state.price = "1.00";
  state.product = product();
  attempts.length = 0;
  sessionCalls.length = 0;
});

let ip = 0;
async function checkout(body: Record<string, unknown> = { productId: "prod_1", buyerEmail: FOUNDER }) {
  ip++;
  const res = await POST(
    new Request("https://www.saiflow.test/api/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `10.77.${(ip >> 8) & 255}.${ip & 255}`,
        cookie: `saiflow_checkout=${randomBytes(32).toString("base64url")}`,
      },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const asFounder = () => {
  state.livePaymentsMode = "founder_only";
  state.session = { user: { email: FOUNDER } };
};

function assertNothingStarted() {
  assert.equal(attempts.length, 0, "no attempt recorded");
  assert.equal(sessionCalls.length, 0, "Geidea not asked");
}

describe("the checkout route", () => {
  test("missing flag means off: even the founder, signed in, gets the pre-launch notice, and no session is read", async () => {
    state.session = { user: { email: FOUNDER } };
    for (const mode of [undefined, "", "yes", "FOUNDER_ONLY"]) {
      state.livePaymentsMode = mode;
      const res = await checkout();
      assert.equal(res.status, 503, String(mode));
      assert.equal(res.body.error, "pre_launch");
    }
    assert.equal(state.sessionReads, 0);
    assertNothingStarted();
  });

  test("founder_only: anyone else is blocked, signed in or not, whatever the body says", async () => {
    state.livePaymentsMode = "founder_only";
    for (const session of [null, { user: { email: "buyer@example.com" } }, { user: { email: "" } }]) {
      state.session = session;
      const res = await checkout({ productId: "prod_1", buyerEmail: FOUNDER, founder: true, email: FOUNDER });
      assert.equal(res.status, 503);
      assert.equal(res.body.error, "pre_launch");
    }
    state.founderEmails = undefined;
    state.session = { user: { email: FOUNDER } };
    assert.equal((await checkout()).status, 503, "an empty founder list allows nobody");
    assertNothingStarted();
  });

  test("founder_only: the founder gets a real session on the production account, marked as a founder test", async () => {
    asFounder();
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.url, "string");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].environment, "PRODUCTION");
    assert.equal(attempts[0].founderTest, true);
    assert.equal(sessionCalls.length, 1);
    assert.equal(sessionCalls[0].amount, "1.00");
    // A production account's callback comes to this deployment, not the test relay.
    assert.equal(sessionCalls[0].callbackUrl, "https://www.saiflow.test/api/webhooks/geidea");
  });

  test("a production account off the production deployment is refused, even for the founder", async () => {
    asFounder();
    for (const where of [undefined, "preview", "development"]) {
      if (where === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = where;
      const res = await checkout();
      assert.equal(res.status, 503, String(where));
      assert.equal(res.body.error, "pre_launch");
    }
    assertNothingStarted();
    // A test account there is fine: it charges nothing.
    process.env.VERCEL_ENV = "preview";
    state.account = "test";
    const res = await checkout();
    assert.equal(res.status, 200);
    assert.equal(attempts[0].environment, "TEST");
    assert.equal(attempts[0].founderTest, true);
  });

  test("a session that cannot be read is nobody: the pre-launch notice, not an error page", async () => {
    asFounder();
    state.sessionError = new Error("jwt broken");
    const res = await checkout();
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assertNothingStarted();
  });

  test("the amount cap: up to 20 SAR is allowed, anything above is refused before anything starts", async () => {
    asFounder();
    for (const price of ["10.00", "20.00"]) {
      state.price = price;
      state.product = product();
      assert.equal((await checkout()).status, 200, price);
    }
    for (const price of ["20.01", "25.00", "49.00"]) {
      attempts.length = 0;
      sessionCalls.length = 0;
      state.price = price;
      state.product = product();
      const res = await checkout();
      assert.equal(res.status, 400, price);
      assert.equal(res.body.error, "founder_test_amount");
      assertNothingStarted();
    }
  });

  test("the founder may buy from her own shop (the own-shop rule protects payouts, which a founder test never has)", async () => {
    asFounder();
    const res = await checkout({ productId: "prod_1", buyerEmail: FOUNDER });
    assert.equal(res.status, 200);
    assert.equal(attempts[0].founderTest, true);
  });

  test("anyone else buying from their own shop is still refused, test account or not", async () => {
    state.preLaunch = false;
    state.account = "test";
    state.product = product({ shop: { isActive: true, slug: "my-shop", email: null, shopUsers: [{ user: { email: "seller@example.com" } }] } });
    const res = await checkout({ productId: "prod_1", buyerEmail: "seller@example.com" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "not_available", "the generic answer: team membership is never revealed");
    assertNothingStarted();
  });

  test("a founder test still passes every other gate", async () => {
    asFounder();
    for (const over of [
      { moderationStatus: "PENDING" },
      { isActive: false },
      { shop: { isActive: false, slug: "my-shop", email: null, shopUsers: [{ user: { email: FOUNDER } }] } },
      { fileScanStatus: "PENDING_SCAN" },
      { fileScanKey: "other-key" },
    ]) {
      state.product = product(over);
      const res = await checkout();
      assert.equal(res.status, 400, JSON.stringify(over));
    }
    assertNothingStarted();
  });

  test("public is still locked: with pre-launch off, a production account is refused whatever the mode", async () => {
    state.preLaunch = false;
    state.account = "production";
    for (const mode of [undefined, "founder_only", "public"]) {
      state.livePaymentsMode = mode;
      state.session = { user: { email: FOUNDER } };
      // An ordinary buyer, so only the account rule is being tested.
      const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" });
      assert.equal(res.status, 503, String(mode));
      assert.equal(res.body.error, "pre_launch");
    }
    assertNothingStarted();
  });

  test("public with a test account is exactly as before on a Preview: open to everyone, never marked", async () => {
    process.env.VERCEL_ENV = "preview";
    state.preLaunch = false;
    state.account = "test";
    state.livePaymentsMode = "public";
    const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" });
    assert.equal(res.status, 200);
    assert.equal(attempts[0].environment, "TEST");
    assert.equal(attempts[0].founderTest, false);
    assert.equal(state.sessionReads, 0, "no session is read for the public");
  });

  test("the live site never runs on a test account: a test card must not buy real files there", async () => {
    state.preLaunch = false;
    state.account = "test";
    for (const mode of [undefined, "public"]) {
      state.livePaymentsMode = mode;
      const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" });
      assert.equal(res.status, 503, String(mode));
    }
    asFounder();
    state.preLaunch = true;
    assert.equal((await checkout()).status, 503, "not even for a founder test");
    assertNothingStarted();
  });

  test("a product id must be plain text", async () => {
    asFounder();
    const res = await checkout({ productId: { not: "x" }, buyerEmail: FOUNDER });
    assert.equal(res.status, 400);
    assertNothingStarted();
  });

  test("public mode with pre-launch on is still the pre-launch notice", async () => {
    state.livePaymentsMode = "public";
    state.session = { user: { email: FOUNDER } };
    assert.equal((await checkout()).status, 503);
    assertNothingStarted();
  });
});

/* ------------------------------------------------------------------ */
/* The mark follows the money                                          */
/* ------------------------------------------------------------------ */

describe("founder tests are never revenue and never paid out", () => {
  test("the callback copies the mark onto the Order", () => {
    const webhook = strip(read("app/api/webhooks/geidea/route.ts"));
    assert.match(webhook, /const SESSION_SELECT = \{[\s\S]*?founderTest: true,[\s\S]*?\} as const;/);
    assert.match(webhook, /tx\.order\.create\(\{\s*data: \{[\s\S]*?founderTest: session\.founderTest,[\s\S]*?\}/);
  });

  test("the sale emails call a founder test a test", () => {
    const webhook = strip(read("app/api/webhooks/geidea/route.ts"));
    assert.match(webhook, /notifySaleFulfilled\(\{[\s\S]*?environment: mode,\s*founderTest: session\.founderTest,\s*\}\)/);
    const notify = strip(read("lib/notify.ts"));
    assert.match(notify, /const test = isTest\(input\.environment\) \|\| input\.founderTest === true;/);
  });

  test("payouts, seller totals and revenue leave them out", () => {
    const payouts = strip(read("lib/payouts.ts"));
    // UNPAID_ORDERS_WHERE, which every payable and unpaid query builds on.
    assert.match(payouts, /export const UNPAID_ORDERS_WHERE = \{[^}]*founderTest: false,/);
    assert.match(payouts, /return \{ product: \{ shopId \}, \.\.\.UNPAID_ORDERS_WHERE \};/);
    assert.match(payouts, /return \{ \.\.\.unpaidOrdersWhere\(shopId\), createdAt: \{ lte: clearingCutoff\(now\) \} \};/);
    const orders = strip(read("app/api/orders/route.ts"));
    assert.match(orders, /order\.paymentEnvironment === "PRODUCTION" && !order\.founderTest/);
    const stats = strip(read("lib/admin-stats.ts"));
    assert.match(stats, /by: \["paymentEnvironment"\],\s*where: \{ founderTest: false \}/);
  });

  test("the database stores the mark, defaulting to an ordinary payment", () => {
    const schema = read("prisma/schema.prisma");
    assert.equal((schema.match(/founderTest\s+Boolean\s+@default\(false\)/g) ?? []).length, 2);
    const sql = read("prisma/migrations/20261018120000_founder_test_payments/migration.sql").replace(/--[^\n]*/g, "");
    assert.match(sql, /ALTER TABLE "PaymentSession" ADD COLUMN IF NOT EXISTS "founderTest" BOOLEAN NOT NULL DEFAULT false;/);
    assert.match(sql, /ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "founderTest" BOOLEAN NOT NULL DEFAULT false;/);
    assert.ok(!/UPDATE|DELETE|DROP/i.test(sql));
  });
});

describe("the checkout page mirrors the route", () => {
  const page = strip(read("app/checkout/[slug]/[productSlug]/page.tsx"));

  test("it asks the same decision, and says a founder test is real money", () => {
    assert.match(page, /const \{ access \} = await currentCheckoutAccess\(\);/);
    assert.match(page, /const founderTest = access\.kind === "founder_test";/);
    assert.match(page, /\{founderTest && \([\s\S]*?founderTestBodyLive[\s\S]*?founderTestBodyTest/);
    const en = JSON.parse(read("messages/en.json")).checkout;
    const ar = JSON.parse(read("messages/ar.json")).checkout;
    assert.match(en.founderTestBodyLive, /REAL payment/);
    assert.match(en.founderTestBodyLive, /\{max\}/);
    assert.match(ar.founderTestBodyLive, /حقيقية/);
    for (const key of ["founderTestTitle", "founderTestBodyTest", "founderTestAmountTitle", "founderTestAmountBody"]) {
      assert.ok(en[key] && ar[key], key);
    }
  });
});
