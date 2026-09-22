/**
 * Download delivery after a confirmed Geidea payment.
 *
 * The real GET handler runs against real Requests. Prisma is a double whose
 * `order.findUnique` honours the `where` it is given, whose `product` rows
 * carry the scan columns the safety gate reads, and whose `paymentSession`
 * accessor THROWS: the route must never read an attempt, and if it did, every
 * test here would turn into a 500. Storage signing and the rate limiter are
 * doubles too; global fetch throws. Nothing leaves the process.
 *
 * The rule under test: a request with `?ref=` is authorised only by an Order
 * whose merchantReferenceId is that reference, whose provider is GEIDEA, and
 * whose productId is the product in the path. The existing Stripe channels
 * are exercised too, to prove the three channels never bleed into each other.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KEY_A = "abc123XY_key-one";
const KEY_B = "zzz999QQ_key-two";
const REF_A = "5fde430a-4ed5-4876-9929-11871c32ff8b";
const REF_B = "0f0e0d0c-0b0a-4908-8706-050403020100";
const REF_STRIPEISH = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const UNKNOWN_REF = "3c0e2b5a-9d4f-4c1b-8e2a-6f7b8c9d0e1f";
const SIGNED_URL = "https://signed.example.test/object?sig=SECRET";

interface OrderRow {
  id: string;
  productId: string;
  paymentProvider: string;
  merchantReferenceId: string | null;
  stripeSessionId: string | null;
}
interface ProductRow {
  id: string;
  name: string;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
}

const db: { orders: OrderRow[]; products: Map<string, ProductRow> } = { orders: [], products: new Map() };
const lookups: Record<string, unknown>[] = [];
const signCalls: { key: string }[] = [];
const logs: string[] = [];
const hits = new Map<string, number>();

const fakePrisma = {
  order: {
    findUnique: async ({ where, select }: { where: Record<string, string>; select: Record<string, boolean> }) => {
      lookups.push(where);
      let row: OrderRow | undefined;
      if ("merchantReferenceId" in where) row = db.orders.find((o) => o.merchantReferenceId === where.merchantReferenceId);
      else if ("stripeSessionId" in where) row = db.orders.find((o) => o.stripeSessionId === where.stripeSessionId);
      else if ("id" in where) row = db.orders.find((o) => o.id === where.id);
      if (!row) return null;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(select)) out[key] = (row as unknown as Record<string, unknown>)[key];
      return out;
    },
  },
  product: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const product = db.products.get(where.id);
      return product ? { ...product } : null;
    },
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
  },
  get paymentSession(): never {
    throw new Error("the download route must never read PaymentSession");
  },
};

let GET: (req: Request, ctx: { params: Promise<{ productId: string }> }) => Promise<Response>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      getClientIp: (req: Request) => req.headers.get("x-forwarded-for") ?? "unknown",
      rateLimiters: {
        api: (ip: string) => {
          const n = (hits.get(ip) ?? 0) + 1;
          hits.set(ip, n);
          return { success: n <= 100, remaining: Math.max(0, 100 - n), resetTime: 0 };
        },
      },
    },
  });
  mock.module("@/lib/storage/provider", {
    namedExports: {
      createDeliveryUrl: async (key: string) => {
        signCalls.push({ key });
        return { ok: true, url: SIGNED_URL, expiresAt: new Date(0) };
      },
      MAX_DELIVERY_TTL_SECONDS: 300,
      MIN_DELIVERY_TTL_SECONDS: 30,
      DEFAULT_DELIVERY_TTL_SECONDS: 60,
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
  GET = (await import("../app/api/download/[productId]/route.ts")).GET as typeof GET;
});

let ip = 0;
function get(productId: string, query = "", headers: Record<string, string> = {}) {
  ip++;
  return GET(
    new Request(`https://saiflow.test/api/download/${productId}${query}`, {
      headers: { "x-forwarded-for": `10.3.${(ip >> 8) & 255}.${ip & 255}`, ...headers },
    }),
    { params: Promise.resolve({ productId }) }
  );
}

const product = (id: string, name: string, key: string | null, over: Partial<ProductRow> = {}): ProductRow => ({
  id,
  name,
  fileKey: key,
  fileScanStatus: "SAFE",
  fileScanKey: key,
  ...over,
});

function reset() {
  db.orders = [
    { id: "order_a", productId: "prod_a", paymentProvider: "GEIDEA", merchantReferenceId: REF_A, stripeSessionId: null },
    { id: "order_b", productId: "prod_b", paymentProvider: "GEIDEA", merchantReferenceId: REF_B, stripeSessionId: null },
    { id: "order_s", productId: "prod_a", paymentProvider: "STRIPE", merchantReferenceId: null, stripeSessionId: "cs_test_abc" },
  ];
  db.products = new Map([
    ["prod_a", product("prod_a", "Pack A", KEY_A)],
    ["prod_b", product("prod_b", "Pack B", KEY_B)],
  ]);
  lookups.length = 0;
  signCalls.length = 0;
}
beforeEach(reset);

async function refused(res: Response, status: number, code?: string) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}`);
  assert.equal(signCalls.length, 0, "a refusal must never sign anything");
  assert.equal(res.headers.get("location"), null, "a refusal must not redirect");
  const body = await res.text();
  assert.ok(!body.includes("signed.example.test"), "refusal leaked a signed URL");
  assert.ok(!body.includes("SECRET"));
  assert.ok(!body.includes("order_"), "refusal leaked an order id");
  if (code) assert.equal(JSON.parse(body).error, code);
}

/* ------------------------------------------------------------------ */
/* The Geidea channel                                                  */
/* ------------------------------------------------------------------ */

