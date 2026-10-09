/**
 * Manual seller payouts (lib/payouts, the shop owner's payout-account route
 * and the admin payouts route).
 *
 * What must hold:
 * - Only PRODUCTION orders with a commission split and no payout are owed;
 *   TEST orders are never revenue and never paid out.
 * - Only a shop's OWNER reads or changes its bank details, and never sees the
 *   full IBAN back; the IBAN is a valid Saudi IBAN or it is refused.
 * - Only an admin records a payout, only for exactly the orders and amount
 *   the admin saw, and an order is paid out once: anything that changed in
 *   between refuses and rolls the whole recording back.
 * - Neither route logs bank details.
 */
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import {
  PAYABLE_ORDERS_WHERE,
  changedRecently,
  maskIban,
  normalizeBankName,
  normalizeBankReference,
  normalizeHolderName,
  normalizeIban,
  owedFor,
  payableOrdersWhere,
} from "../lib/payouts.ts";

const ROOT = resolve(import.meta.dirname, "..");
const IBAN = "SA0380000000608010167519";
const IBAN_B = "SA4420000001234567891234";

describe("lib/payouts rules", () => {
  test("a Saudi IBAN is kept in canonical form; anything else is refused", () => {
    assert.equal(normalizeIban(IBAN), IBAN);
    assert.equal(normalizeIban("sa03 8000 0000 6080 1016 7519"), IBAN);
    assert.equal(normalizeIban("SA03-8000-0000-6080-1016-7519"), IBAN);
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "SA0480000000608010167519",
      "SA038000000060801016751",
      "SA03800000006080101675190",
      "AE070331234567890123456",
      "GB82WEST12345698765432",
      "SAXX80000000608010167519",
      "SA03AB000000608010167519",
    ]) {
      assert.equal(normalizeIban(bad), null, JSON.stringify(bad));
    }
  });

  test("the masked form shows the country and the last four only", () => {
    const masked = maskIban(IBAN);
    assert.ok(masked.startsWith("SA"));
    assert.ok(masked.endsWith("7519"));
    assert.ok(!masked.includes("8000"), "no bank or account digits");
  });

  test("names and references are plain, bounded text", () => {
    assert.equal(normalizeHolderName("  Daad   Store  "), "Daad Store");
    assert.equal(normalizeHolderName("A"), null);
    assert.equal(normalizeHolderName("x".repeat(101)), null);
    assert.equal(normalizeHolderName("Name\u0000"), null);
    assert.equal(normalizeBankName(undefined), null);
    assert.equal(normalizeBankName(""), null);
    assert.equal(normalizeBankName(" Al Rajhi "), "Al Rajhi");
    assert.equal(normalizeBankName(5), undefined);
    assert.equal(normalizeBankName("x".repeat(101)), undefined);
    assert.equal(normalizeBankReference(" TRX-2026-001 "), "TRX-2026-001");
    assert.equal(normalizeBankReference("ab"), null);
    assert.equal(normalizeBankReference("ref\r\n"), "ref");
    assert.equal(normalizeBankReference("re\u0007f"), null);
  });

  test("what is owed: PRODUCTION, split, unpaid; summed in halalas", () => {
    assert.deepEqual(payableOrdersWhere("shop_1"), {
      product: { shopId: "shop_1" },
      paymentEnvironment: "PRODUCTION",
      sellerNetAmount: { not: null },
      payoutId: null,
    });
    assert.deepEqual(PAYABLE_ORDERS_WHERE, { paymentEnvironment: "PRODUCTION", sellerNetAmount: { not: null }, payoutId: null });
    const owed = owedFor([{ sellerNetAmount: "46.50" }, { sellerNetAmount: "0.10" }, { sellerNetAmount: "0.20" }, { sellerNetAmount: "x" }]);
    assert.deepEqual(owed, { amount: "46.80", halalas: 4680, orderCount: 3, unreadable: 1 });
  });

  test("a recent bank-detail change is flagged for a week", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    assert.equal(changedRecently(new Date("2026-10-08T12:00:00Z"), now), true);
    assert.equal(changedRecently(new Date("2026-10-01T12:00:00Z"), now), false);
  });
});

