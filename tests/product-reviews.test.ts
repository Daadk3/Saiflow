/**
 * Verified-buyer reviews.
 *
 * A review exists only for a paid Order, proved by a signed link (order,
 * product and email) or by a session on that same email. Failed, refunded,
 * missing and mismatched purchases are refused. One row per buyer per
 * product. Hidden rows stay, and leave the average.
 */

import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewRefusal } from "../lib/reviews/eligibility.ts";
import { reviewBody, reviewSubmitSchema } from "../lib/reviews/text.ts";
import { maskedBuyer, summarizeVisible, visibleStars } from "../lib/reviews/display.ts";
import {
  reviewLinkExpiry,
  reviewPagePath,
  signReviewToken,
  verifyReviewToken,
} from "../lib/review-links.ts";
import { rateLimiters } from "../lib/rate-limit.ts";

const SECRET = "test-only-review-secret";
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const paid = { status: "PAID", providerStatus: "Success/Paid" };

describe("the review link", () => {
  const issued = new Date("2026-11-01T00:00:00Z");
  const input = {
    orderId: "order_1",
    productId: "prod_1",
    customerEmail: "Buyer@Example.test",
    expiresAt: reviewLinkExpiry(issued),
  };

  test("a signed link verifies for that order, product and email, and hides the email", () => {
    const token = signReviewToken(input, SECRET);
    assert.ok(!token.includes("example.test"));
    assert.deepEqual(verifyReviewToken(token, "prod_1", "buyer@example.test", SECRET, issued), { ok: true, orderId: "order_1" });
    const path = reviewPagePath({ ...input, issuedAt: issued }, SECRET);
    assert.match(path, /^\/review\/prod_1\?t=/);
  });

  test("another product, another email, a swapped order id, a bad signature and expiry all fail", () => {
    const token = signReviewToken(input, SECRET);
    assert.equal(verifyReviewToken(token, "prod_other", "buyer@example.test", SECRET, issued).ok, false);
    assert.equal(verifyReviewToken(token, "prod_1", "other@example.test", SECRET, issued).ok, false);
    const swapped = token.replace("order_1", "order_2");
    assert.deepEqual(verifyReviewToken(swapped, "prod_1", "buyer@example.test", SECRET, issued), { ok: false, reason: "bad_signature" });
    assert.equal(verifyReviewToken(`${token}x`, "prod_1", "buyer@example.test", SECRET, issued).ok, false);
    const later = new Date(input.expiresAt.getTime() + 1000);
    assert.deepEqual(verifyReviewToken(token, "prod_1", "buyer@example.test", SECRET, later), { ok: false, reason: "expired" });
  });

  test("no secret never signs, and never verifies", () => {
    assert.throws(() => signReviewToken(input, undefined));
    const token = signReviewToken(input, SECRET);
    assert.deepEqual(verifyReviewToken(token, "prod_1", "buyer@example.test", undefined, issued), { ok: false, reason: "no_secret" });
  });
});

describe("who may review", () => {
  const order = { productId: "prod_1", customerEmail: "buyer@example.test", paymentSession: paid };

  test("a paid order for that product and email may", () => {
    assert.equal(reviewRefusal(order, { productId: "prod_1", customerEmail: "Buyer@Example.test" }), null);
  });

  test("a legacy order with no payment session may: the Order is the proof", () => {
    assert.equal(reviewRefusal({ ...order, paymentSession: null }, { productId: "prod_1", customerEmail: "buyer@example.test" }), null);
  });

  test("no order, another product, another email, an unpaid session and a refund cannot", () => {
    const expect = { productId: "prod_1", customerEmail: "buyer@example.test" };
    assert.equal(reviewRefusal(null, expect), "no_order");
    assert.equal(reviewRefusal({ ...order, productId: "prod_other" }, expect), "product_mismatch");
    assert.equal(reviewRefusal(order, { ...expect, customerEmail: "other@example.test" }), "email_mismatch");
    assert.equal(reviewRefusal({ ...order, paymentSession: { status: "FAILED", providerStatus: "Failed" } }, expect), "unpaid");
    assert.equal(reviewRefusal({ ...order, paymentSession: { status: "PAID", providerStatus: "Success/Refunded" } }, expect), "refunded");
  });
});