describe("a confirmed Geidea Order downloads exactly its product", () => {
  test("redirects to a signed URL for the Order's own file", async () => {
    const res = await get("prod_a", `?ref=${REF_A}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), SIGNED_URL);
    assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(signCalls, [{ key: KEY_A }]);
    assert.deepEqual(lookups, [{ merchantReferenceId: REF_A }], "one lookup, by the reference alone");
  });

  test("the JSON channel returns the same channel's own path and no ids", async () => {
    const res = await get("prod_a", `?ref=${REF_A}&format=json`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, { productName: "Pack A", downloadUrl: `/api/download/prod_a?ref=${REF_A}` });
    assert.equal(signCalls.length, 0, "the JSON channel signs nothing");
  });

  test("the reference is accepted case-insensitively but used as given", async () => {
    db.orders[0].merchantReferenceId = REF_A.toUpperCase();
    const res = await get("prod_a", `?ref=${REF_A.toUpperCase()}`);
    assert.equal(res.status, 302);
  });

  test("the Order's provider must be GEIDEA even when a reference somehow matches", async () => {
    db.orders.push({ id: "order_x", productId: "prod_a", paymentProvider: "STRIPE", merchantReferenceId: REF_STRIPEISH, stripeSessionId: "cs_test_x" });
    await refused(await get("prod_a", `?ref=${REF_STRIPEISH}`), 403);
  });
});

/* ------------------------------------------------------------------ */
/* Nothing but an Order authorises                                     */
/* ------------------------------------------------------------------ */

describe("without a confirmed Order, nothing downloads", () => {
  test("an attempt without an Order cannot download, and the attempt is never even read", async () => {
    db.orders = [];
    await refused(await get("prod_a", `?ref=${REF_A}`), 403);
    assert.deepEqual(lookups, [{ merchantReferenceId: REF_A }]);
    // The fake's paymentSession accessor throws; a 403 rather than a 500
    // proves the route never reached for it.
  });

  test("a PAID attempt without an Order cannot download", async () => {
    // Indistinguishable from the previous case by design: the route has no
    // way to see an attempt's status, PAID or otherwise.
    db.orders = [];
    await refused(await get("prod_a", `?ref=${REF_A}`), 403);
  });

  test("a failed, cancelled or expired attempt cannot download", async () => {
    db.orders = [];
    for (const ref of [REF_A, REF_B, UNKNOWN_REF]) {
      await refused(await get("prod_a", `?ref=${ref}`), 403);
    }
  });

  test("the return URL by itself authorises nothing", async () => {
    // Everything the buyer holds after the redirect is the reference. With
    // no Order for it, the reference opens nothing.
    db.orders = db.orders.filter((o) => o.merchantReferenceId !== REF_A);
    await refused(await get("prod_a", `?ref=${REF_A}`), 403);
    await refused(await get("prod_a", `?ref=${REF_A}&format=json`), 403);
  });

  test("an unknown reference is refused", async () => {
    await refused(await get("prod_a", `?ref=${UNKNOWN_REF}`), 403);
  });

  test("a malformed reference is refused without a database lookup", async () => {
    for (const ref of ["", "42", "cs_test_abc", "order_a", `${REF_A}x`, `${REF_A}%20`, "null", "undefined"]) {
      reset();
      await refused(await get("prod_a", `?ref=${ref}`), 403);
      assert.equal(lookups.length, 0, `no lookup for ${JSON.stringify(ref)}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* IDOR                                                                */
/* ------------------------------------------------------------------ */

describe("a reference for one product never opens another", () => {
  test("correct reference, wrong product in the path", async () => {
    await refused(await get("prod_b", `?ref=${REF_A}`), 403);
    await refused(await get("prod_a", `?ref=${REF_B}`), 403);
  });

  test("the Order's productId must equal the path exactly", async () => {
    for (const path of ["PROD_A", "prod_a ", "prod_a/", "prod_a%00", "prod_ab"]) {
      reset();
      await refused(await get(path, `?ref=${REF_A}`), 403);
    }
  });

  test("a product that no longer exists is refused after authorisation", async () => {
    db.products.delete("prod_a");
    await refused(await get("prod_a", `?ref=${REF_A}`), 404);
  });
});

/* ------------------------------------------------------------------ */
/* The channels never bleed                                            */
/* ------------------------------------------------------------------ */

describe("the three channels are explicit and never fall through", () => {
  test("a Stripe session id cannot enter the Geidea channel", async () => {
    await refused(await get("prod_a", "?ref=cs_test_abc"), 403);
    assert.equal(lookups.length, 0);
    await refused(await get("cs_test_abc", `?ref=${REF_A}`), 403);
    assert.equal(lookups.length, 0, "a cs_ path with a ref is refused without a lookup");
  });

  test("a Geidea reference cannot enter the Stripe channel", async () => {
    await refused(await get(REF_A), 403);
    assert.equal(lookups.length, 0, "a bare reference in the path is not a Stripe session id");
    await refused(await get(`cs_${REF_A}`), 403);
    assert.deepEqual(lookups, [{ stripeSessionId: `cs_${REF_A}` }], "looked up as a Stripe session, found nothing");
  });

  test("a Geidea reference cannot enter the email channel", async () => {
    await refused(await get("prod_a", `?orderId=${REF_A}`), 403);
    assert.deepEqual(lookups, [{ id: REF_A }], "looked up as an Order id, found nothing");
  });

  test("two credentials at once are refused without a lookup", async () => {
    await refused(await get("prod_a", `?ref=${REF_A}&orderId=order_a`), 403);
    assert.equal(lookups.length, 0);
  });

  test("the Stripe success channel still works for its historical orders", async () => {
    const res = await get("cs_test_abc");
    assert.equal(res.status, 302);
    assert.deepEqual(lookups, [{ stripeSessionId: "cs_test_abc" }]);
    assert.deepEqual(signCalls, [{ key: KEY_A }]);
  });

  test("the email channel still works for both providers' receipts", async () => {
    let res = await get("prod_a", "?orderId=order_s");
    assert.equal(res.status, 302);
    reset();
    res = await get("prod_a", "?orderId=order_a");
    assert.equal(res.status, 302);
    reset();
    await refused(await get("prod_b", "?orderId=order_a"), 403);
  });
});

/* ------------------------------------------------------------------ */
/* File safety and rate limiting are untouched                          */
/* ------------------------------------------------------------------ */

describe("a confirmed purchase still cannot receive an unsafe file", () => {
  test("every non-SAFE state refuses after authorisation, without signing", async () => {
    const cases: Partial<ProductRow>[] = [
      { fileScanStatus: "PENDING_SCAN", fileScanKey: null },
      { fileScanStatus: "UNSAFE" },
      { fileScanStatus: "SCAN_ERROR" },
      { fileScanStatus: "SAFE", fileScanKey: KEY_B },
      { fileKey: null, fileScanKey: null },
      { fileScanStatus: "QUARANTINED" },
    ];
    for (const over of cases) {
      reset();
      db.products.set("prod_a", product("prod_a", "Pack A", KEY_A, over));
      await refused(await get("prod_a", `?ref=${REF_A}`), 409, "file_not_available");
      assert.equal(lookups.length, 1, "authorisation ran, then the gate refused");
    }
  });

  test("the safety refusal does not say which state failed", async () => {
    const bodies = new Set<string>();
    for (const status of ["PENDING_SCAN", "UNSAFE", "SCAN_ERROR"]) {
      reset();
      db.products.set("prod_a", product("prod_a", "Pack A", KEY_A, { fileScanStatus: status }));
      bodies.add(await (await get("prod_a", `?ref=${REF_A}`)).text());
    }
    assert.equal(bodies.size, 1);
  });

  test("a single address is rate limited before anything else", async () => {
    const fixed = { "x-forwarded-for": "203.0.113.77" };
    let last = 0;
    for (let i = 0; i < 101; i++) last = (await get("prod_a", `?ref=${REF_A}`, fixed)).status;
    assert.equal(last, 429);
  });
});

/* ------------------------------------------------------------------ */
/* Logs and structure                                                  */
/* ------------------------------------------------------------------ */

describe("logs and structure", () => {
  test("the bearer reference is never logged in full, and the channel is", async () => {
    logs.length = 0;
    await get("prod_a", `?ref=${REF_A}`);
    const line = logs.find((l) => l.startsWith("Download authorized"));
    assert.ok(line);
    assert.ok(line.includes("product=prod_a"));
    assert.ok(line.includes("channel=geidea"));
    assert.ok(!line.includes(REF_A), "the reference must not be logged");
    assert.ok(!line.includes("order_a"), "the Order id is the receipt channel's bearer and is redacted");
    assert.ok(line.includes("order=orde…"), "a prefix remains for correlation");
    assert.ok(!line.includes("SECRET") && !line.includes(KEY_A));
  });

  test("the route reads Orders only, never attempts, and keeps its order of gates", () => {
    const src = readFileSync(new URL("../app/api/download/[productId]/route.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/paymentSession/i.test(code), "no attempt table in executable code");
    assert.ok(!code.includes("payments/geidea"), "no Geidea client");
    assert.equal((code.match(/prisma\.order\.findUnique\(/g) ?? []).length, 3, "three explicit channels");
    assert.ok(code.includes('paymentProvider === "GEIDEA"'));
    assert.ok(code.includes("found.productId === productId"));
    const auth = code.indexOf("if (!order)");
    const gate = code.indexOf("if (!isDeliverableSafe(product))");
    const sign = code.indexOf("await createDeliveryUrl(");
    assert.ok(auth > 0 && gate > auth && sign > gate, "authorise, then the safety gate, then sign");
    assert.ok(!/fileUrl:\s*true/.test(code));
  });
});
