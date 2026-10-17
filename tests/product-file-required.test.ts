/**
 * No product without its deliverable (17 Oct 2026, part 3 item 10).
 *
 * Sellers submitted products with only a cover picture and no file to sell.
 *
 * What must hold:
 * - The routes are the gate: creating a product without a file, saving one
 *   whose file was removed, or editing an older product that never had one,
 *   is refused with `file_required` (behaviour: tests/scan-lifecycle,
 *   tests/store-isolation). Another store's file, or an empty one, is
 *   refused by provenance.
 * - The forms keep Submit/Save disabled until the upload has finished, say
 *   why in both languages, and translate the server's refusal.
 * - The seller's dashboard tells them how to resubmit a product with no file.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { provenanceVerdict } from "../lib/file-safety.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const asset = (over: Record<string, unknown> = {}) => ({
  key: "key_1",
  shopId: "shop_1",
  route: "PRODUCT_FILE" as const,
  size: 2048,
  scanStatus: "PENDING_SCAN" as const,
  scanSha256: null,
  scanAt: null,
  ...over,
});

describe("provenance: the store's own, real upload", () => {
  test("an empty upload is not a product file", () => {
    assert.deepEqual(provenanceVerdict(asset({ size: 0 }) as never, "shop_1"), { ok: false, reason: "empty" });
    assert.equal(provenanceVerdict(asset() as never, "shop_1").ok, true);
  });

  test("another store's file, or a picture uploaded as a cover, is refused", () => {
    assert.deepEqual(provenanceVerdict(asset({ shopId: "shop_2" }) as never, "shop_1"), { ok: false, reason: "wrong_shop" });
    assert.deepEqual(provenanceVerdict(asset({ route: "PRODUCT_THUMBNAIL" }) as never, "shop_1"), { ok: false, reason: "wrong_route" });
    assert.ok(read("lib/file-safety.ts").includes("size: true,"), "the lookup reads the size");
  });
});

describe("the routes refuse a product with no file", () => {
  test("create requires a file after the membership check; save refuses a product left without one", () => {
    const create = read("app/api/products/route.ts");
    const member = create.indexOf("if (!shopUser)");
    const required = create.indexOf("return NextResponse.json(FILE_REQUIRED, { status: 400 });");
    assert.ok(member > 0 && required > member);
    const edit = read("app/api/products/[id]/route.ts");
    assert.ok(edit.includes("const resultingFileKey = nextFileKey !== undefined ? nextFileKey : product.fileKey;"));
    assert.ok(edit.includes("if (!resultingFileKey) {\n      return NextResponse.json(FILE_REQUIRED, { status: 400 });"));
  });
});

describe("the forms and the dashboard", () => {
  test("Submit and Save wait for a finished upload, and say why", () => {
    const add = read("app/dashboard/shop/[slug]/add-product/page.tsx");
    assert.ok(add.includes("disabled={loading || !shopId || !certified || !fileUrl}"));
    const edit = read("app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx");
    assert.ok(edit.includes("disabled={saving || !fileUrl}"));
    for (const src of [add, edit]) {
      assert.ok(src.includes('t("dashboard.product.fileRequired")'));
      assert.ok(src.includes('data.code === "file_required"'));
    }
  });

  test("the words exist in both languages, and the dashboard says how to resubmit", () => {
    for (const locale of ["en", "ar"]) {
      const m = JSON.parse(read(`messages/${locale}.json`));
      assert.ok(m.dashboard.product.fileRequired, locale);
      assert.ok(m.dashboard.shop.uploadFileWarning.length > 20, locale);
    }
    assert.match(JSON.parse(read("messages/en.json")).dashboard.shop.uploadFileWarning, /resubmit/);
  });
});