describe("what may be written", () => {
  test("stars are 1 to 5, and the words are optional plain text", () => {
    assert.equal(reviewSubmitSchema.safeParse({ productId: "prod_1", stars: 5 }).success, true);
    assert.equal(reviewSubmitSchema.safeParse({ productId: "prod_1", stars: 0 }).success, false);
    assert.equal(reviewSubmitSchema.safeParse({ productId: "prod_1", stars: 6 }).success, false);
    assert.equal(reviewSubmitSchema.safeParse({ productId: "prod_1", stars: 1.5 }).success, false);
    assert.deepEqual(reviewBody(undefined), { ok: true, text: null });
    assert.deepEqual(reviewBody("  منتج واضح  "), { ok: true, text: "منتج واضح" });
  });

  test("a link, a phone, markup and an over-long note are refused", () => {
    assert.equal(reviewBody("see https://example.com").ok, false);
    assert.equal(reviewBody("للطلب 0551234567").ok, false);
    assert.equal(reviewBody("انستقرام").ok, false);
    assert.deepEqual(reviewBody("<b>nice</b>"), { ok: false, error: "markup" });
    assert.equal(reviewBody("a".repeat(501)).ok, false);
    assert.equal(reviewBody("a".repeat(500)).ok, true);
  });

  test("the buyer is one character, never the address", () => {
    assert.equal(maskedBuyer("sara.nasser@example.com"), "s•••");
    assert.equal(maskedBuyer("سارة@example.com"), "س•••");
    assert.ok(!maskedBuyer("sara.nasser@example.com").includes("nasser"));
    assert.ok(!maskedBuyer("sara.nasser@example.com").includes("@"));
  });

  test("a hidden review is left out of the average, and zero reviews is not a rating", () => {
    const rows = [
      { stars: 5, hiddenAt: null },
      { stars: 1, hiddenAt: new Date() },
      { stars: 4, hiddenAt: null },
    ];
    assert.deepEqual(summarizeVisible(visibleStars(rows)), { average: 4.5, count: 2 });
    assert.equal(summarizeVisible([]), null);
    assert.deepEqual(summarizeVisible([5, 5, 4]), { average: 4.7, count: 3 });
  });
});

describe("the migration and the page", () => {
  test("the migration only adds the two tables, checks the stars, and writes no rows", () => {
    const name = "20261112130000_product_reviews";
    const sql = read(`prisma/migrations/${name}/migration.sql`);
    // Later than the production migration that already owns 20261112120000, so
    // `prisma migrate deploy` sorts this folder strictly after it.
    assert.ok(name > "20261112120000_product_landing_and_compare_at");
    assert.match(sql, /CHECK \("stars" >= 1 AND "stars" <= 5\)/);
    assert.match(sql, /ProductReview_buyerEmail_productId_key/);
    assert.match(sql, /ProductReview_orderId_productId_key/);
    assert.ok(!/^\s*(INSERT|UPDATE|DELETE|DROP)\b/im.test(sql));
    for (const table of ["Rating", "Product", "Order"]) {
      assert.ok(!new RegExp(`ALTER TABLE "${table}"`, "i").test(sql), table);
    }
  });

  test("the public section shows nothing when there are no reviews, and does not inject HTML", () => {
    const src = read("components/product-reviews/ProductReviewSection.tsx");
    assert.match(src, /summary\.count === 0/);
    assert.ok(!src.includes("dangerouslySetInnerHTML"));
    assert.match(read("lib/reviews/store.ts"), /hiddenAt: null/);
  });

  test("Arabic and English have the same review strings", () => {
    const en = JSON.parse(read("messages/en.json")).reviews;
    const ar = JSON.parse(read("messages/ar.json")).reviews;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
    assert.equal(ar.verified, "مشتري موثق");
  });

  test("submit is rate limited like the other public writes", () => {
    const ip = "203.0.113.44";
    for (let i = 0; i < 10; i++) assert.equal(rateLimiters.review(ip).success, true);
    assert.equal(rateLimiters.review(ip).success, false);
    assert.equal(rateLimiters.review("203.0.113.45").success, true);
  });
});