/* ------------------------------------------------------------------ */
/* Routes, against an in-memory database                               */
/* ------------------------------------------------------------------ */

type OrderRow = {
  id: string;
  shopId: string;
  paymentEnvironment: "TEST" | "PRODUCTION";
  sellerNetAmount: string | null;
  payoutId: string | null;
  createdAt: Date;
};
type AccountRow = { shopId: string; holderName: string; iban: string; bankName: string | null; updatedById: string; updatedAt: Date };
type PayoutRow = Record<string, unknown> & { id: string; shopId: string };

const db = {
  shops: [] as Array<{ id: string; slug: string; name: string; members: Array<{ userId: string; email: string; role: string }> }>,
  accounts: [] as AccountRow[],
  orders: [] as OrderRow[],
  payouts: [] as PayoutRow[],
};
const state = { session: null as null | { user: { email: string } }, linkShortfall: 0 };
const upserts: unknown[] = [];
const logged: unknown[][] = [];

function payableFor(where: Record<string, unknown>): OrderRow[] {
  const shopId = (where.product as { shopId?: string } | undefined)?.shopId;
  return db.orders.filter(
    (o) =>
      (shopId === undefined || o.shopId === shopId) &&
      o.paymentEnvironment === where.paymentEnvironment &&
      o.sellerNetAmount !== null &&
      o.payoutId === null
  );
}

function makeClient(staged: { payouts: PayoutRow[]; links: Array<[OrderRow, string]> } | null) {
  return {
    shop: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        const shop = db.shops.find((s) => s.slug === where.slug);
        if (!shop) return null;
        return { id: shop.id, shopUsers: shop.members.map((m) => ({ role: m.role, userId: m.userId, user: { email: m.email } })) };
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        db.shops
          .filter((s) => where.id.in.includes(s.id))
          .map((s) => {
            const account = db.accounts.find((a) => a.shopId === s.id);
            return {
              id: s.id,
              name: s.name,
              slug: s.slug,
              payoutAccount: account
                ? { holderName: account.holderName, iban: account.iban, bankName: account.bankName, updatedAt: account.updatedAt }
                : null,
            };
          }),
    },
    sellerPayoutAccount: {
      findUnique: async ({ where }: { where: { shopId: string } }) => db.accounts.find((a) => a.shopId === where.shopId) ?? null,
      upsert: async (args: { where: { shopId: string }; create: AccountRow; update: Partial<AccountRow> }) => {
        upserts.push(args);
        const existing = db.accounts.find((a) => a.shopId === args.where.shopId);
        const row = existing ? Object.assign(existing, args.update, { updatedAt: new Date() }) : { ...args.create, updatedAt: new Date() };
        if (!existing) db.accounts.push(row as AccountRow);
        return row;
      },
    },
    order: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        payableFor(where).map((o) => ({ id: o.id, sellerNetAmount: o.sellerNetAmount, createdAt: o.createdAt, product: { shopId: o.shopId } })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] }; payoutId: null }; data: { payoutId: string } }) => {
        let count = 0;
        for (const order of db.orders) {
          if (where.id.in.includes(order.id) && order.payoutId === null) {
            staged!.links.push([order, data.payoutId]);
            count++;
          }
        }
        return { count: count - state.linkShortfall };
      },
    },
    payout: {
      findMany: async ({ where }: { where: { shopId: string } }) => db.payouts.filter((p) => p.shopId === where.shopId),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `po_${db.payouts.length + staged!.payouts.length + 1}`, ...data } as PayoutRow;
        staged!.payouts.push(row);
        return row;
      },
    },
  };
}

/** A transaction that commits only when its callback returns: a throw leaves the database as it was. */
const prisma = {
  ...makeClient(null),
  $transaction: async <T>(fn: (tx: ReturnType<typeof makeClient>) => Promise<T>) => {
    const staged = { payouts: [] as PayoutRow[], links: [] as Array<[OrderRow, string]> };
    const result = await fn(makeClient(staged));
    db.payouts.push(...staged.payouts);
    for (const [order, payoutId] of staged.links) order.payoutId = payoutId;
    return result;
  },
};

