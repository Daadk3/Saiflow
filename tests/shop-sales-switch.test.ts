/**
 * Per-store sales switch.
 *
 * A store does not sell until the founder turns sales on. Founder stores
 * named in the migration stay on, so their live products are not interrupted.
 * The toggle is admin-only and writes an audit row. It does not approve
 * products.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("the migration", () => {
  const sql = read("prisma/migrations/20261112140000_shop_sales_enabled/migration.sql");

  test("adds the column with default false, and only turns on the two founder slugs", () => {
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "salesEnabled" BOOLEAN NOT NULL DEFAULT false/);
    assert.match(
      sql,
      /UPDATE "Shop"\s+SET "salesEnabled" = true\s+WHERE "slug" IN \('daad-s-store', 'novasphere-ai'\)/,
    );
    // ADMIN_EMAILS is process configuration, not a column, so it is not
    // copied into SQL. The two slugs are the safe backfill.
    assert.ok(!sql.includes("ADMIN_EMAILS"));
    assert.ok(!/DELETE FROM/i.test(sql));
    assert.ok(!/DROP /i.test(sql));
  });

  test("records later toggles in an append-only shop audit table", () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "ShopSalesEvent"/);
    assert.match(sql, /"actor" TEXT NOT NULL/);
    assert.match(sql, /"enabled" BOOLEAN NOT NULL/);
  });
});

describe("the product page says a closed store is not for sale, and hides Buy Now", () => {
  const page = read("app/shop/[slug]/product/[productSlug]/page.tsx");

  test("a direct link still opens, with the agreed sentence and no Buy button", () => {
    assert.match(page, /shop: \{ isActive: true, salesEnabled: false, slug: shopSlug \}/);
    assert.match(page, /salesOpen \? \([\s\S]*<BuyButton/);
    assert.match(page, /role="status"/);
    assert.ok(page.includes('t("storefront.productDetail.notAvailableForSale")'));
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    assert.equal(en.storefront.productDetail.notAvailableForSale, "This product is not available for sale yet");
    assert.equal(ar.storefront.productDetail.notAvailableForSale, "هذا المنتج غير متاح للبيع بعد");
  });
});

describe("the sales toggle", () => {
  const events: Array<Record<string, unknown>> = [];
  const state: {
    session: { user: { id: string; email: string } } | null;
    shop: { id: string; salesEnabled: boolean } | null;
  } = { session: null, shop: null };

  let POST: (req: Request, ctx: { params: Promise<{ shopId: string }> }) => Promise<Response>;

  before(async () => {
    process.env.ADMIN_EMAILS = "founder@saiflow.test";
    mock.module("next-auth", {
      namedExports: { getServerSession: async () => state.session },
    });
    mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
      namedExports: { authOptions: {} },
    });
    mock.module("@/lib/prisma", {
      namedExports: {
        prisma: {
          user: {
            findFirst: async () =>
              state.session?.user.email.toLowerCase() === "founder@saiflow.test"
                ? { id: "user_admin" }
                : null,
          },
          $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
              shop: {
                findUnique: async () => state.shop,
                updateMany: async ({ data }: { data: { salesEnabled: boolean } }) => {
                  if (!state.shop) return { count: 0 };
                  state.shop = { ...state.shop, salesEnabled: data.salesEnabled };
                  return { count: 1 };
                },
              },
              shopSalesEvent: {
                create: async ({ data }: { data: Record<string, unknown> }) => {
                  events.push(data);
                  return data;
                },
              },
            }),
        },
      },
    });
    POST = (await import("../app/api/admin/shops/[shopId]/sales/route.ts")).POST;
  });

  beforeEach(() => {
    events.length = 0;
    state.session = null;
    state.shop = { id: "shop_1", salesEnabled: false };
  });

  function post(body: unknown, shopId = "shop_1") {
    return POST(
      new Request("https://saiflow.test/api/admin/shops/shop_1/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "10.4.4.4" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ shopId }) },
    );
  }

  test("a signed-out visitor and a non-admin cannot turn sales on", async () => {
    const signedOut = await post({ enabled: true });
    assert.equal(signedOut.status, 403);
    assert.equal(state.shop?.salesEnabled, false);
    assert.equal(events.length, 0);

    state.session = { user: { id: "user_seller", email: "seller@example.test" } };
    const seller = await post({ enabled: true });
    assert.equal(seller.status, 403);
    assert.equal(state.shop?.salesEnabled, false);
    assert.equal(events.length, 0);
  });

  test("an admin turns sales on, and the audit row records who and what it became", async () => {
    state.session = { user: { id: "user_admin", email: "founder@saiflow.test" } };
    const res = await post({ enabled: true });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { salesEnabled: true, changed: true });
    assert.equal(state.shop?.salesEnabled, true);
    assert.deepEqual(events, [{ shopId: "shop_1", actor: "admin:user_admin", enabled: true }]);
  });

  test("setting the switch to the value it already has writes no audit row", async () => {
    state.session = { user: { id: "user_admin", email: "founder@saiflow.test" } };
    state.shop = { id: "shop_1", salesEnabled: true };
    const res = await post({ enabled: true });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { salesEnabled: true, changed: false });
    assert.equal(events.length, 0);
  });
});
