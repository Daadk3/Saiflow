/**
 * Extra deliverables. The primary file stays on Product. An empty extra list
 * is every existing product. One unsafe extra refuses the kit.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extrasAreSafe, extrasCommitWithReopen, escapeHtml, reviewedExtraKeysWhere, sameKeySet, MAX_PRODUCT_FILES } from "@/lib/product-deliverables";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const safe = { fileKey: "k", fileScanStatus: "SAFE" as const, fileScanKey: "k" };

describe("extra deliverables stay fail-closed", () => {
  test("no extras is safe, which is every current single-file product", () => {
    assert.equal(extrasAreSafe(undefined), false);
    assert.equal(extrasAreSafe(null), false);
    assert.equal(extrasAreSafe([]), true);
  });

  test("every extra must be SAFE for its own key", () => {
    assert.equal(extrasAreSafe([safe, { fileKey: "b", fileScanStatus: "SAFE", fileScanKey: "b" }]), true);
    assert.equal(extrasAreSafe([safe, { fileKey: "b", fileScanStatus: "PENDING_SCAN", fileScanKey: null }]), false);
    assert.equal(extrasAreSafe([safe, { fileKey: "b", fileScanStatus: "UNSAFE", fileScanKey: "b" }]), false);
    assert.equal(extrasAreSafe([safe, { fileKey: "b", fileScanStatus: "SAFE", fileScanKey: "old" }]), false);
    assert.equal(extrasAreSafe([{ fileKey: null, fileScanStatus: "SAFE", fileScanKey: null }]), false);
  });

  test("a changed extra set on an approved product reopens in the same commit", () => {
    assert.equal(
      extrasCommitWithReopen({ extrasChanged: true, moderationStatus: "APPROVED", shopActive: true }),
      true
    );
    assert.equal(
      extrasCommitWithReopen({ extrasChanged: true, moderationStatus: "REJECTED", shopActive: true }),
      true
    );
    assert.equal(
      extrasCommitWithReopen({ extrasChanged: true, moderationStatus: "PENDING", shopActive: true }),
      false
    );
    assert.equal(
      extrasCommitWithReopen({ extrasChanged: false, moderationStatus: "APPROVED", shopActive: true }),
      false
    );
    assert.equal(
      extrasCommitWithReopen({ extrasChanged: true, moderationStatus: "APPROVED", shopActive: false }),
      false
    );
  });

  test("replacing the set is detected, and HTML in a file name cannot break the download page", () => {
    assert.equal(sameKeySet(["a", "b"], ["b", "a"]), true);
    assert.equal(sameKeySet(["a"], ["a", "b"]), false);
    assert.equal(escapeHtml(`<a href="x">`), "&lt;a href=&quot;x&quot;&gt;");
    assert.ok(MAX_PRODUCT_FILES >= 2);
  });

  test("gates keep the primary check and also require the extras", () => {
    const download = read("app/api/download/[productId]/route.ts");
    const checkout = read("app/api/checkout/route.ts");
    const moderation = read("app/api/admin/moderation/[productId]/route.ts");
    const scan = read("lib/scan/run.ts");
    assert.ok(download.includes("if (!isDeliverableSafe(product))"));
    assert.ok(download.includes("!Array.isArray(product.deliverables) || !extrasAreSafe(product.deliverables)"));
    assert.ok(read("app/api/products/[id]/route.ts").includes("commitDeliverableChange"));
    assert.ok(read("lib/product-deliverables.ts").includes("FOR UPDATE"));
    assert.ok(read("lib/product-deliverables.ts").includes("The later commit"));
    assert.ok(moderation.includes("{ fileKey: product.fileKey }"));
    assert.ok(moderation.includes("reviewedExtraKeysWhere(product.deliverables.map((row) => row.fileKey))"));
    assert.deepEqual(reviewedExtraKeysWhere(["a"]), { deliverables: { none: { fileKey: { notIn: ["a"] } } } });
    assert.deepEqual(reviewedExtraKeysWhere([]), { deliverables: { none: { fileKey: { notIn: [] } } } });
    assert.ok(download.includes("deliverables:"));
    assert.ok(!download.includes("fileUrl: true"));
    assert.ok(checkout.includes("if (!isDeliverableSafe(product))"));
    assert.ok(checkout.includes("!Array.isArray(product.deliverables) || !extrasAreSafe(product.deliverables)"));
    assert.ok(checkout.includes("deliverables:"));
    assert.ok(moderation.includes('if (action === "APPROVED" && !hosted && !isDeliverableSafe(product))'));
    assert.ok(moderation.includes("extrasAreSafe(product.deliverables)"));
    assert.ok(scan.includes("tx.productDeliverable?.updateMany"));
    assert.ok(scan.includes('p."fileKey" = fa."key"'));
    assert.ok(scan.includes('d."fileKey" = fa."key"'));
    const sql = read("prisma/migrations/20261106120000_product_deliverables/migration.sql");
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "ProductDeliverable"'));
    assert.ok(sql.includes('"fileScanKey" TEXT'));
  });
});
