/**
 * The personal-name shop URL redirects only after the row has moved.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { legacyShopRedirectPath, LEGACY_SHOP_SLUG, NEUTRAL_SHOP_SLUG } from "../lib/shop-slug.ts";

describe("legacy shop slug redirect", () => {
  test("the slugs are the founder's old public slug and the neutral one", () => {
    assert.equal(LEGACY_SHOP_SLUG, "daad-s-store");
    assert.equal(NEUTRAL_SHOP_SLUG, "sahab-store");
  });

  test("nothing moves while the old row still exists, or the new shop is inactive", () => {
    const path = "/shop/daad-s-store/product/planner";
    assert.equal(legacyShopRedirectPath(path, false, true), null);
    assert.equal(legacyShopRedirectPath(path, true, false), null);
    assert.equal(legacyShopRedirectPath(path, false, false), null);
  });

  test("shop and checkout paths redirect once the old slug is gone and the new shop is active", () => {
    assert.equal(
      legacyShopRedirectPath("/shop/daad-s-store", true, true),
      "/shop/sahab-store",
    );
    assert.equal(
      legacyShopRedirectPath("/shop/daad-s-store/product/planner", true, true),
      "/shop/sahab-store/product/planner",
    );
    assert.equal(
      legacyShopRedirectPath("/checkout/daad-s-store/planner", true, true),
      "/checkout/sahab-store/planner",
    );
  });

  test("other shops are left alone", () => {
    assert.equal(legacyShopRedirectPath("/shop/sahab-store", true, true), null);
    assert.equal(legacyShopRedirectPath("/shop/other/product/daad-s-store", true, true), null);
    assert.equal(legacyShopRedirectPath("/browse", true, true), null);
  });
});
