/**
 * The payment-status endpoint and the mapping behind it.
 *
 * The endpoint is read-only by construction, and the fake Prisma here makes
 * that a hard fact: it answers `paymentSession.findUnique` and throws on any
 * other model or method, so a write of any kind would fail the test. The
 * mapping is exercised directly, including the clock-based expiry and the one
 * rule that matters most: an attempt that says PAID without an Order is still
 * "processing" as far as the buyer is told.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPIRY_GRACE_MS,
  PAYMENT_STATUSES,
  isMerchantReference,
  statusFor,
} from "../lib/payments/payment-status.ts";

const REF = "5fde430a-4ed5-4876-9929-11871c32ff8b";
const OTHER_REF = "0f0e0d0c-0b0a-4908-8706-050403020100";

interface AttemptRow {
  merchantReferenceId: string;
  status: string;
  expiresAt: Date | null;
  product: { name: string };
  order: { id: string; productId?: string } | null;
  // Fields the endpoint must never surface, present to prove they are not.
  amount: string;
  buyerEmail: string | null;
  providerSessionId: string | null;
  providerOrderId: string | null;
  id: string;
}

const db: { attempts: AttemptRow[] } = { attempts: [] };
const reads: unknown[] = [];

function forbidden(model: string, method: string) {
  return () => {
    throw new Error(`${model}.${method} must never be called by the status endpoint`);
  };
}

const fakePrisma = new Proxy(
  {},
  {
    get(_target, model: string) {
      if (model === "paymentSession") {
        return new Proxy(
          {},
          {
            get(_t, method: string) {
              if (method === "findUnique") {
                return async (args: { where: { merchantReferenceId: string }; select: unknown }) => {
                  reads.push(args);
                  const row = db.attempts.find((r) => r.merchantReferenceId === args.where.merchantReferenceId);
                  return row ? { ...row } : null;
                };
              }
              return forbidden(model, method);
            },
          }
        );
      }
      if (model === "$transaction") return forbidden("prisma", "$transaction");
      return new Proxy({}, { get: (_t, method: string) => forbidden(model, method) });
    },
  }
);

let GET: (req: Request) => Promise<Response>;

const hits = new Map<string, number>();

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
  // The real limiter is a module-level setInterval that would keep this test
  // process alive forever. Same contract, no timer: 100 per address.
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
  globalThis.fetch = (async () => {
    throw new Error("network access is not permitted in tests");
  }) as typeof fetch;
  GET = (await import("../app/api/payment-status/route.ts")).GET as typeof GET;
});

let ip = 0;
async function status(query: string, headers: Record<string, string> = {}) {
  ip++;
  const res = await GET(
    new Request(`https://saiflow.test/api/payment-status${query}`, {
      headers: { "x-forwarded-for": `10.2.${(ip >> 8) & 255}.${ip & 255}`, ...headers },
    })
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, headers: res.headers };
}

function seed(over: Partial<AttemptRow> = {}): AttemptRow {
  const row: AttemptRow = {
    id: "ps_1",
    merchantReferenceId: REF,
    status: "SESSION_CREATED",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    product: { name: "Arabic Templates Pack" },
    order: null,
    amount: "49.00",
    buyerEmail: "buyer@example.test",
    providerSessionId: "043ad7ca-9e38-474e-f09e-08def275479c",
    providerOrderId: null,
    ...over,
  };
  db.attempts.push(row);
  return row;
}

beforeEach(() => {
  db.attempts = [];
  reads.length = 0;
});

/* ------------------------------------------------------------------ */
/* The mapping                                                         */
/* ------------------------------------------------------------------ */

