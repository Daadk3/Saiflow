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

const calls: { findMany?: Record<string, unknown>; count?: Record<string, unknown>; groupBy?: Record<string, unknown> } = {};
const prisma = {
  shop: {
    findMany: (args: Record<string, unknown>) => {
      calls.findMany = args;
      return [
        {
          id: "shop_new", name: "قصص للأطفال", slug: "shop-8uccus", isActive: true, createdAt: new Date("2026-10-11T18:31:00Z"),
          shopUsers: [], _count: { products: 0 },
        },
        {
          id: "shop_old", name: "memo", slug: "memo", isActive: false, createdAt: new Date("2026-09-01T10:00:00Z"),
          shopUsers: [{ user: { name: "Maya", email: "maya@example.test" } }], _count: { products: 3 },
        },
      ];
    },
    count: (args: Record<string, unknown>) => {
      calls.count = args;
      return 2;
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

let getStoresDirectory: (q?: string) => Promise<{ rows: StoreRow[]; total: number }>;

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
    assert.deepEqual(rows[0].owners, []);
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
    await getStoresDirectory("Memo");
    const where = { name: { contains: "Memo", mode: "insensitive" } };
    assert.deepEqual(calls.findMany!.where, where);
    assert.deepEqual(calls.count!.where, where);
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
      for (const key of ["title", "subtitle", "search", "searchButton", "count", "showingFirst", "empty", "active", "suspended", "owner", "products", "productCounts", "created"]) {
        assert.ok(admin.stores[key], `${lang} admin.stores.${key}`);
      }
    }
  });
});
