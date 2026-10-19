/**
 * Security fixes: products and moderation (review of main 4f3a1a0, 2026-10-19).
 *
 * What must hold (behaviour of the edit route's review rules is pinned in
 * tests/attach-ready-notification; this file pins the rest, structurally):
 * - An edit and its return to review are one write; an APPROVED product goes
 *   back to review when its file, name, description or picture changes, in a
 *   suspended shop too; a concurrent admin decision is never overwritten.
 * - The edit route checks name, description and asset URL types and lengths
 *   as creation does, and backfills a legacy file key only when the file is
 *   this shop's own upload.
 * - The product read sent to the edit page carries no storage key or scan data.
 * - Ids from the request body are plain strings; moderation reasons are
 *   bounded text; report email subjects carry no line breaks.
 * - A suspended shop uploads nothing; the public browse page is bounded.
 * - These routes never log a whole error object (it can carry query data).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const edit = strip(read("app/api/products/[id]/route.ts"));

describe("the edit route", () => {
  test("validates what creation validates", () => {
    assert.match(edit, /typeof name !== "string" \|\| name\.trim\(\)\.length < 2 \|\| name\.length > 200/);
    assert.match(edit, /typeof description !== "string" \|\| description\.length > 10000/);
    assert.match(edit, /fileUrl !== null && typeof fileUrl !== "string"/);
    assert.match(edit, /thumbnailUrl !== null && typeof thumbnailUrl !== "string"/);
  });

  test("decides the return to review before writing, and writes both together", () => {
    assert.match(edit, /product\.moderationStatus === "APPROVED" && \(fileChanged \|\| listingChanged\)/);
    assert.match(edit, /product\.moderationStatus === "REJECTED" && product\.shop\.isActive/);
    assert.match(edit, /where: \{ id, moderationStatus: product\.moderationStatus \}/);
    assert.match(edit, /\.\.\.\(reopenFrom \? \{ moderationStatus: "PENDING" as const \} : \{\}\)/);
    assert.match(edit, /reopenFrom \? await prisma\.\$transaction\(\(tx\) => save\(tx\)\) : await save\(prisma\)/);
    assert.match(edit, /\?\.code === "P2025"[\s\S]{0,200}status: 409/);
    // Nothing reopens after the fact any more.
    assert.ok(!/tx\.product\.updateMany\(\{\s*where: \{ id, moderationStatus: reopenFrom \}/.test(edit));
  });

  test("the listing change that matters: file, name, description, picture (not price or category)", () => {
    const block = edit.slice(edit.indexOf("const listingChanged ="), edit.indexOf("const reopenFrom ="));
    assert.match(block, /nextName !== product\.name/);
    assert.match(block, /\(nextDescription \?\? ""\) !== \(product\.description \?\? ""\)/);
    assert.match(block, /nextThumbnail !== product\.thumbnailUrl/);
    assert.ok(!/price|category/.test(block));
  });

  test("a legacy file key is backfilled only when it is this shop's own upload", () => {
    assert.match(edit, /const legacyKey = extractAssetKey\(product\.fileUrl\);/);
    assert.match(edit, /verifyDeliverableProvenance\(legacyKey, product\.shopId\)/);
    assert.match(edit, /nextFileKey = owned\?\.ok \? legacyKey : null;/);
  });

  test("the product read for the edit page selects listing fields only", () => {
    const get = edit.slice(edit.indexOf("export async function GET"), edit.indexOf("export async function PUT"));
    const select = get.slice(get.indexOf("select: {"), get.indexOf("shop: {"));
    for (const field of ["id", "name", "slug", "description", "price", "category", "fileUrl", "thumbnailUrl", "moderationStatus"]) {
      assert.match(select, new RegExp(`\\b${field}: true`), field);
    }
    for (const hidden of ["fileKey", "fileScanKey", "fileScanSha256", "fileScanAttempts", "fileScanAt"]) {
      assert.ok(!select.includes(hidden), hidden);
    }
  });
});

describe("other inputs", () => {
  test("a shop id from the body is a plain string", () => {
    assert.match(strip(read("app/api/products/route.ts")), /typeof shopId !== "string" \|\| shopId\.length > 64/);
  });

  test("a moderation reason is text of at most 2,000 characters", () => {
    assert.match(strip(read("app/api/admin/moderation/[productId]/route.ts")), /typeof reason !== "string" \|\| reason\.length > 2000/);
  });

  test("a report email's subject carries no line breaks, and its failure logs no message", () => {
    const report = strip(read("app/api/products/[id]/report/route.ts"));
    assert.match(report, /subject: subjectSafe\(`\[Report\] \$\{category\} — \$\{product\.name\}`\)/);
    assert.ok(!/emailApiError\.message/.test(report));
    assert.match(strip(read("lib/email.ts")), /export function subjectSafe\(value: string\): string/);
  });

  test("a suspended shop uploads nothing", () => {
    assert.match(strip(read("app/api/uploadthing/core.ts")), /shopId: input\.shopId,[\s\S]{0,200}shop: \{ isActive: true \},/);
  });

  test("the public browse page is bounded", () => {
    assert.match(strip(read("app/browse/page.tsx")), /orderBy,\s*take: 500,/);
  });

  test("these routes log an error's name and code, never the whole object", () => {
    for (const file of [
      "app/api/products/route.ts",
      "app/api/products/[id]/route.ts",
      "app/api/products/[id]/report/route.ts",
      "app/api/shops/route.ts",
      "app/api/shops/[slug]/route.ts",
      "app/api/admin/moderation/route.ts",
      "app/api/admin/moderation/[productId]/route.ts",
      "app/browse/page.tsx",
    ]) {
      assert.ok(!/console\.error\([^)]*,\s*(error|err|e|emailError)\s*\);/.test(strip(read(file))), file);
    }
  });
});
