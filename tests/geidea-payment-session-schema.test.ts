/**
 * Geidea payment attempts: the schema layer.
 *
 * Structural tests over `prisma/schema.prisma`, the migration that introduces
 * PaymentSession, and the routes that decide who may download. Prisma's own
 * tooling cannot run in a checkout without dependencies, so the checks that
 * `prisma validate` and `prisma migrate diff` would perform are approximated
 * here: relation targets exist and are unique, every schema column appears in
 * the migration with the right type and default, and the migration is
 * additive from first statement to last.
 *
 * The invariant these tests exist to keep is simple to state: an Order is a
 * confirmed purchase and a PaymentSession never is. Every download today is
 * authorised on an Order row's existence alone, so the tests assert that no
 * authorising code path can see a PaymentSession, that Order gained no
 * "pending" state, and that a Geidea order can be recorded exactly once.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const schema = read("prisma/schema.prisma");
const MIGRATION_DIR = "20260921120000_add_payment_session";
const migration = read(`prisma/migrations/${MIGRATION_DIR}/migration.sql`);

/** Strip block and whole-line comments from a TypeScript source. */
const stripTs = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ------------------------------------------------------------------ */
/* Schema helpers                                                      */
/* ------------------------------------------------------------------ */

/** The body of `model X { ... }` or `enum X { ... }`, comments removed. */
function block(kind: "model" | "enum", name: string): string {
  const match = schema.match(new RegExp(`^${kind} ${name} \\{\\n([\\s\\S]*?)^\\}`, "m"));
  assert.ok(match, `${kind} ${name} must exist`);
  return match[1]
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Field lines of a model body: name, type, attributes. */
function fields(body: string): { name: string; type: string; attrs: string }[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("@@"))
    .map((line) => {
      const [name, type, ...rest] = line.split(/\s+/);
      return { name, type, attrs: rest.join(" ") };
    });
}

function field(body: string, name: string) {
  const found = fields(body).find((f) => f.name === name);
  assert.ok(found, `field ${name} must exist`);
  return found;
}