describe("statusFor: what the buyer is told", () => {
  const now = new Date("2026-09-22T10:00:00Z");
  const open = (status: string, expiresAt: Date | null = new Date(now.getTime() + 60_000)) => ({ status, expiresAt });

  test("paid only when an Order exists, whatever the attempt says", () => {
    for (const s of ["CREATED", "SESSION_CREATED", "PAID", "FAILED", "CANCELLED", "EXPIRED", "WEIRD"]) {
      assert.equal(statusFor(open(s), true, now), "paid", s);
    }
  });

  test("an open attempt is processing", () => {
    assert.equal(statusFor(open("CREATED"), false, now), "processing");
    assert.equal(statusFor(open("SESSION_CREATED"), false, now), "processing");
    assert.equal(statusFor(open("SESSION_CREATED", null), false, now), "processing");
  });

  test("PAID without an Order is processing, never paid", () => {
    assert.equal(statusFor(open("PAID"), false, now), "processing");
  });

  test("closed attempts map to their own word", () => {
    assert.equal(statusFor(open("FAILED"), false, now), "failed");
    assert.equal(statusFor(open("CANCELLED"), false, now), "cancelled");
    assert.equal(statusFor(open("EXPIRED"), false, now), "expired");
  });

  test("an open attempt well past its expiry reads as expired; inside the grace window it is still processing", () => {
    const expiredLongAgo = new Date(now.getTime() - EXPIRY_GRACE_MS - 1000);
    const expiredJustNow = new Date(now.getTime() - 1000);
    assert.equal(statusFor(open("SESSION_CREATED", expiredLongAgo), false, now), "expired");
    assert.equal(statusFor(open("CREATED", expiredLongAgo), false, now), "expired");
    assert.equal(statusFor(open("SESSION_CREATED", expiredJustNow), false, now), "processing");
    // The clock never overrides a confirmed Order or a closed status.
    assert.equal(statusFor(open("SESSION_CREATED", expiredLongAgo), true, now), "paid");
    assert.equal(statusFor(open("FAILED", expiredLongAgo), false, now), "failed");
  });

  test("an unknown status is processing", () => {
    assert.equal(statusFor(open("SOMETHING_NEW"), false, now), "processing");
  });

  test("the browser vocabulary is exactly five words", () => {
    assert.deepEqual([...PAYMENT_STATUSES], ["processing", "paid", "failed", "cancelled", "expired"]);
  });

  test("a merchant reference is a UUID", () => {
    assert.equal(isMerchantReference(REF), true);
    assert.equal(isMerchantReference(REF.toUpperCase()), true);
    for (const bad of ["", "42", `${REF}x`, ` ${REF}`, null, undefined, 5, {}]) {
      assert.equal(isMerchantReference(bad), false, String(bad));
    }
  });
});

/* ------------------------------------------------------------------ */
/* The endpoint                                                        */
/* ------------------------------------------------------------------ */

