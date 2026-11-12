/**
 * Deleting a product can never erase what was bought or paid for it.
 *
 * Order.product and PaymentSession.product are ON DELETE RESTRICT, so the
 * database itself refuses to delete a product that any purchase or payment
 * attempt names. That holds however requests interleave: a delete and a
 * checkout racing on the same product meet at the foreign key, and whichever
 * commits second fails instead of erasing or orphaning a row. The checkout
 * side of that race (a refused attempt insert answers 404) is tested in
 * geidea-checkout.
 *
 * BEHAVIOURAL: the DELETE route against a stand-in Prisma. A product with no
 * purchase and no payment attempt is deleted. A product the database refuses
 * to delete (ON DELETE RESTRICT) is taken off sale instead: isActive false,
 * and the orders and payment rows are not touched. STRUCTURAL: the schema
 * relations, the migration text, and the public surfaces that already hide
 * an inactive product. Nothing here runs against a database.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Prisma } from "@prisma/client";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
/** Comments explain the rule; they must never satisfy an assertion. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const MIGRATIONS = "prisma/migrations";
const MIGRATION_DIR = "20261005120000_checkout_attempts_and_payment_record_retention";
const MIGRATION = `${MIGRATIONS}/${MIGRATION_DIR}/migration.sql`;

/** What Prisma throws when the database refuses a delete over a foreign key. */
const refusal = (code: "P2003" | "P2014") =>
  new Prisma.PrismaClientKnownRequestError(
    code === "P2003"
      ? "Foreign key constraint violated on the constraint: `Order_productId_fkey`"
      : "The change you are trying to make would violate the required relation",
    { code, clientVersion: "6.19.0" }
  );

const ops: string[] = [];
const state = {
  session: null as unknown,
  user: null as unknown,
  product: null as unknown,
  deleteError: null as unknown,
};

let DELETE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

before(async () => {
  const models: Record<string, unknown> = {
    product: {
      // file-safety builds a where-clause at load time from this.
      fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
      findUnique: async () => {
        ops.push("product.findUnique");
        return state.product;
      },
      delete: async (args: { where: { id: string } }) => {
        ops.push(`product.delete:${JSON.stringify(args)}`);
        if (state.deleteError !== null) throw state.deleteError;
        return { id: args.where.id };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        ops.push(`product.update:${JSON.stringify(args)}`);
        return { id: args.where.id, ...args.data };
      },
    },
    user: {
      findFirst: async () => {
        ops.push("user.findFirst");
        return state.user;
      },
    },
  };
  // Anything else the route reaches for is recorded: orders, attempts, a
  // transaction, raw SQL. None of it may be touched by a delete.
  const prisma = new Proxy(models, {
    get(target, prop) {
      if (typeof prop === "string" && prop in target) return target[prop];
      ops.push(`touched:${String(prop)}`);
      return undefined;
    },
  });

  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/prisma", { namedExports: { prisma } });

  DELETE = (await import("../app/api/products/[id]/route.ts")).DELETE as typeof DELETE;
});

const productRow = (shopUsers: unknown[] = [{ userId: "user_1", role: "OWNER" }]) => ({
  id: "prod_1",
  name: "My eBook",
  isActive: true,
  moderationStatus: "APPROVED",
  shop: { id: "shop_1", slug: "daad-s-store", shopUsers },
});

beforeEach(() => {
  ops.length = 0;
  state.session = { user: { email: "seller@example.com" } };
  state.user = { id: "user_1", email: "seller@example.com" };
  state.product = productRow();
  state.deleteError = null;
});