let sellerRoute: typeof import("../app/api/shops/[slug]/payout-account/route.ts");
let adminRoute: typeof import("../app/api/admin/payouts/route.ts");

before(async () => {
  process.env.ADMIN_EMAILS = "founder@example.test";
  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/prisma", { namedExports: { prisma } });
  sellerRoute = await import("../app/api/shops/[slug]/payout-account/route.ts");
  adminRoute = await import("../app/api/admin/payouts/route.ts");
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      logged.push(args);
    };
  }
});

let ip = 0;
function request(method: string, url: string, body?: unknown): Request {
  ip++;
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.0.${Math.floor(ip / 250)}.${ip % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  db.shops = [
    {
      id: "shop_1",
      slug: "planner-co",
      name: "Planner Co",
      members: [
        { userId: "u_owner", email: "Owner@example.test", role: "OWNER" },
        { userId: "u_member", email: "member@example.test", role: "MEMBER" },
      ],
    },
    { id: "shop_2", slug: "other", name: "Other", members: [{ userId: "u_other", email: "other@example.test", role: "OWNER" }] },
  ];
  db.accounts = [];
  db.payouts = [];
  db.orders = [
    { id: "o1", shopId: "shop_1", paymentEnvironment: "PRODUCTION", sellerNetAmount: "46.50", payoutId: null, createdAt: new Date("2026-10-01T10:00:00Z") },
    { id: "o2", shopId: "shop_1", paymentEnvironment: "PRODUCTION", sellerNetAmount: "93.00", payoutId: null, createdAt: new Date("2026-10-02T10:00:00Z") },
    { id: "o3", shopId: "shop_1", paymentEnvironment: "TEST", sellerNetAmount: "93.00", payoutId: null, createdAt: new Date("2026-10-03T10:00:00Z") },
    { id: "o4", shopId: "shop_1", paymentEnvironment: "PRODUCTION", sellerNetAmount: null, payoutId: null, createdAt: new Date("2026-10-04T10:00:00Z") },
    { id: "o5", shopId: "shop_1", paymentEnvironment: "PRODUCTION", sellerNetAmount: "10.00", payoutId: "po_old", createdAt: new Date("2026-09-01T10:00:00Z") },
    { id: "o6", shopId: "shop_2", paymentEnvironment: "PRODUCTION", sellerNetAmount: "20.00", payoutId: null, createdAt: new Date("2026-10-05T10:00:00Z") },
  ];
  state.session = null;
  state.linkShortfall = 0;
  upserts.length = 0;
  logged.length = 0;
});

