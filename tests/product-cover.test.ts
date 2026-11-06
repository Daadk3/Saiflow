/**
 * Product detail shows the cover at the file's own ratio.
 * The recommended upload is 1920×1080 (16:9). Grid cards stay 4:3 and contained.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_COVER } from "@/lib/product-cover";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("product cover", () => {
  test("the recommended upload is 1920×1080, which is 16:9", () => {
    assert.equal(PRODUCT_COVER.width, 1920);
    assert.equal(PRODUCT_COVER.height, 1080);
    assert.equal(PRODUCT_COVER.width / PRODUCT_COVER.height, 16 / 9);
    assert.equal(PRODUCT_COVER.ratioLabel, "16:9");
  });

  test("the detail image uses the file ratio: full width, auto height, no crop", () => {
    const image = read("components/ProductCoverImage.tsx");
    assert.ok(image.includes("width={PRODUCT_COVER.width}"));
    assert.ok(image.includes("height={PRODUCT_COVER.height}"));
    assert.ok(image.includes('className="h-auto w-full"'));
    assert.ok(image.includes('height: "auto"'));
    assert.ok(!image.includes("object-cover"));
    assert.ok(!image.includes("fill"));
  });

  test("storefront, admin preview, and seller forms use that image", () => {
    for (const file of [
      "app/shop/[slug]/product/[productSlug]/page.tsx",
      "app/dashboard/admin/products/[id]/preview/page.tsx",
      "app/dashboard/shop/[slug]/add-product/page.tsx",
      "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
    ]) {
      const src = read(file);
      assert.ok(src.includes("ProductCoverImage"), file);
      assert.ok(!src.includes("h-[360px]"), file);
      assert.ok(!src.includes("object-cover object-center"), file);
    }
  });

  test("marketplace cards stay contained in their own frame", () => {
    const card = read("components/ProductThumbnail.tsx");
    assert.ok(card.includes("object-contain object-center"));
    assert.ok(!card.includes("ProductCoverImage"));
  });

  test("Arabic and English help quote 1920×1080 and 16:9", () => {
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    for (const help of [
      en.dashboard.product.thumbnailHelp,
      en.dashboard.product.edit.thumbnailHelp,
      ar.dashboard.product.thumbnailHelp,
      ar.dashboard.product.edit.thumbnailHelp,
    ]) {
      assert.match(help, /1920×1080/);
      assert.match(help, /16:9/);
      assert.ok(!/2000|5:2|4:3/.test(help), help);
    }
  });
});