/* ------------------------------------------------------------------ */
/* The routes, against a fake database                                 */
/* ------------------------------------------------------------------ */

type OrderRow = {
  id: string;
  productId: string;
  productName: string;
  customerEmail: string;
  paymentSession: { status: string; providerStatus: string | null } | null;
};
type ReviewRow = {
  id: string;
  productId: string;
  orderId: string;
  buyerEmail: string;
  stars: number;
  body: string | null;
  hiddenAt: Date | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
  shopId: string;
};
type ReportRow = { id: string; reviewId: string; reporterUserId: string; reason: string };

const db: { orders: OrderRow[]; reviews: ReviewRow[]; reports: ReportRow[]; members: { userId: string; email: string; shopId: string; role: string }[] } = {
  orders: [],
  reviews: [],
  reports: [],
  members: [],
};
const state = { session: null as { user: { email: string } } | null, allowReview: true };

function order(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "order_1",
    productId: "prod_1",
    productName: "دليل",
    customerEmail: "buyer@example.test",
    paymentSession: { status: "PAID", providerStatus: "Success/Paid" },
    ...over,
  };
}

const fakePrisma = {
  order: {
    findUnique: async ({ where }: { where: { id: string } }) => db.orders.find((row) => row.id === where.id) ?? null,
  },
  productReview: {
    findUnique: async ({ where }: { where: { id?: string; buyerEmail_productId?: { buyerEmail: string; productId: string } } }) => {
      const row = where.id
        ? db.reviews.find((review) => review.id === where.id)
        : db.reviews.find(
            (review) =>
              review.buyerEmail === where.buyerEmail_productId?.buyerEmail && review.productId === where.buyerEmail_productId?.productId
          );
      if (!row) return null;
      return { ...row, product: { shopId: row.shopId, name: "دليل", shop: { name: "متجر" } } };
    },
    create: async ({ data }: { data: Omit<ReviewRow, "id" | "hiddenAt" | "hiddenBy" | "hiddenReason" | "shopId"> }) => {
      if (db.reviews.some((review) => review.buyerEmail === data.buyerEmail && review.productId === data.productId)) {
        const error = new Error("unique") as Error & { code: string };
        error.code = "P2002";
        throw error;
      }
      const row: ReviewRow = { ...data, id: `rev_${db.reviews.length + 1}`, hiddenAt: null, hiddenBy: null, hiddenReason: null, shopId: "shop_1" };
      db.reviews.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<ReviewRow> }) => {
      const row = db.reviews.find((review) => review.id === where.id);
      if (!row) throw new Error("missing");
      Object.assign(row, data);
      return row;
    },
  },
  shopUser: {
    findFirst: async ({ where }: { where: { shopId: string; user: { email: { equals: string } } } }) => {
      const email = where.user.email.equals.toLowerCase();
      return db.members.find((member) => member.shopId === where.shopId && member.email === email) ?? null;
    },
  },
  productReviewReport: {
    upsert: async ({
      where,
      create,
      update,
    }: {
      where: { reviewId_reporterUserId: { reviewId: string; reporterUserId: string } };
      create: ReportRow;
      update: { reason: string };
    }) => {
      const key = where.reviewId_reporterUserId;
      const existing = db.reports.find((report) => report.reviewId === key.reviewId && report.reporterUserId === key.reporterUserId);
      if (existing) {
        existing.reason = update.reason;
        return existing;
      }
      const row = { ...create, id: `report_${db.reports.length + 1}` };
      db.reports.push(row);
      return row;
    },
  },
};

let POST: (req: Request) => Promise<Response>;
let reportPOST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let adminPOST: (req: Request) => Promise<Response>;