describe("the shop owner's payout details", () => {
  test("signed out: 401; a member who is not the owner, or a stranger: 403", async () => {
    let res = await sellerRoute.GET(request("GET", "https://saiflow.test/api/shops/planner-co/payout-account"), params("planner-co"));
    assert.equal(res.status, 401);
    for (const email of ["member@example.test", "other@example.test", "founder@example.test"]) {
      state.session = { user: { email } };
      res = await sellerRoute.GET(request("GET", "https://saiflow.test/api/shops/planner-co/payout-account"), params("planner-co"));
      assert.equal(res.status, 403, email);
      res = await sellerRoute.PUT(
        request("PUT", "https://saiflow.test/api/shops/planner-co/payout-account", { holderName: "X Y", iban: IBAN }),
        params("planner-co")
      );
      assert.equal(res.status, 403, email);
    }
    assert.equal(upserts.length, 0);
  });

  test("the owner sees what is owed: PRODUCTION, split, unpaid orders of this shop only", async () => {
    state.session = { user: { email: "owner@example.test" } };
    const res = await sellerRoute.GET(request("GET", "https://saiflow.test/api/shops/planner-co/payout-account"), params("planner-co"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.owed, { amount: "139.50", currency: "SAR", orderCount: 2, unreadable: 0 });
    assert.equal(body.account, null);
  });

  test("an invalid IBAN or name is refused and nothing is saved", async () => {
    state.session = { user: { email: "owner@example.test" } };
    for (const [body, error] of [
      [{ holderName: "Daad Store", iban: "SA0480000000608010167519" }, "invalid_iban"],
      [{ holderName: "Daad Store", iban: "GB82WEST12345698765432" }, "invalid_iban"],
      [{ holderName: "", iban: IBAN }, "invalid_holder_name"],
      [{ holderName: "Daad Store", iban: IBAN, bankName: 7 }, "invalid_bank_name"],
    ] as const) {
      const res = await sellerRoute.PUT(request("PUT", "https://saiflow.test/api/shops/planner-co/payout-account", body), params("planner-co"));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error });
    }
    assert.equal(upserts.length, 0);
  });

  test("the owner saves a valid IBAN; it is stored canonical and never sent back or logged in full", async () => {
    state.session = { user: { email: "owner@example.test" } };
    const res = await sellerRoute.PUT(
      request("PUT", "https://saiflow.test/api/shops/planner-co/payout-account", {
        holderName: " Daad  Store ",
        iban: "sa03 8000 0000 6080 1016 7519",
        bankName: "Al Rajhi",
        shopId: "shop_2",
      }),
      params("planner-co")
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes(IBAN) && !text.includes("608010167519"), "never the full IBAN");
    assert.ok(text.includes("7519"));
    assert.equal(db.accounts.length, 1);
    assert.deepEqual(
      { ...db.accounts[0], updatedAt: undefined },
      { shopId: "shop_1", holderName: "Daad Store", iban: IBAN, bankName: "Al Rajhi", updatedById: "u_owner", updatedAt: undefined },
      "the shop comes from the URL and the owner check, never the body"
    );
    const get = await sellerRoute.GET(request("GET", "https://saiflow.test/api/shops/planner-co/payout-account"), params("planner-co"));
    assert.ok(!(await get.text()).includes(IBAN));
    assert.ok(!JSON.stringify(logged).includes("608010167519"), "bank details never logged");
  });
});

