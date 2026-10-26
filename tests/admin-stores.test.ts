/**
 * The founder's store directory.
 *
 * Behaviour (lib/admin-stores.ts against a Prisma stand-in): every store is
 * listed, owners come from OWNER memberships, and the "live" count uses the
 * storefront's own gate. Structure (the page): admin-only by its segment,
 * public link only for active stores, reachable from the dashboard.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const calls: {
  findMany?: Record<string, unknown>;
  count?: Record<string, unknown>;
  groupBy?: Record<string, unknown>;
  shopGroupBy?: Record<string, unknown>;
} = {};
const prisma = {
  shop: {
    findMany: (args: Record<string, unknown>) => {
      calls.findMany = args;
      return [
        {
          id: "shop_new", name: "قصص للأطفال", slug: "shop-8uccus", isActive: true, createdAt: new Date("2026-10-11T18:31:00Z"),
          country: null, city: null,
          shopUsers: [], _count: { products: 0 },
        },
        {
          id: "shop_old", name: "memo", slug: "memo", isActive: false, createdAt: new Date("2026-09-01T10:00:00Z"),
          country: "SA", city: "الرياض",
          shopUsers: [{ user: { name: "Maya", email: "maya@example.test" } }], _count: { products: 3 },
        },
      ];
    },
    count: (args: Record<string, unknown>) => {
      calls.count = args;
      return 2;
    },
    groupBy: async (args: Record<string, unknown>) => {
      calls.shopGroupBy = args;
      return [
        { country: null, _count: { _all: 1 } },
        { country: "EG", _count: { _all: 4 } },
        { country: "SA", _count: { _all: 4 } },
      ];
    },
  },
  product: {
    fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
    groupBy: async (args: Record<string, unknown>) => {
      calls.groupBy = args;
      return [{ shopId: "shop_old", _count: { _all: 2 } }];
    },
  },
  $transaction: async (ops: unknown[]) => Promise.all(ops),
};

import type { StoreRow } from "../lib/admin-stores.ts";

let getStoresDirectory: (
  query?: { q?: string; country?: string }
) => Promise<{ rows: StoreRow[]; total: number; byCountry: Array<{ country: string | null; count: number }> }>;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma } });
  getStoresDirectory = (await import("../lib/admin-stores.ts")).getStoresDirectory;
});

describe("the store directory data", () => {
  test("every store is listed, newest first, including stores with no products", async () => {
    const { rows, total } = await getStoresDirectory();
    assert.equal(total, 2);
    assert.deepEqual(rows.map((r) => r.slug), ["shop-8uccus", "memo"]);
    assert.equal(rows[0].products, 0);
    assert.equal(rows[0].country, null, "a store opened before location was asked is unknown");
    assert.equal(rows[0].city, null);
    assert.equal(rows[1].country, "SA");
    assert.equal(rows[1].city, "الرياض");
    assert.deepEqual(rows[0].owners, []);
    const select = calls.findMany!.select as Record<string, unknown>;
    assert.equal(select.country, true);
    assert.equal(select.city, true);
    assert.deepEqual(calls.findMany!.orderBy, { createdAt: "desc" });
    assert.deepEqual((calls.findMany!.select as Record<string, { where?: unknown }>).shopUsers.where, { role: "OWNER" });
  });

  test("live counts use the storefront gate: approved, active and a SAFE file bound to its key", async () => {
    const { rows } = await getStoresDirectory();
    assert.equal(rows[1].live, 2);
    assert.equal(rows[0].live, 0);
    const where = calls.groupBy!.where as Record<string, unknown>;
    assert.equal(where.isActive, true);
    assert.equal(where.moderationStatus, "APPROVED");
    assert.equal(where.fileScanStatus, "SAFE");
    assert.deepEqual(where.fileKey, { not: null });
    assert.deepEqual(where.shopId, { in: ["shop_new", "shop_old"] });
  });

  test("search is by store name, case-insensitive, and applies to the total too", async () => {
    await getStoresDirectory({ q: "Memo" });
    const where = { name: { contains: "Memo", mode: "insensitive" } };
    assert.deepEqual(calls.findMany!.where, where);
    assert.deepEqual(calls.count!.where, where);
  });

  test("a country filter limits the list, and unknown means no country was saved", async () => {
    await getStoresDirectory({ country: "SA" });
    assert.deepEqual(calls.findMany!.where, { country: "SA" });
    assert.deepEqual(calls.count!.where, { country: "SA" });
    await getStoresDirectory({ q: "Memo", country: "unknown" });
    assert.deepEqual(calls.findMany!.where, {
      name: { contains: "Memo", mode: "insensitive" },
      country: null,
    });
  });

  test("the summary counts every store per country, including unknown, and ignores the list filter", async () => {
    const { byCountry } = await getStoresDirectory({ country: "SA" });
    assert.deepEqual(calls.shopGroupBy, { by: ["country"], _count: { _all: true } });
    assert.deepEqual(byCountry, [
      { country: "EG", count: 4 },
      { country: "SA", count: 4 },
      { country: null, count: 1 },
    ]);
  });
});

describe("the page", () => {
  const page = read("app/dashboard/admin/stores/page.tsx");

  test("it lives under the admin segment, whose layout enforces admin access", () => {
    const layout = read("app/dashboard/admin/layout.tsx");
    assert.match(layout, /if \(!isAdminEmail\(session\.user\.email\)\) redirect\("\/dashboard"\);/);
  });

  test("a store's public page is linked only while the store is active", () => {
    assert.match(page, /\{store\.isActive \? \(\s*<Link href=\{`\/shop\/\$\{encodeURIComponent\(store\.slug\)\}`\}/);
  });

  test("the dashboard links to it, in both languages", () => {
    assert.match(read("app/dashboard/admin/page.tsx"), /href="\/dashboard\/admin\/stores"[\s\S]*?\{t\("actions\.stores"\)\}/);
    for (const lang of ["ar", "en"]) {
      const admin = JSON.parse(read(`messages/${lang}.json`)).admin;
      assert.ok(admin.actions.stores, lang);
      for (const key of ["title", "subtitle", "search", "searchButton", "count", "showingFirst", "empty", "active", "suspended", "owner", "products", "productCounts", "created", "country", "city", "unknown", "countryAll", "countryFilter", "byCountry"]) {
        assert.ok(admin.stores[key], `${lang} admin.stores.${key}`);
      }
    }
  });

  test("it shows country and city, filters by country, and summarizes stores per country", () => {
    assert.match(page, /t\("stores\.country"\)/);
    assert.match(page, /t\("stores\.city"\)/);
    assert.match(page, /t\("stores\.unknown"\)/);
    assert.match(page, /t\("stores\.byCountry"\)/);
    assert.match(page, /name="country"/);
    assert.match(page, /countryOptionLabel/);
  });
});