before(async () => {
  process.env.ADMIN_EMAILS = "founder@admin.test";
  process.env.NEXTAUTH_SECRET = SECRET;
  mock.module("@/lib/prisma", { namedExports: { prisma: fakePrisma } });
  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module("@/app/api/auth/authOptions", { namedExports: { authOptions: {} } });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      getClientIp: () => "198.51.100.8",
      accountKey: (email: string) => email,
      retryAfterSeconds: () => 60,
      rateLimiters: {
        review: () => ({ success: state.allowReview, remaining: 0, resetTime: Date.now() + 1000 }),
        reviewAccount: () => ({ success: true, remaining: 1, resetTime: Date.now() + 1000 }),
        reviewReport: () => ({ success: true, remaining: 1, resetTime: Date.now() + 1000 }),
        api: () => ({ success: true, remaining: 1, resetTime: Date.now() + 1000 }),
      },
    },
  });
  POST = (await import("../app/api/reviews/route.ts")).POST;
  reportPOST = (await import("../app/api/reviews/[id]/report/route.ts")).POST as typeof reportPOST;
  adminPOST = (await import("../app/api/admin/reviews/route.ts")).POST;
});

beforeEach(() => {
  db.orders = [order()];
  db.reviews = [];
  db.reports = [];
  db.members = [{ userId: "user_owner", email: "owner@shop.test", shopId: "shop_1", role: "OWNER" }];
  state.session = null;
  state.allowReview = true;
});

function submit(body: unknown) {
  return POST(new Request("https://saiflow.test/api/reviews", { method: "POST", body: JSON.stringify(body) }));
}

const tokenFor = (over: Partial<Parameters<typeof signReviewToken>[0]> = {}) =>
  signReviewToken(
    { orderId: "order_1", productId: "prod_1", customerEmail: "buyer@example.test", expiresAt: reviewLinkExpiry(new Date()), ...over },
    SECRET
  );

describe("POST /api/reviews", () => {
  test("a paid order's token publishes one review", async () => {
    const res = await submit({ productId: "prod_1", stars: 5, body: "منتج واضح", token: tokenFor() });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, created: true });
    assert.equal(db.reviews.length, 1);
    assert.equal(db.reviews[0].buyerEmail, "buyer@example.test");
    assert.equal(db.reviews[0].stars, 5);
  });

  test("no order, an unpaid order, another product, another email and a reused signature are refused", async () => {
    db.orders = [];
    assert.equal((await submit({ productId: "prod_1", stars: 5, token: tokenFor() })).status, 403);

    db.orders = [order({ paymentSession: { status: "FAILED", providerStatus: "Failed" } })];
    const unpaid = await submit({ productId: "prod_1", stars: 5, token: tokenFor() });
    assert.equal(unpaid.status, 403);
    assert.equal((await unpaid.json()).error, "not_allowed");

    db.orders = [order({ paymentSession: { status: "PAID", providerStatus: "Refunded" } })];
    assert.equal((await (await submit({ productId: "prod_1", stars: 5, token: tokenFor() })).json()).error, "not_allowed");

    db.orders = [order()];
    const otherProduct = await submit({ productId: "prod_other", stars: 5, token: tokenFor() });
    assert.equal((await otherProduct.json()).error, "invalid");

    state.session = { user: { email: "other@example.test" } };
    const otherEmail = await submit({ productId: "prod_1", stars: 5, orderId: "order_1" });
    assert.equal((await otherEmail.json()).error, "not_allowed");

    const forged = tokenFor().replace("order_1", "order_9");
    assert.equal((await submit({ productId: "prod_1", stars: 5, token: forged })).status, 403);
    assert.equal(db.reviews.length, 0);
  });

  test("the same buyer edits the one review instead of writing a second", async () => {
    const token = tokenFor();
    await submit({ productId: "prod_1", stars: 5, body: "أول", token });
    const again = await submit({ productId: "prod_1", stars: 4, body: "تعديل", token });
    assert.deepEqual(await again.json(), { ok: true, created: false });
    assert.equal(db.reviews.length, 1);
    assert.equal(db.reviews[0].stars, 4);
    assert.equal(db.reviews[0].body, "تعديل");

    db.orders.push(order({ id: "order_2" }));
    await submit({ productId: "prod_1", stars: 3, token: tokenFor({ orderId: "order_2" }) });
    assert.equal(db.reviews.length, 1, "a second purchase does not create a second review");
    assert.equal(db.reviews[0].orderId, "order_1");
    assert.equal(db.reviews[0].stars, 3);
  });

  test("a signed-in buyer reviews from My purchases, and a stranger does not", async () => {
    const missing = await submit({ productId: "prod_1", stars: 5, orderId: "order_1" });
    assert.equal(missing.status, 401);
    state.session = { user: { email: "buyer@example.test" } };
    const res = await submit({ productId: "prod_1", stars: 4, orderId: "order_1" });
    assert.equal((await res.json()).created, true);
  });

  test("validation refuses a bad score, a link and a long note", async () => {
    const token = tokenFor();
    assert.equal((await submit({ productId: "prod_1", stars: 0, token })).status, 400);
    assert.equal((await submit({ productId: "prod_1", stars: 6, token })).status, 400);
    const link = await submit({ productId: "prod_1", stars: 5, body: "https://example.com", token });
    assert.equal((await link.json()).error, "contact");
    const long = await submit({ productId: "prod_1", stars: 5, body: "ا".repeat(501), token });
    assert.equal((await long.json()).error, "too_long");
    assert.equal(db.reviews.length, 0);
  });

  test("the submit limiter answers 429", async () => {
    state.allowReview = false;
    const res = await submit({ productId: "prod_1", stars: 5, token: tokenFor() });
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
  });
});

