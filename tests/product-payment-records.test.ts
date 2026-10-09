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
 * BEHAVIOURAL: the DELETE route against a stand-in Prisma that throws what
 * Prisma throws for that refusal. STRUCTURAL: the schema relations and the
 * migration text, which nothing here runs against a database.
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

const productRow = (shopUsers: unknown[] = [{ userId: "user_1" }]) => ({
  id: "prod_1",
  name: "My eBook",
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

describe("the delete route lets the database decide, and explains a refusal", () => {
  test("a product that a purchase or payment attempt names is refused with 409, and nothing else is written", async () => {
    for (const code of ["P2003", "P2014"] as const) {
      ops.length = 0;
      state.deleteError = refusal(code);
      const { status, body } = await deleteProduct();
      assert.equal(status, 409, code);
      assert.equal(body.error, "has_payment_records");
      assert.equal(typeof body.message, "string");
      assert.deepEqual(ops, TRIED_DELETE, `${code}: one delete, tried once, and nothing else`);
    }
  });

  test("a product with no purchase and no attempt is deleted exactly as before", async () => {
    const { status, body } = await deleteProduct();
    assert.equal(status, 200);
    assert.deepEqual(body, { success: true });
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

    assert.ok(!ops.some((op) => op.startsWith("product.delete")), "no delete was attempted");
  });

  test("no count or lookup of orders or attempts comes first: a check made before the delete could be stale when it runs", async () => {
    state.deleteError = refusal("P2003");
    assert.equal((await deleteProduct()).status, 409);
    state.deleteError = null;
    assert.equal((await deleteProduct()).status, 200);
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
    assert.deepEqual(relations(modelBlock(schema, "Order")), ["product Product Restrict", "paymentSession PaymentSession? SetNull"]);
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

  test("it is the newest migration, after the commission snapshot", () => {
    const dirs = readdirSync(resolve(ROOT, MIGRATIONS), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.equal(dirs[dirs.length - 1], MIGRATION_DIR);
    assert.equal(dirs[dirs.length - 2], "20260924130000_add_order_commission_snapshot");
  });
});

describe("the seller is told why", () => {
  test("a refused delete keeps the product in the list and explains, in both languages", () => {
    const page = strip(read("app/dashboard/shop/[slug]/page.tsx"));
    assert.match(
      page,
      /if \(res\.ok\) \{\s*setShop\([\s\S]*?products: prev\.products\.filter\(\(p\) => p\.id !== productId\),[\s\S]*?\} else if \(res\.status === 409\) \{\s*alert\(t\("deleteBlocked"\)\);\s*\}/
    );
    const en = JSON.parse(read("messages/en.json")).dashboard.shop.deleteBlocked as string;
    const ar = JSON.parse(read("messages/ar.json")).dashboard.shop.deleteBlocked as string;
    assert.match(en, /sales or payment records/);
    assert.match(ar, /[؀-ۿ]/);
    assert.ok(!/has been deleted|was deleted|تم حذف/.test(en + ar), "it never says the product was deleted");
  });
});
