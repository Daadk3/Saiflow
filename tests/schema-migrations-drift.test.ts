/**
 * The migrations must build everything the schema describes.
 *
 * A fresh database (a new Preview, a restore) is built from
 * prisma/migrations alone. If schema.prisma names a table, column or unique
 * index that no migration creates, the generated client queries it anyway and
 * every read of that model fails there. User.resetToken was such a column:
 * Production had it, migrations did not, and sign-up failed on the first
 * database built from scratch. Product.category and seven indexes had the
 * same gap.
 *
 * Structural only: this reads the two sources as text. It checks that each
 * name is created somewhere in the migrations (enum values included), not
 * that a column's type, nullability or default matches, nor foreign keys, and
 * it does not notice an object a later migration drops or renames.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const schema = read("prisma/schema.prisma").replace(/\/\/[^\n]*/g, "");
const sql = readdirSync(resolve(ROOT, "prisma/migrations"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((dir) => read(`prisma/migrations/${dir}/migration.sql`).replace(/--[^\n]*/g, ""))
  .join("\n");

const blocks = [...schema.matchAll(/^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(([, kind, name, body]) => ({ kind, name, body }));
const modelNames = new Set(blocks.filter((b) => b.kind === "model").map((b) => b.name));

/** Columns a migration adds, by table: CREATE TABLE bodies and ALTER TABLE … ADD COLUMN. */
function migratedColumns(): Map<string, Set<string>> {
  const columns = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table)!.add(column);
  };
  for (const [, table, body] of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"(\w+)" \(([\s\S]*?)\n\);/g)) {
    for (const [, column] of body.matchAll(/^\s+"(\w+)" /gm)) add(table, column);
  }
  for (const [, table, rest] of sql.matchAll(/ALTER TABLE "(\w+)"\s+([^;]*);/g)) {
    for (const [, column] of rest.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"(\w+)"/g)) add(table, column);
  }
  return columns;
}

describe("every part of the schema has a migration", () => {
  const columns = migratedColumns();
  const models = blocks.filter((b) => b.kind === "model");

  test("the schema parses into models", () => {
    assert.ok(models.length > 10);
    assert.ok(models.some((m) => m.name === "User"));
  });

  for (const model of models) {
    const table = /@@map\("(\w+)"\)/.exec(model.body)?.[1] ?? model.name;

    test(`${table}: the table and each scalar column are created by a migration`, () => {
      assert.ok(columns.has(table), `no migration creates table ${table}`);
      for (const line of model.body.split("\n")) {
        const field = /^\s*(\w+)\s+(\w+)(\[\])?\??(.*)$/.exec(line);
        if (!field || line.trim().startsWith("@@")) continue;
        const [, name, type, , rest] = field;
        if (modelNames.has(type) || /@ignore\b/.test(rest)) continue;
        const column = /@map\("(\w+)"\)/.exec(rest)?.[1] ?? name;
        assert.ok(columns.get(table)!.has(column), `no migration adds ${table}.${column}`);
        if (/@unique\b/.test(rest)) {
          assert.ok(
            new RegExp(`CREATE UNIQUE INDEX (IF NOT EXISTS )?"${table}_${column}_key"`).test(sql),
            `no migration creates the unique index on ${table}.${column}`
          );
        }
      }
    });

    test(`${table}: each @@index and @@unique is created by a migration`, () => {
      for (const [, kind, fields, args] of model.body.matchAll(/^\s*@@(index|unique)\(\[([^\]]*)\]([^)]*)\)/gm)) {
        const columns = fields.split(",").map((f) => f.trim().replace(/\(.*$/, ""));
        const name = /map:\s*"(\w+)"/.exec(args)?.[1] ?? `${table}_${columns.join("_")}_${kind === "unique" ? "key" : "idx"}`;
        assert.match(sql, new RegExp(`CREATE ${kind === "unique" ? "UNIQUE " : ""}INDEX (IF NOT EXISTS )?"${name}"`), `no migration creates ${name}`);
      }
    });
  }

  test("each enum type, and each of its values, is created by a migration", () => {
    for (const { kind, name, body } of blocks) {
      if (kind !== "enum") continue;
      const created = new RegExp(`CREATE TYPE "${name}" AS ENUM \\(([^)]*)\\)`).exec(sql);
      assert.ok(created, `no migration creates enum ${name}`);
      const values = new Set([...created[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
      for (const [, added] of sql.matchAll(new RegExp(`ALTER TYPE "${name}" ADD VALUE (?:IF NOT EXISTS )?'(\\w+)'`, "g"))) values.add(added);
      const declared = body.split("\n").map((line) => line.trim()).filter((line) => /^\w+$/.test(line));
      assert.ok(declared.length > 0, name);
      for (const value of declared) assert.ok(values.has(value), `no migration adds ${name}.${value}`);
    }
  });
});

describe("the catch-up migration only adds, and only if missing", () => {
  const migration = read("prisma/migrations/20261009180000_schema_objects_missing_from_migrations/migration.sql")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  test("three nullable columns and eight indexes, each IF NOT EXISTS, and nothing else", () => {
    assert.deepEqual(migration, [
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetToken" TEXT`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3)`,
      `ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "category" TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "User_resetToken_key" ON "User"("resetToken")`,
      `CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt")`,
      `CREATE INDEX IF NOT EXISTS "Shop_isActive_idx" ON "Shop"("isActive")`,
      `CREATE INDEX IF NOT EXISTS "Shop_createdAt_idx" ON "Shop"("createdAt")`,
      `CREATE INDEX IF NOT EXISTS "Product_slug_idx" ON "Product"("slug")`,
      `CREATE INDEX IF NOT EXISTS "Product_isActive_idx" ON "Product"("isActive")`,
      `CREATE INDEX IF NOT EXISTS "Product_category_idx" ON "Product"("category")`,
      `CREATE INDEX IF NOT EXISTS "Product_createdAt_idx" ON "Product"("createdAt")`,
    ]);
  });
});