describe("GET /api/payment-status", () => {
  test("a malformed or missing ref is refused without touching the database", async () => {
    seed();
    for (const q of ["", "?ref=", "?ref=42", `?ref=${REF}x`, "?ref=%00", "?reference=" + REF]) {
      const res = await status(q);
      assert.equal(res.status, 400, q);
      assert.deepEqual(res.body, { error: "malformed" });
    }
    assert.equal(reads.length, 0);
  });

  test("an unknown ref is 404", async () => {
    seed();
    const res = await status(`?ref=${OTHER_REF}`);
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "unknown_reference" });
  });

  test("SESSION_CREATED without an Order is processing", async () => {
    seed();
    const res = await status(`?ref=${REF}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "processing", productName: "Arabic Templates Pack", orderExists: false });
  });

  test("a PAID attempt without a confirmed Order does not report paid", async () => {
    seed({ status: "PAID", providerOrderId: "3f433da9-2d20-4243-4fd2-08df0df6399e" });
    const res = await status(`?ref=${REF}`);
    assert.equal(res.body.status, "processing");
    assert.equal(res.body.orderExists, false);
  });

  test("a confirmed Order is paid, with a download path derived from the Order's own product", async () => {
    seed({ status: "PAID", order: { id: "order_1", productId: "prod_1" } });
    const res = await status(`?ref=${REF}`);
    assert.deepEqual(res.body, {
      status: "paid",
      productName: "Arabic Templates Pack",
      orderExists: true,
      downloadUrl: `/api/download/prod_1?ref=${REF}`,
    });
  });

  test("the download path names the Order's product, not the attempt's", async () => {
    // They agree by construction; if they ever disagreed, the Order wins,
    // because the Order is what the download route will authorise from.
    seed({ status: "PAID", order: { id: "order_1", productId: "prod_other" } });
    const res = await status(`?ref=${REF}`);
    assert.equal(res.body.downloadUrl, `/api/download/prod_other?ref=${REF}`);
  });

  test("no download path is offered unless the answer is paid", async () => {
    for (const s of ["CREATED", "SESSION_CREATED", "PAID", "FAILED", "CANCELLED", "EXPIRED"]) {
      db.attempts = [];
      seed({ status: s });
      const res = await status(`?ref=${REF}`);
      assert.ok(!("downloadUrl" in res.body), s);
    }
  });

  test("failed, cancelled and expired attempts report their word", async () => {
    for (const [s, word] of [["FAILED", "failed"], ["CANCELLED", "cancelled"], ["EXPIRED", "expired"]]) {
      db.attempts = [];
      seed({ status: s });
      assert.equal((await status(`?ref=${REF}`)).body.status, word, s);
    }
  });

  test("an open attempt long past its expiry reports expired", async () => {
    seed({ status: "SESSION_CREATED", expiresAt: new Date(Date.now() - EXPIRY_GRACE_MS - 60_000) });
    assert.equal((await status(`?ref=${REF}`)).body.status, "expired");
  });

  test("query parameters other than ref are ignored", async () => {
    seed();
    const res = await status(`?ref=${REF}&status=paid&orderExists=true&amount=0&provider=STRIPE&product=other`);
    assert.deepEqual(res.body, { status: "processing", productName: "Arabic Templates Pack", orderExists: false });
  });

  test("the response carries exactly the expected fields and nothing sensitive", async () => {
    seed();
    let res = await status(`?ref=${REF}`);
    assert.deepEqual(Object.keys(res.body).sort(), ["orderExists", "productName", "status"]);

    db.attempts = [];
    seed({ status: "PAID", order: { id: "order_1", productId: "prod_1" } });
    res = await status(`?ref=${REF}`);
    assert.deepEqual(Object.keys(res.body).sort(), ["downloadUrl", "orderExists", "productName", "status"]);
    const text = JSON.stringify(res.body);
    for (const leaked of ["order_1", "ps_1", "buyer@example.test", "49.00", "043ad7ca", "PAID", "GEIDEA", "merchantReferenceId"]) {
      assert.ok(!text.includes(leaked), `leaked ${leaked}`);
    }
  });

  test("the endpoint reads exactly what it needs and never writes", async () => {
    seed({ status: "PAID", order: { id: "order_1", productId: "prod_1" } });
    await status(`?ref=${REF}`);
    assert.equal(reads.length, 1);
    const select = (reads[0] as { select: Record<string, unknown> }).select;
    assert.deepEqual(Object.keys(select).sort(), ["expiresAt", "order", "product", "status"]);
    assert.deepEqual(select.order, { select: { productId: true } }, "the Order's id is never even read");
    assert.deepEqual(select.product, { select: { name: true } });
    // Any write would have thrown inside the fake and surfaced as a 500.
  });

  test("responses are never cacheable", async () => {
    seed();
    const res = await status(`?ref=${REF}`);
    assert.equal(res.headers.get("cache-control"), "no-store, must-revalidate");
  });

  test("a single address is rate limited", async () => {
    seed();
    const fixed = { "x-forwarded-for": "203.0.113.9" };
    let last = 0;
    for (let i = 0; i < 101; i++) last = (await status(`?ref=${REF}`, fixed)).status;
    assert.equal(last, 429);
  });

  test("only GET is exported, and Geidea is never imported", () => {
    const src = readFileSync(new URL("../app/api/payment-status/route.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/export async function GET\(/.test(src));
    assert.ok(!/export (async )?function (POST|PUT|DELETE|PATCH)\b/.test(src));
    assert.ok(!src.includes("payments/geidea"), "no Geidea client in the browser-facing endpoint");
    assert.ok(!/\bfetch\s*\(/.test(src));
    assert.ok(!/\.(create|update|updateMany|upsert|delete|\$transaction)\(/.test(src), "read-only");
    assert.ok(!src.includes("console."), "silent");
  });
});