describe("recording a payout (admins only)", () => {
  const owner = () => {
    db.accounts.push({ shopId: "shop_1", holderName: "Daad Store", iban: IBAN, bankName: null, updatedById: "u_owner", updatedAt: new Date("2026-09-01T00:00:00Z") });
  };
  const record = (body: Record<string, unknown>) => adminRoute.POST(request("POST", "https://saiflow.test/api/admin/payouts", body));
  const valid = { shopId: "shop_1", expectedAmount: "139.50", expectedOrderCount: 2, bankReference: "TRX-001", paidAt: "2026-10-08T12:00:00Z" };

  test("a non-admin is refused, even a shop owner", async () => {
    owner();
    for (const session of [null, { user: { email: "owner@example.test" } }]) {
      state.session = session;
      assert.equal((await adminRoute.GET(request("GET", "https://saiflow.test/api/admin/payouts"))).status, 403);
      assert.equal((await record(valid)).status, 403);
    }
    assert.equal(db.payouts.length, 0);
  });

  test("the overview lists each owed shop with the full IBAN for the transfer, and flags a recent change", async () => {
    owner();
    db.accounts.push({ shopId: "shop_2", holderName: "Other", iban: IBAN_B, bankName: null, updatedById: "u_other", updatedAt: new Date() });
    state.session = { user: { email: "Founder@example.test" } };
    const res = await adminRoute.GET(request("GET", "https://saiflow.test/api/admin/payouts"));
    assert.equal(res.status, 200);
    const { shops } = await res.json();
    assert.deepEqual(shops.map((s: { shopId: string }) => s.shopId), ["shop_1", "shop_2"]);
    assert.deepEqual(shops[0].owed, { amount: "139.50", currency: "SAR", orderCount: 2, unreadable: 0 });
    assert.equal(shops[0].account.iban, IBAN);
    assert.equal(shops[0].account.changedRecently, false);
    assert.equal(shops[1].account.changedRecently, true);
  });

  test("a recorded payout covers exactly the owed orders, once", async () => {
    owner();
    state.session = { user: { email: "founder@example.test" } };
    const res = await record(valid);
    assert.equal(res.status, 200);
    const { payout } = await res.json();
    assert.equal(payout.amount, "139.50");
    assert.equal(payout.orderCount, 2);
    assert.equal(db.payouts.length, 1);
    assert.equal(db.payouts[0].ibanLast4, "7519");
    assert.equal(db.payouts[0].recordedBy, "founder@example.test");
    assert.equal(db.payouts[0].bankReference, "TRX-001");
    assert.deepEqual(db.orders.filter((o) => o.payoutId === payout.id).map((o) => o.id), ["o1", "o2"]);
    assert.equal(db.orders.find((o) => o.id === "o3")!.payoutId, null, "a TEST order is never paid out");
    assert.equal(db.orders.find((o) => o.id === "o6")!.payoutId, null, "another shop's order is untouched");

    const again = await record(valid);
    assert.equal(again.status, 409, "nothing is owed any more");
    assert.equal(db.payouts.length, 1);
  });

  test("an amount or order count the admin did not see refuses, and nothing is written", async () => {
    owner();
    state.session = { user: { email: "founder@example.test" } };
    for (const over of [{ expectedAmount: "139.49" }, { expectedOrderCount: 3 }]) {
      const res = await record({ ...valid, ...over });
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.error, "balance_changed");
      assert.deepEqual(body.owed, { amount: "139.50", orderCount: 2 });
    }
    assert.equal(db.payouts.length, 0);
    assert.ok(db.orders.every((o) => o.payoutId === null || o.id === "o5"));
  });

  test("an order paid by a concurrent recording rolls the whole recording back", async () => {
    owner();
    state.session = { user: { email: "founder@example.test" } };
    state.linkShortfall = 1;
    const res = await record(valid);
    assert.equal(res.status, 409);
    assert.equal(db.payouts.length, 0, "no payout row survives");
    assert.ok(db.orders.every((o) => o.payoutId === null || o.id === "o5"), "no order is linked");
  });

  test("no bank details, a bad reference, or a future date: refused", async () => {
    state.session = { user: { email: "founder@example.test" } };
    assert.deepEqual(await (await record(valid)).json(), { error: "no_payout_account" });
    owner();
    assert.equal((await record({ ...valid, bankReference: "x" })).status, 400);
    assert.equal((await record({ ...valid, paidAt: "not a date" })).status, 400);
    assert.equal((await record({ ...valid, paidAt: new Date(Date.now() + 86_400_000).toISOString() })).status, 400);
    assert.equal((await record({ ...valid, expectedAmount: "0" })).status, 400);
    assert.equal((await record({ ...valid, expectedOrderCount: 0 })).status, 400);
    assert.equal(db.payouts.length, 0);
  });

  test("neither route logs an IBAN", async () => {
    owner();
    state.session = { user: { email: "founder@example.test" } };
    await adminRoute.GET(request("GET", "https://saiflow.test/api/admin/payouts"));
    await record(valid);
    assert.ok(!JSON.stringify(logged).includes("608010167519"));
  });
});

describe("the payouts migration only adds", () => {
  test("two new tables, one nullable Order column, and RESTRICT on the payout link", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(resolve(ROOT, "prisma/migrations/20261009120000_seller_payouts/migration.sql"), "utf8");
    const statements = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (const s of statements) {
      assert.ok(!/^(UPDATE|DELETE|TRUNCATE|INSERT|DROP)\b/i.test(s) && !/\bDROP\b|\bRENAME\b/i.test(s), s);
    }
    assert.ok(statements.includes(`ALTER TABLE "Order" ADD COLUMN "payoutId" TEXT`), "nullable: every existing order stays owed as it was");
    assert.ok(
      statements.includes(
        `ALTER TABLE "Order" ADD CONSTRAINT "Order_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE`
      )
    );
    assert.equal(statements.filter((s) => /^CREATE TABLE/.test(s)).length, 2);
    assert.ok(statements.includes(`CREATE UNIQUE INDEX "SellerPayoutAccount_shopId_key" ON "SellerPayoutAccount"("shopId")`), "one account per shop");
  });
});