function enumMembers(name: string): string[] {
  return block("enum", name)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function modelNames(): string[] {
  return [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
}

/* ------------------------------------------------------------------ */
/* Migration helpers                                                   */
/* ------------------------------------------------------------------ */

/** SQL statements, comments removed, whitespace normalised. */
const statements = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.replace(/\s+/g, " ").trim())
  .filter((s) => s.length > 0);

/** Column definitions inside `CREATE TABLE "X" ( ... )`. */
function createTableColumns(table: string): Map<string, string> {
  const stmt = statements.find((s) => s.startsWith(`CREATE TABLE "${table}" (`));
  assert.ok(stmt, `CREATE TABLE "${table}" must exist`);
  const inner = stmt.slice(stmt.indexOf("(") + 1, stmt.lastIndexOf(")"));
  const columns = new Map<string, string>();
  // Split on commas that are not inside parentheses: DECIMAL(10,2) has one.
  for (const part of inner.split(/,(?![^(]*\))/).map((p) => p.trim())) {
    const m = part.match(/^"(\w+)" (.+)$/);
    if (m) columns.set(m[1], m[2]);
  }
  return columns;
}

/** The ADD COLUMN / ALTER COLUMN actions of the one ALTER TABLE "Order" statement. */
function orderAlterActions(): string[] {
  const stmt = statements.filter((s) => /^ALTER TABLE "Order" (ADD COLUMN|ALTER COLUMN)/.test(s));
  assert.equal(stmt.length, 1, "exactly one ALTER TABLE \"Order\" column statement");
  return stmt[0]
    .replace(/^ALTER TABLE "Order" /, "")
    .split(/,(?= ?(?:ADD|ALTER) COLUMN)/)
    .map((a) => a.trim());
}

/* ------------------------------------------------------------------ */
/* PaymentSession is an attempt, not an Order                          */
/* ------------------------------------------------------------------ */

describe("PaymentSession: a payment attempt with everything a callback must be checked against", () => {
  const body = block("model", "PaymentSession");

  test("has the fields an attempt needs", () => {
    const names = fields(body).map((f) => f.name);
    for (const required of [
      "id",
      "merchantReferenceId",
      "provider",
      "providerSessionId",
      "providerOrderId",
      "productId",
      "amount",
      "currency",
      "environment",
      "status",
      "buyerEmail",
      "expiresAt",
      "createdAt",
      "updatedAt",
    ]) {
      assert.ok(names.includes(required), required);
    }
  });

  test("merchantReferenceId is unique: one attempt per reference, one match per callback", () => {
    const f = field(body, "merchantReferenceId");
    assert.equal(f.type, "String");
    assert.ok(f.attrs.includes("@unique"));
  });

  test("provider session and order ids are nullable until the provider names them", () => {
    assert.equal(field(body, "providerSessionId").type, "String?");
    assert.equal(field(body, "providerOrderId").type, "String?");
  });

  test("provider, environment and status use the closed enums, and status starts CREATED", () => {
    assert.equal(field(body, "provider").type, "PaymentProvider");
    assert.equal(field(body, "environment").type, "PaymentEnvironment");
    const status = field(body, "status");
    assert.equal(status.type, "PaymentSessionStatus");
    assert.ok(status.attrs.includes("@default(CREATED)"));
  });

  test("money is stored the way the repository already stores it: DECIMAL(10,2)", () => {
    const amount = field(body, "amount");
    assert.equal(amount.type, "Decimal");
    assert.ok(amount.attrs.includes("@db.Decimal(10, 2)"));
    // The same representation as the two existing money columns.
    assert.ok(field(block("model", "Order"), "price").attrs.includes("@db.Decimal(10, 2)"));
    assert.ok(field(block("model", "Product"), "price").attrs.includes("@db.Decimal(10, 2)"));
    for (const model of ["PaymentSession", "Order"]) {
      assert.ok(
        !fields(block("model", model)).some((f) => /^Float\??$/.test(f.type)),
        `${model} must not store money as a float`
      );
    }
  });

  test("carries nothing that could deliver a file", () => {
    const names = fields(body).map((f) => f.name);
    for (const forbidden of ["fileKey", "fileUrl", "fileScanStatus", "fileScanKey", "downloadUrl"]) {
      assert.ok(!names.includes(forbidden), forbidden);
    }
  });

  test("belongs to a product, and cascades with it exactly as Order does", () => {
    const product = field(body, "product");
    assert.equal(product.type, "Product");
    assert.match(product.attrs, /@relation\(fields: \[productId\], references: \[id\], onDelete: Cascade\)/);
    assert.ok(block("model", "Product").includes("paymentSessions  PaymentSession[]"));
  });

  test("attempts cannot collide on a provider session or a provider order", () => {
    assert.ok(body.includes("@@unique([provider, providerSessionId])"));
    assert.ok(body.includes("@@unique([provider, providerOrderId])"));
  });
});

/* ------------------------------------------------------------------ */
/* The enums                                                           */
/* ------------------------------------------------------------------ */

describe("the payment enums are small and closed", () => {
  test("PaymentProvider names the dormant rail and the new one", () => {
    assert.deepEqual(enumMembers("PaymentProvider"), ["STRIPE", "GEIDEA"]);
  });

  test("PaymentEnvironment distinguishes test money from real money", () => {
    assert.deepEqual(enumMembers("PaymentEnvironment"), ["TEST", "PRODUCTION"]);
  });

  test("PaymentSessionStatus is the documented set, with PAID the only good terminal state", () => {
    assert.deepEqual(enumMembers("PaymentSessionStatus"), [
      "CREATED",
      "SESSION_CREATED",
      "PAID",
      "FAILED",
      "CANCELLED",
      "EXPIRED",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* PaymentSession does not count as an Order                            */
/* ------------------------------------------------------------------ */

describe("PaymentSession does not count as an Order", () => {
  const order = block("model", "Order");

  test("Order gained no status: it has no pending state, so existence still means paid", () => {
    const names = fields(order).map((f) => f.name);
    assert.ok(!names.includes("status"));
    assert.ok(!order.includes("PaymentSessionStatus"));
  });

  test("Order is the only model any revenue or order reader consults", () => {
    for (const path of ["app/api/orders/route.ts", "lib/admin-stats.ts", "app/dashboard/sales/page.tsx"]) {
      const src = stripTs(read(path));
      assert.ok(!/paymentSession/i.test(src), `${path} must not read attempts`);
    }
  });

  test("the link from Order to its attempt is optional and can never delete a purchase", () => {
    const rel = field(order, "paymentSession");
    assert.equal(rel.type, "PaymentSession?");
    assert.match(
      rel.attrs,
      /@relation\(fields: \[merchantReferenceId\], references: \[merchantReferenceId\], onDelete: SetNull\)/
    );
    assert.equal(field(block("model", "PaymentSession"), "order").type, "Order?");
  });
});

/* ------------------------------------------------------------------ */
/* PaymentSession cannot grant a download                               */
/* ------------------------------------------------------------------ */

describe("PaymentSession cannot grant a download", () => {
  const download = stripTs(read("app/api/download/[productId]/route.ts"));

  test("the download route never reads attempts", () => {
    assert.ok(!/paymentSession/i.test(download));
  });

  test("proof of purchase is still an Order row, on both channels, or 403", () => {
    assert.equal((download.match(/prisma\.order\.findUnique\(/g) ?? []).length, 3, "three explicit Order channels, none through attempts");
    assert.ok(!/prisma\.\w+\.(create|update|upsert|delete)/.test(download), "the download route writes nothing");
    assert.match(download, /if \(!order\) \{[\s\S]*?status: 403/);
  });

  test("the safety authority never reads attempts either", () => {
    assert.ok(!/paymentSession/i.test(stripTs(read("lib/file-safety.ts"))));
  });

  test("the download route was left untouched by this change: no Geidea import", () => {
    assert.ok(!download.includes("payments/geidea"));
  });
});

/* ------------------------------------------------------------------ */
/* Idempotent fulfilment                                                */
/* ------------------------------------------------------------------ */

describe("provider order identifiers support idempotent fulfilment", () => {
  const order = block("model", "Order");

  test("Order: one provider order id per provider, one merchant reference per order", () => {
    assert.ok(order.includes("@@unique([paymentProvider, providerOrderId])"));
    const ref = field(order, "merchantReferenceId");
    assert.equal(ref.type, "String?");
    assert.ok(ref.attrs.includes("@unique"));
    assert.equal(field(order, "providerOrderId").type, "String?");
  });

  test("the migration creates the matching unique indexes with Prisma's names", () => {
    for (const expected of [
      'CREATE UNIQUE INDEX "Order_merchantReferenceId_key" ON "Order"("merchantReferenceId")',
      'CREATE UNIQUE INDEX "Order_paymentProvider_providerOrderId_key" ON "Order"("paymentProvider", "providerOrderId")',
      'CREATE UNIQUE INDEX "PaymentSession_merchantReferenceId_key" ON "PaymentSession"("merchantReferenceId")',
      'CREATE UNIQUE INDEX "PaymentSession_provider_providerSessionId_key" ON "PaymentSession"("provider", "providerSessionId")',
      'CREATE UNIQUE INDEX "PaymentSession_provider_providerOrderId_key" ON "PaymentSession"("provider", "providerOrderId")',
    ]) {
      assert.ok(statements.includes(expected), expected);
    }
  });

  test("the Stripe idempotency key is untouched: stripeSessionId stays unique", () => {
    const f = field(order, "stripeSessionId");
    assert.ok(f.attrs.includes("@unique"));
    assert.ok(!statements.some((s) => /DROP INDEX/.test(s)));
  });
});

/* ------------------------------------------------------------------ */
/* Existing Stripe orders remain representable                          */
/* ------------------------------------------------------------------ */

describe("existing Stripe orders remain representable", () => {
  const order = block("model", "Order");

  test("stripeSessionId is kept, now nullable, still unique", () => {
    const f = field(order, "stripeSessionId");
    assert.equal(f.type, "String?");
    assert.ok(f.attrs.includes("@unique"));
    assert.ok(statements.some((s) => s.includes('ALTER COLUMN "stripeSessionId" DROP NOT NULL')));
  });

  test("every new NOT NULL Order column has a default that describes the old rows", () => {
    assert.ok(field(order, "paymentProvider").attrs.includes("@default(STRIPE)"));
    assert.ok(field(order, "paymentEnvironment").attrs.includes("@default(TEST)"));
    assert.ok(field(order, "currency").attrs.includes('@default("SAR")'));

    const actions = orderAlterActions();
    for (const action of actions) {
      if (/NOT NULL/.test(action) && /ADD COLUMN/.test(action)) {
        assert.match(action, /DEFAULT/, `${action} would fail on a populated table`);
      }
    }
  });

  test("the dormant Stripe webhook still writes an Order without knowing the new columns", () => {
    const stripe = stripTs(read("app/api/webhooks/stripe/route.ts"));
    assert.ok(stripe.includes("stripeSessionId: session.id"));
    assert.ok(!stripe.includes("paymentProvider"), "unchanged: it relies on the defaults");
    assert.ok(stripe.includes("where: { stripeSessionId: session.id }"), "its idempotency check still works");
  });

  test("no Stripe row is rewritten: the migration has no UPDATE, DELETE or backfill", () => {
    for (const s of statements) {
      assert.ok(!/^(UPDATE|DELETE|TRUNCATE|INSERT)\b/i.test(s), s);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Test and production records are distinguishable                      */
/* ------------------------------------------------------------------ */

describe("test and production payment records can be distinguished", () => {
  test("both Order and PaymentSession carry the environment", () => {
    assert.equal(field(block("model", "Order"), "paymentEnvironment").type, "PaymentEnvironment");
    assert.equal(field(block("model", "PaymentSession"), "environment").type, "PaymentEnvironment");
  });

  test("the migration creates the enum and both columns", () => {
    assert.ok(statements.includes(`CREATE TYPE "PaymentEnvironment" AS ENUM ('TEST', 'PRODUCTION')`));
    assert.ok(orderAlterActions().includes(`ADD COLUMN "paymentEnvironment" "PaymentEnvironment" NOT NULL DEFAULT 'TEST'`));
    assert.equal(createTableColumns("PaymentSession").get("environment"), `"PaymentEnvironment" NOT NULL`);
  });

  test("an attempt's environment has no default: every attempt must say which account it is against", () => {
    assert.ok(!field(block("model", "PaymentSession"), "environment").attrs.includes("@default"));
  });
});

/* ------------------------------------------------------------------ */
/* The migration matches the schema and is additive                     */
/* ------------------------------------------------------------------ */

describe("the migration is additive and matches the schema", () => {
  test("it is present, and everything after it is additive too", () => {
    // The commission snapshot (add_order_commission_snapshot) followed it;
    // that migration is nullable-only and is checked in commission-ux.
    const dirs = readdirSync(new URL("../prisma/migrations", import.meta.url))
      .filter((d) => /^\d{14}_/.test(d))
      .sort();
    assert.ok(dirs.includes(MIGRATION_DIR));
    for (const later of dirs.slice(dirs.indexOf(MIGRATION_DIR) + 1)) {
      const sql = readFileSync(new URL(`../prisma/migrations/${later}/migration.sql`, import.meta.url), "utf8");
      assert.ok(!/\b(UPDATE|DELETE|TRUNCATE|DROP|NOT NULL)\b/i.test(sql.replace(/--[^\n]*/g, "")), `${later} is not additive`);
    }
  });

  test("every statement is one of the additive kinds", () => {
    const allowed = [
      /^CREATE TYPE "\w+" AS ENUM \(.+\)$/,
      /^CREATE TABLE "\w+" \(.+\)$/,
      /^CREATE (UNIQUE )?INDEX "\w+" ON "\w+"\(.+\)$/,
      /^ALTER TABLE "\w+" ADD CONSTRAINT "\w+" FOREIGN KEY \(.+\) REFERENCES "\w+"\(.+\) ON DELETE (CASCADE|SET NULL) ON UPDATE CASCADE$/,
      /^ALTER TABLE "Order" (ADD COLUMN "\w+" [^,]+, ?)*(ADD COLUMN "\w+" [^,]+|ALTER COLUMN "stripeSessionId" DROP NOT NULL)$/,
    ];
    assert.ok(statements.length >= 12);
    for (const s of statements) {
      assert.ok(allowed.some((re) => re.test(s)), `not an additive statement: ${s}`);
    }
    for (const s of statements) {
      assert.ok(!/DROP (TABLE|COLUMN|TYPE|INDEX|DEFAULT)|SET NOT NULL|RENAME/.test(s), s);
    }
  });

  test("CREATE TABLE PaymentSession has exactly the schema's scalar columns, correctly typed", () => {
    const columns = createTableColumns("PaymentSession");
    const scalars = fields(block("model", "PaymentSession"))
      .filter((f) => !modelNames().includes(f.type.replace(/[?\[\]]/g, "")))
      .map((f) => f.name)
      .sort();
    assert.deepEqual([...columns.keys()].sort(), scalars);

    assert.equal(columns.get("id"), "TEXT NOT NULL");
    assert.equal(columns.get("merchantReferenceId"), "TEXT NOT NULL");
    assert.equal(columns.get("provider"), `"PaymentProvider" NOT NULL`);
    assert.equal(columns.get("providerSessionId"), "TEXT");
    assert.equal(columns.get("providerOrderId"), "TEXT");
    assert.equal(columns.get("amount"), "DECIMAL(10,2) NOT NULL");
    assert.equal(columns.get("currency"), "TEXT NOT NULL");
    assert.equal(columns.get("status"), `"PaymentSessionStatus" NOT NULL DEFAULT 'CREATED'`);
    assert.equal(columns.get("buyerEmail"), "TEXT");
    assert.equal(columns.get("expiresAt"), "TIMESTAMP(3)");
    assert.equal(columns.get("createdAt"), "TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP");
    assert.equal(columns.get("updatedAt"), "TIMESTAMP(3) NOT NULL");
    assert.ok(statements.some((s) => s.includes('CONSTRAINT "PaymentSession_pkey" PRIMARY KEY ("id")')));
  });

  test("ALTER TABLE Order adds exactly the five new columns and relaxes stripeSessionId", () => {
    assert.deepEqual(orderAlterActions().sort(), [
      `ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR'`,
      `ADD COLUMN "merchantReferenceId" TEXT`,
      `ADD COLUMN "paymentEnvironment" "PaymentEnvironment" NOT NULL DEFAULT 'TEST'`,
      `ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE'`,
      `ADD COLUMN "providerOrderId" TEXT`,
      `ALTER COLUMN "stripeSessionId" DROP NOT NULL`,
    ]);
    const before = fields(block("model", "Order")).map((f) => f.name);
    for (const kept of ["id", "productId", "productName", "price", "customerEmail", "stripeSessionId", "createdAt"]) {
      assert.ok(before.includes(kept), `${kept} must survive`);
    }
  });

  test("the enums in SQL are the enums in the schema, member for member", () => {
    for (const name of ["PaymentProvider", "PaymentEnvironment", "PaymentSessionStatus"]) {
      const expected = `CREATE TYPE "${name}" AS ENUM (${enumMembers(name).map((m) => `'${m}'`).join(", ")})`;
      assert.ok(statements.includes(expected), expected);
    }
  });

  test("every @@index in PaymentSession has its CREATE INDEX", () => {
    const body = block("model", "PaymentSession");
    for (const m of body.matchAll(/@@index\(\[(\w+)\]\)/g)) {
      const col = m[1];
      assert.ok(
        statements.includes(`CREATE INDEX "PaymentSession_${col}_idx" ON "PaymentSession"("${col}")`),
        col
      );
    }
  });

  test("foreign keys match the schema's relations, and the referenced unique index comes first", () => {
    const fkProduct = statements.findIndex((s) =>
      s === 'ALTER TABLE "PaymentSession" ADD CONSTRAINT "PaymentSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE'
    );
    const fkOrder = statements.findIndex((s) =>
      s === 'ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantReferenceId_fkey" FOREIGN KEY ("merchantReferenceId") REFERENCES "PaymentSession"("merchantReferenceId") ON DELETE SET NULL ON UPDATE CASCADE'
    );
    const uniqueRef = statements.findIndex((s) =>
      s === 'CREATE UNIQUE INDEX "PaymentSession_merchantReferenceId_key" ON "PaymentSession"("merchantReferenceId")'
    );
    const table = statements.findIndex((s) => s.startsWith('CREATE TABLE "PaymentSession"'));
    assert.ok(fkProduct > table, "product FK after the table exists");
    assert.ok(uniqueRef > table && fkOrder > uniqueRef, "the FK target must be unique before the FK is added");
  });

  test("schema relations point at fields that exist and are unique or ids", () => {
    for (const model of ["Order", "PaymentSession"]) {
      const body = block("model", model);
      const names = fields(body).map((f) => f.name);
      for (const m of body.matchAll(/(\w+)\s+(\w+)\??\s+@relation\(fields: \[(\w+)\], references: \[(\w+)\]/g)) {
        const [, , target, local, remote] = m;
        assert.ok(names.includes(local), `${model}.${local} must exist`);
        const remoteField = field(block("model", target), remote);
        assert.ok(
          /@id|@unique/.test(remoteField.attrs),
          `${target}.${remote} must be @id or @unique to be a relation target`
        );
      }
    }
  });

  test("the schema is still balanced and PaymentSession is defined once", () => {
    assert.equal((schema.match(/\{/g) ?? []).length, (schema.match(/\}/g) ?? []).length);
    assert.equal((schema.match(/^model PaymentSession \{/gm) ?? []).length, 1);
    for (const name of ["PaymentProvider", "PaymentEnvironment", "PaymentSessionStatus"]) {
      assert.equal((schema.match(new RegExp(`^enum ${name} \\{`, "gm")) ?? []).length, 1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Nothing else moved                                                   */
/* ------------------------------------------------------------------ */

describe("the attempt table is written only where a purchase begins", () => {
  test("checkout records attempts behind PRE_LAUNCH_MODE; the success page and buy button never touch them", () => {
    const checkout = stripTs(read("app/api/checkout/route.ts"));
    assert.ok(checkout.includes("env.PRE_LAUNCH_MODE"));
    assert.ok(checkout.includes("paymentSession.create"));
    assert.ok(!checkout.includes("order.create"), "checkout never creates an Order");
    assert.ok(!/paymentSession/i.test(stripTs(read("app/success/page.tsx"))));
    assert.ok(!/paymentSession/i.test(stripTs(read("app/shop/[slug]/product/[productSlug]/BuyButton.tsx"))));
  });

  test("PRE_LAUNCH_MODE still defaults closed", () => {
    const env = stripTs(read("lib/env.ts"));
    assert.ok(/\.default\("true"\)/.test(env));
    assert.ok(/v !== "false"/.test(env));
  });
});
