/**
 * The buyer's name, as checkout will store it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MAX_BUYER_NAME_LENGTH, normalizeBuyerName } from "../lib/checkout/buyer-name.ts";

describe("normalizeBuyerName", () => {
  test("keeps an Arabic or English name, trimmed, with its capitals", () => {
    assert.equal(normalizeBuyerName("  نورة   العبدالله "), "نورة العبدالله");
    assert.equal(normalizeBuyerName("Dodo Al-Harbi"), "Dodo Al-Harbi");
    assert.equal(normalizeBuyerName("O'Brien"), "O'Brien");
  });

  test("refuses anything that is not a name", () => {
    for (const value of [undefined, null, "", "   ", "123", "<script>", "a@b.com", "line\nbreak", 42, {}]) {
      assert.equal(normalizeBuyerName(value), null, JSON.stringify(value));
    }
  });

  test("refuses a name longer than the field allows", () => {
    assert.equal(normalizeBuyerName("ن".repeat(MAX_BUYER_NAME_LENGTH + 1)), null);
    assert.equal(normalizeBuyerName("ن".repeat(MAX_BUYER_NAME_LENGTH)), "ن".repeat(MAX_BUYER_NAME_LENGTH));
  });
});
