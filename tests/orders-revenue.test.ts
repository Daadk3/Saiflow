/**
 * GET /api/orders — the seller's revenue, split by lib/pricing, real vs test.
 *
 * BEHAVIOURAL: the real route with next-auth and Prisma replaced. TEST orders
 * are listed and flagged but never counted; orders that predate the
 * commission keep their gross and report no split.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { saleBreakdown, fromHalalas } from "../lib/pricing";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Row = Record<string, unknown>;
const state = { session: null as unknown, orders: [] as Row[], where: null as Row | null };
let GET: () => Promise<Response>;

const decimal = (s: string) => ({ toString: () => s });
const order = (over: Row): Row => ({
  id: `order_${Math.random().toString(36).slice(2, 8)}`,
  productId: "prod_1",
  productName: "Planner",
  customerEmail: "",
  createdAt: new Date("2026-09-24T10:00:00Z"),
  paymentEnvironment: "TEST",
  price: decimal("1.00"),
  grossAmount: null,
  platformFeeAmount: null,
  sellerNetAmount: null,
  commissionRateBps: null,
  commissionVersion: null,
  product: { currency: "SAR", shop: { name: "متجر", slug: "s" } },
  ...over,
});
const withSplit = (env: string, amount: string): Row => {
  const split = saleBreakdown(amount)!;
  return order({
    paymentEnvironment: env,
    price: decimal(amount),
    grossAmount: decimal(fromHalalas(split.grossHalalas)),
    platformFeeAmount: decimal(fromHalalas(split.commissionHalalas)),
    sellerNetAmount: decimal(fromHalalas(split.sellerNetHalalas)),
    commissionRateBps: split.rateBps,
    commissionVersion: split.version,
  });
};

before(async () => {
  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findFirst: async () => ({
            id: "user_1",
            shopUsers: [{ shop: { products: [{ id: "prod_1" }, { id: "prod_2" }] } }],
          }),
        },
        order: {
          findMany: async ({ where }: { where: Row }) => {
            state.where = where;
            return state.orders;
          },
        },
      },
    },
  });
  console.error = () => undefined;
  GET = (await import("../app/api/orders/route.ts")).GET as typeof GET;
});

beforeEach(() => {
  state.session = { user: { email: "seller@example.test" } };
  state.orders = [];
  state.where = null;
});

describe("real revenue, split, with test orders flagged and excluded", () => {
  test("the totals cover PRODUCTION orders only, in exact halala arithmetic", async () => {
    state.orders = [
      withSplit("PRODUCTION", "100.00"),
      order({ paymentEnvironment: "PRODUCTION", price: decimal("50.00") }), // predates the commission
      withSplit("TEST", "1.00"),
      order({ paymentEnvironment: "TEST", price: decimal("0.99") }),
    ];
    const res = await GET();
    assert.equal(res.status, 200);
    const body = (await res.json()) as Row;
    assert.deepEqual(body.totals, {
      real: { orders: 2, gross: "150.00", commission: "7.00", net: "93.00", unsplit: 1, unreadable: 0 },
      test: { orders: 2, gross: "1.99", unreadable: 0 },
    });
    assert.equal(body.totalRevenue, 150);
    assert.equal(body.totalSales, 2);
    const rows = body.orders as Row[];
    assert.deepEqual(rows.map((r) => r.isTest), [false, false, true, true]);
    assert.deepEqual([rows[0].gross, rows[0].commission, rows[0].net], ["100.00", "7.00", "93.00"]);
    assert.deepEqual([rows[1].gross, rows[1].commission, rows[1].net], ["50.00", null, null], "an old order is not reinterpreted");
    assert.deepEqual([rows[2].gross, rows[2].commission, rows[2].net], ["1.00", "0.07", "0.93"]);
  });

  test("every split row on the wire agrees with the calculator", async () => {
    state.orders = ["1.00", "10.00", "99.00", "100.00", "12.34", "99.99"].map((a) => withSplit("PRODUCTION", a));
    const body = (await (await GET()).json()) as { orders: Row[]; totals: { real: Row } };
    for (const row of body.orders) {
      const split = saleBreakdown(row.gross)!;
      assert.equal(row.commission, fromHalalas(split.commissionHalalas));
      assert.equal(row.net, fromHalalas(split.sellerNetHalalas));
    }
    assert.equal(body.totals.real.gross, "322.33");
    assert.equal(body.totals.real.commission, "22.56");
    assert.equal(body.totals.real.net, "299.77");
  });

  test("with only test orders, real revenue is zero and the test line carries the gross", async () => {
    state.orders = [withSplit("TEST", "25.00"), withSplit("TEST", "25.00")];
    const body = (await (await GET()).json()) as Row;
    assert.deepEqual(body.totals, { real: { orders: 0, gross: "0.00", commission: "0.00", net: "0.00", unsplit: 0, unreadable: 0 }, test: { orders: 2, gross: "50.00", unreadable: 0 } });
    assert.equal(body.totalRevenue, 0);
  });

  test("no floats in sight: sums of prices that would drift as floats are exact", async () => {
    state.orders = Array.from({ length: 10 }, () => withSplit("PRODUCTION", "0.10"));
    const body = (await (await GET()).json()) as { totals: { real: { gross: string; commission: string; net: string } } };
    assert.equal(body.totals.real.gross, "1.00");
    assert.equal(body.totals.real.commission, "0.10");
    assert.equal(body.totals.real.net, "0.90");
  });

  test("multi-order sums above the product ceiling are exact: gross, commission and net", async () => {
    state.orders = [withSplit("PRODUCTION", "100000.00"), withSplit("PRODUCTION", "100000.00"), withSplit("PRODUCTION", "100000.00")];
    const body = (await (await GET()).json()) as { totals: { real: Record<string, unknown> }; totalRevenue: number };
    assert.deepEqual(body.totals.real, { orders: 3, gross: "300000.00", commission: "21000.00", net: "279000.00", unsplit: 0, unreadable: 0 });
    assert.equal(body.totalRevenue, 300000);
  });

  test("a stored amount above the product ceiling is still read: 100,000.01, 150,000 and 1,000,000", async () => {
    state.orders = [
      withSplit("PRODUCTION", "100000.01"),
      withSplit("PRODUCTION", "150000.00"),
      order({ paymentEnvironment: "PRODUCTION", price: decimal("1000000.00") }), // legacy, no split
    ];
    const body = (await (await GET()).json()) as { orders: Array<Record<string, unknown>>; totals: { real: Record<string, unknown> } };
    assert.deepEqual(body.orders.map((r) => r.gross), ["100000.01", "150000.00", "1000000.00"]);
    assert.deepEqual(body.orders.map((r) => r.commission), ["7000.00", "10500.00", null]);
    assert.deepEqual(body.orders.map((r) => r.net), ["93000.01", "139500.00", null]);
    assert.deepEqual(body.totals.real, { orders: 3, gross: "1250000.01", commission: "17500.00", net: "232500.01", unsplit: 1, unreadable: 0 });
  });

  test("an unreadable amount is flagged, shown as absent and left out of every total, never zero", async () => {
    state.orders = [withSplit("PRODUCTION", "100.00"), order({ paymentEnvironment: "PRODUCTION", price: decimal("not-money") }), order({ paymentEnvironment: "TEST", price: decimal("") })];
    const body = (await (await GET()).json()) as { orders: Array<Record<string, unknown>>; totals: Record<string, Record<string, unknown>> };
    assert.deepEqual(body.orders.map((r) => [r.unreadable, r.gross]), [[false, "100.00"], [true, null], [true, null]]);
    assert.deepEqual(body.totals.real, { orders: 1, gross: "100.00", commission: "7.00", net: "93.00", unsplit: 0, unreadable: 1 });
    assert.deepEqual(body.totals.test, { orders: 0, gross: "0.00", unreadable: 1 });
  });

  test("the seller only sees their own shops' products, and anonymous gets 401", async () => {
    await GET();
    assert.deepEqual(state.where, { productId: { in: ["prod_1", "prod_2"] } });
    state.session = null;
    assert.equal((await GET()).status, 401);
  });
});