describe("seller report and admin hide", () => {
  beforeEach(() => {
    db.reviews.push({
      id: "rev_1",
      productId: "prod_1",
      orderId: "order_1",
      buyerEmail: "buyer@example.test",
      stars: 2,
      body: "لم يعجبني",
      hiddenAt: null,
      hiddenBy: null,
      hiddenReason: null,
      shopId: "shop_1",
    });
  });

  test("only the shop owner can report, and the report does not change the review", async () => {
    const call = (email: string | null) => {
      state.session = email ? { user: { email } } : null;
      return reportPOST(
        new Request("https://saiflow.test/api/reviews/rev_1/report", {
          method: "POST",
          body: JSON.stringify({ reason: "لا يصف المنتج" }),
        }),
        { params: Promise.resolve({ id: "rev_1" }) }
      );
    };
    assert.equal((await call(null)).status, 401);
    db.members[0].role = "MEMBER";
    assert.equal((await call("owner@shop.test")).status, 403);
    db.members[0].role = "OWNER";
    assert.equal((await call("stranger@shop.test")).status, 403);
    const ok = await call("owner@shop.test");
    assert.equal(ok.status, 200);
    assert.equal(db.reports.length, 1);
    assert.equal(db.reviews[0].stars, 2);
    assert.equal(db.reviews[0].body, "لم يعجبني");
    assert.equal(db.reviews[0].hiddenAt, null);
  });

  test("only an admin can hide, and a hidden review leaves the average", async () => {
    const hide = (email: string | null, body: unknown) => {
      state.session = email ? { user: { email } } : null;
      return adminPOST(new Request("https://saiflow.test/api/admin/reviews", { method: "POST", body: JSON.stringify(body) }));
    };
    assert.equal((await hide("owner@shop.test", { reviewId: "rev_1", action: "hide", reason: "إساءة" })).status, 403);
    assert.equal((await hide("founder@admin.test", { reviewId: "rev_1", action: "hide", reason: "لا" })).status, 400);
    const hidden = await hide("founder@admin.test", { reviewId: "rev_1", action: "hide", reason: "لا تتعلق بالمنتج" });
    assert.equal(hidden.status, 200);
    assert.ok(db.reviews[0].hiddenAt instanceof Date);
    assert.equal(db.reviews[0].hiddenBy, "founder@admin.test");
    assert.equal(summarizeVisible(visibleStars(db.reviews)), null);

    const restored = await hide("founder@admin.test", { reviewId: "rev_1", action: "unhide" });
    assert.equal(restored.status, 200);
    assert.equal(db.reviews[0].hiddenAt, null);
    assert.deepEqual(summarizeVisible(visibleStars(db.reviews)), { average: 2, count: 1 });
  });
});
