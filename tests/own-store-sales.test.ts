/**
 * Own-store sales (LIVE_PAYMENTS_MODE=own_store, lib/payments/live-mode).
 *
 * What must hold:
 * - While PRE_LAUNCH_MODE is on, anyone may buy a product whose store slug,
 *   read from the database row, is on LIVE_STORE_SLUGS, on the production
 *   Geidea account, at the product's own price, as a real sale (not a
 *   founder test).
 * - Every other store gets the same 503 pre_launch as before, with nothing
 *   started, so SaiFlow never takes money for another seller.
 * - Nothing in the request body can choose the store.
 * - An empty or missing list opens nothing; other modes ignore the list.
 */
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { accountAllowed, checkoutAccess, parseLivePaymentsMode, parseLiveStoreSlugs } from "../lib/payments/live-mode.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const FOUNDER = "founder@saiflow.test";

describe("the rules", () => {
  test("own_store is a recognised mode", () => {
    assert.equal(parseLivePaymentsMode("own_store"), "own_store");
    assert.equal(parseLivePaymentsMode(" own_store "), "own_store");
    assert.equal(parseLivePaymentsMode("OWN_STORE"), "off");
  });

  test("store slugs parse leniently and drop anything that is not a slug", () => {
    assert.deepEqual([...parseLiveStoreSlugs(" Daads-Store, other-shop  bad_slug x--y ")], ["daads-store", "other-shop"]);
    assert.equal(parseLiveStoreSlugs(undefined).size, 0);
    assert.equal(parseLiveStoreSlugs("").size, 0);
  });

  test("only a listed store opens, only in own_store mode, only while pre-launch is on", () => {
    const stores = new Set(["daads-store"]);
    const base = { founderEmails: new Set<string>(), sessionEmail: null, liveStoreSlugs: stores };
    assert.deepEqual(checkoutAccess({ ...base, preLaunch: true, mode: "own_store", shopSlug: "daads-store" }), { kind: "own_store" });
    assert.deepEqual(checkoutAccess({ ...base, preLaunch: true, mode: "own_store", shopSlug: " DAADS-STORE " }), { kind: "own_store" });
    for (const shopSlug of ["other-shop", "", null, undefined]) {
      assert.deepEqual(checkoutAccess({ ...base, preLaunch: true, mode: "own_store", shopSlug }), { kind: "closed" }, String(shopSlug));
    }
    assert.deepEqual(checkoutAccess({ ...base, preLaunch: true, mode: "own_store", liveStoreSlugs: new Set(), shopSlug: "daads-store" }), { kind: "closed" });
    for (const mode of ["off", "founder_only", "public"] as const) {
      assert.deepEqual(checkoutAccess({ ...base, preLaunch: true, mode, shopSlug: "daads-store" }), { kind: "closed" }, mode);
    }
    assert.deepEqual(checkoutAccess({ ...base, preLaunch: false, mode: "own_store", shopSlug: "other-shop" }), { kind: "public" });
  });

  test("an own-store sale may use the production account; the public still may not", () => {
    assert.equal(accountAllowed({ kind: "own_store" }, "own_store", "production"), true);
    assert.equal(accountAllowed({ kind: "own_store" }, "off", "production"), false);
    assert.equal(accountAllowed({ kind: "public" }, "own_store", "production"), false);
  });
});

const KEY = "abc123XY_key-one";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";

const state = {
  preLaunch: true,
  livePaymentsMode: undefined as string | undefined,
  founderEmails: FOUNDER as string | undefined,
  liveStores: "daads-store" as string | undefined,
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
    shop: { isActive: true, slug: "my-shop" },
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
        get LIVE_STORE_SLUGS() {
          return state.liveStores;
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
  state.liveStores = "daads-store";
  state.account = "production";
  state.session = null;
  state.sessionReads = 0;
  state.price = "45.00";
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


function assertNothingStarted() {
  assert.equal(attempts.length, 0, "no attempt recorded");
  assert.equal(sessionCalls.length, 0, "Geidea not asked");
}

describe("the checkout route in own_store mode", () => {
  test("a listed store sells to anyone, signed out, on the live account, as a real sale", async () => {
    state.livePaymentsMode = "own_store";
    state.product = product({ shop: { isActive: true, slug: "daads-store" } });
    const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].founderTest, false);
    assert.equal(attempts[0].environment, "PRODUCTION");
    assert.equal(sessionCalls.length, 1);
    assert.equal(String(sessionCalls[0].amount), "45.00");
    assert.equal(state.sessionReads, 0, "no session needed");
  });

  test("any other store gets the pre-launch notice and nothing starts, whatever the body says", async () => {
    state.livePaymentsMode = "own_store";
    state.product = product({ shop: { isActive: true, slug: "other-shop" } });
    const res = await checkout({ productId: "prod_1", buyerEmail: "buyer@example.com", shopSlug: "daads-store", slug: "daads-store" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "pre_launch");
    assertNothingStarted();
  });

  test("an empty store list opens nothing", async () => {
    state.livePaymentsMode = "own_store";
    state.liveStores = undefined;
    state.product = product({ shop: { isActive: true, slug: "daads-store" } });
    const res = await checkout();
    assert.equal(res.status, 503);
    assertNothingStarted();
  });

  test("the list means nothing outside own_store mode", async () => {
    state.product = product({ shop: { isActive: true, slug: "daads-store" } });
    for (const mode of [undefined, "off", "public"]) {
      state.livePaymentsMode = mode;
      const res = await checkout();
      assert.equal(res.status, 503, String(mode));
    }
    assertNothingStarted();
  });

  test("every other gate still runs: an unapproved product of a listed store is refused", async () => {
    state.livePaymentsMode = "own_store";
    state.product = product({ shop: { isActive: true, slug: "daads-store" }, moderationStatus: "PENDING" });
    const res = await checkout();
    assert.equal(res.status, 400);
    assertNothingStarted();
  });
});

describe("the pages mirror the route", () => {
  test("the checkout page and the product page ask with the product's store", () => {
    assert.match(read("app/checkout/[slug]/[productSlug]/page.tsx"), /currentCheckoutAccess\(product\.shop\.slug\)/);
    const productPage = read("app/shop/[slug]/product/[productSlug]/page.tsx");
    assert.match(productPage, /env\.PRE_LAUNCH_MODE && \(await currentCheckoutAccess\(product\.shop\.slug\)\)\.access\.kind !== "own_store"/);
  });
});