async function deleteProduct(id = "prod_1") {
  const response = await DELETE(new Request(`http://localhost/api/products/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const TRIED_DELETE = ["user.findFirst", "product.findUnique", 'product.delete:{"where":{"id":"prod_1"}}'];

describe("the delete route lets the database decide", () => {
  test("a product that a purchase or payment attempt names is taken off sale, and the records stay", async () => {
    for (const code of ["P2003", "P2014"] as const) {
      ops.length = 0;
      state.deleteError = refusal(code);
      const { status, body } = await deleteProduct();
      assert.equal(status, 200, code);
      assert.deepEqual(body, { success: true, removedFromSale: true });
      assert.deepEqual(
        ops,
        [
          ...TRIED_DELETE,
          'product.update:{"where":{"id":"prod_1"},"data":{"isActive":false}}',
        ],
        `${code}: one delete, then isActive false, and nothing else`
      );
    }
  });

  test("a product with no purchase and no attempt is deleted exactly as before", async () => {
    const { status, body } = await deleteProduct();
    assert.equal(status, 200);
    assert.deepEqual(body, { success: true, deleted: true });
    assert.deepEqual(ops, TRIED_DELETE);
  });

  test("any other failure is still a 500, never reported as a payment-record refusal", async () => {
    for (const error of [
      new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "6.19.0" }),
      new Error("socket hang up"),
    ]) {
      state.deleteError = error;
      const { status, body } = await deleteProduct();
      assert.equal(status, 500);
      assert.notEqual(body.error, "has_payment_records");
    }
  });

  test("ownership is checked as before, and nothing is deleted without it", async () => {
    state.session = null;
    assert.equal((await deleteProduct()).status, 401);

    state.session = { user: { email: "seller@example.com" } };
    state.user = null;
    assert.equal((await deleteProduct()).status, 404);

    state.user = { id: "user_1", email: "seller@example.com" };
    state.product = null;
    assert.equal((await deleteProduct()).status, 404);

    state.product = productRow([]);
    assert.equal((await deleteProduct()).status, 403, "a member of another shop");

    state.product = productRow([{ userId: "user_1", role: "MEMBER" }]);
    assert.equal((await deleteProduct()).status, 403, "a shop member who is not the owner");

    state.product = productRow([{ userId: "user_1", role: "ADMIN" }]);
    assert.equal((await deleteProduct()).status, 403, "a shop admin is not the owner");

    assert.ok(!ops.some((op) => op.startsWith("product.delete")), "no delete was attempted");
    assert.ok(!ops.some((op) => op.startsWith("product.update")), "no soft delete was attempted");
  });

  test("a marketplace admin can take down someone else's product", async () => {
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "seller@example.com";
    try {
      state.product = productRow([]);
      state.deleteError = refusal("P2003");
      const { status, body } = await deleteProduct();
      assert.equal(status, 200);
      assert.equal(body.removedFromSale, true);
      assert.ok(ops.some((op) => op.includes('"isActive":false')));
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
  });

  test("no count or lookup of orders or attempts comes first: a check made before the delete could be stale when it runs", async () => {
    state.deleteError = refusal("P2003");
    assert.equal((await deleteProduct()).status, 200);
    assert.equal((await deleteProduct()).body.removedFromSale, true);
    state.deleteError = null;
    assert.equal((await deleteProduct()).status, 200);
    assert.equal((await deleteProduct()).body.deleted, true);
    assert.deepEqual(ops.filter((op) => op.startsWith("touched:")), []);

    const src = read("app/api/products/[id]/route.ts");
    const handler = strip(src.slice(src.indexOf("export async function DELETE")));
    for (const forbidden of ["order", "paymentSession", "count(", "$transaction", "$executeRaw", "$queryRaw", "deleteMany"]) {
      assert.ok(!handler.includes(forbidden), `the delete handler uses ${forbidden}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Structural: the rule lives in the database                          */
/* ------------------------------------------------------------------ */

function modelBlock(schema: string, name: string): string {
  const start = schema.indexOf(`model ${name} {`);
  assert.ok(start >= 0, `model ${name}`);
  return schema.slice(start, schema.indexOf("\n}", start) + 2);
}

/** Every relation field in a model block: name, target and delete rule. */
function relations(block: string): string[] {
  return strip(block)
    .split("\n")
    .filter((line) => line.includes("@relation("))
    .map((line) => {
      const [name, type] = line.trim().split(/\s+/);
      const rule = /onDelete: (\w+)/.exec(line);
      return `${name} ${type} ${rule ? rule[1] : "default"}`;
    });
}

describe("the database refuses the delete, whatever order requests arrive in", () => {
  const schema = read("prisma/schema.prisma");

  test("a purchase and a payment attempt each hold their product with ON DELETE RESTRICT", () => {
    assert.deepEqual(relations(modelBlock(schema, "Order")), [
      "product Product Restrict",
      "paymentSession PaymentSession? SetNull",
      "payout Payout? Restrict",
    ]);
    assert.deepEqual(relations(modelBlock(schema, "PaymentSession")), ["product Product Restrict"]);
  });

  test("the schema's default foreign keys are in force, not Prisma's emulated relations", () => {
    const datasource = strip(schema.slice(schema.indexOf("datasource db {"), schema.indexOf("}", schema.indexOf("datasource db {"))));
    assert.ok(!datasource.includes("relationMode"), "relationMode = prisma would move the rule out of the database");
  });

  test("the commission snapshot lives on the Order row itself, so it is kept with it", () => {
    const order = strip(modelBlock(schema, "Order"));
    for (const field of ["grossAmount", "platformFeeAmount", "sellerNetAmount", "commissionRateBps", "commissionVersion"]) {
      assert.match(order, new RegExp(`\\n\\s+${field}\\s`), field);
    }
  });
});

describe("the migration only adds, and replaces the two delete rules", () => {
  const sql = read(MIGRATION);
  const statements = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);

  test("exactly these statements, in this order", () => {
    assert.deepEqual(statements, [
      `CREATE TYPE "CheckoutPresentation" AS ENUM ('REDIRECT', 'DROPIN')`,
      `ALTER TABLE "Order" DROP CONSTRAINT "Order_productId_fkey"`,
      `ALTER TABLE "PaymentSession" DROP CONSTRAINT "PaymentSession_productId_fkey"`,
      `ALTER TABLE "PaymentSession" ADD COLUMN "clientTokenHash" TEXT, ADD COLUMN "currentAttemptKey" TEXT, ADD COLUMN "presentation" "CheckoutPresentation"`,
      `CREATE UNIQUE INDEX "PaymentSession_currentAttemptKey_key" ON "PaymentSession"("currentAttemptKey")`,
      `ALTER TABLE "Order" ADD CONSTRAINT "Order_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
      `ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    ]);
  });

  test("no row is deleted, rewritten or required to change: new columns are nullable and have no default", () => {
    const code = statements.join(";\n");
    for (const pattern of [/\bDELETE\s+FROM\b/, /\bUPDATE\s+"/, /\bTRUNCATE\b/, /\bDROP (COLUMN|TABLE|INDEX|TYPE)\b/, /\bNOT NULL\b/, /\bDEFAULT\b/, /\bALTER COLUMN\b/]) {
      assert.ok(!pattern.test(code), `the migration matches ${pattern}`);
    }
  });

  test("the new enum in SQL is the schema's, member for member", () => {
    const body = /^enum CheckoutPresentation \{\n([\s\S]*?)^\}/m.exec(read("prisma/schema.prisma"));
    assert.ok(body !== null);
    const members = strip(body[1])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.deepEqual(members, ["REDIRECT", "DROPIN"]);
    assert.equal(statements[0], `CREATE TYPE "CheckoutPresentation" AS ENUM (${members.map((m) => `'${m}'`).join(", ")})`);
  });

  test("migrations after the commission snapshot are the known follow-ups", () => {
    const dirs = readdirSync(resolve(ROOT, MIGRATIONS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const at = dirs.indexOf(MIGRATION_DIR);
    assert.equal(dirs[at - 1], "20260924130000_add_order_commission_snapshot");
    assert.deepEqual(dirs.slice(at + 1), [
      "20261009120000_seller_payouts",
      "20261009180000_schema_objects_missing_from_migrations",
      "20261018120000_founder_test_payments",
      "20261026120000_add_shop_location",
      "20261027120000_add_review_checklist",
      "20261105120000_hosted_access_products",
      "20261106120000_product_deliverables",
      "20261112130000_product_reviews",
    ]);
  });
});

describe("the seller is told what delete does", () => {
  test("the confirm dialog says the product leaves sale and buyers keep their download, in both languages", () => {
    const page = strip(read("app/dashboard/shop/[slug]/page.tsx"));
    assert.match(page, /confirm\(t\("deleteConfirm"\)\)/);
    assert.match(page, /shop\.canRemoveProducts && \(/);
    const shopRoute = strip(read("app/api/shops/[slug]/route.ts"));
    assert.match(shopRoute, /canRemoveProducts/);
    assert.match(shopRoute, /membership\?\.role === "OWNER"/);
    assert.match(shopRoute, /isAdminEmail\(session\.user\.email\)/);
    assert.match(
      page,
      /if \(res\.ok\) \{\s*setShop\([\s\S]*?products: prev\.products\.filter\(\(p\) => p\.id !== productId\),/
    );
    assert.ok(!page.includes("deleteBlocked"), "the old refusal is gone");
    const en = JSON.parse(read("messages/en.json")).dashboard.shop.deleteConfirm as string;
    const ar = JSON.parse(read("messages/ar.json")).dashboard.shop.deleteConfirm as string;
    assert.match(en, /no longer see it/);
    assert.match(en, /keeps their download/);
    assert.match(en, /deleted permanently/);
    assert.match(ar, /[؀-ۿ]/);
    assert.match(ar, /يحتفظ بتنزيله/);
    assert.notEqual(en, ar);
  });
});

describe("a product taken off sale is not for sale, and a paid buyer can still download", () => {
  const PUBLIC = [
    "app/page.tsx",
    "app/browse/page.tsx",
    "app/shop/[slug]/page.tsx",
    "app/shop/[slug]/product/[productSlug]/page.tsx",
    "app/checkout/[slug]/[productSlug]/page.tsx",
    "app/sitemap.ts",
  ];

  test("every public listing uses the shared rule, which requires the product to be active", () => {
    const rule = strip(read("lib/sellable.ts"));
    assert.match(rule, /export const SELLABLE_PRODUCT_WHERE = \{[^}]*isActive: true/s);
    for (const file of PUBLIC) {
      assert.ok(strip(read(file)).includes("SELLABLE_PRODUCT_WHERE"), file);
    }
    const productPage = strip(read("app/shop/[slug]/product/[productSlug]/page.tsx"));
    assert.match(productPage, /if \(!product\) \{\s*notFound\(\);/);
  });

  test("checkout refuses an inactive product before it can start an order", () => {
    const checkout = strip(read("app/api/checkout/route.ts"));
    assert.match(checkout, /const availability = unsellableReason\(product\);/);
    assert.match(checkout, /availability === "inactive"/);
    assert.match(checkout, /not available for purchase/);
  });

  test("the download route never reads isActive, so a paid file still delivers", () => {
    const download = strip(read("app/api/download/[productId]/route.ts"));
    assert.ok(!/\bisActive\b/.test(download), "download must not refuse a product taken off sale");
    assert.match(download, /if \(!isDeliverableSafe\(product\)\)/);
    assert.match(download, /Not authorized to download this product/);
  });

  test("the seller's own list query hides a product taken off sale", () => {
    const shop = strip(read("app/api/shops/[slug]/route.ts"));
    assert.match(shop, /products: \{\s*where: \{ isActive: true \}/);
    assert.match(shop, /filter\(\(p\) => p\.isActive !== false\)/);
  });

  test("editing a product cannot turn isActive back on", () => {
    const src = read("app/api/products/[id]/route.ts");
    const put = strip(src.slice(src.indexOf("export async function PUT"), src.indexOf("export async function DELETE")));
    assert.ok(!/isActive\s*:/.test(put), "the edit handler must not assign isActive");
  });
});
