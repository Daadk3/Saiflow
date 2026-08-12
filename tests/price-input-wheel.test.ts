/**
 * Price inputs must not be changed by scrolling.
 *
 * A focused <input type="number"> changes by one `step` per wheel tick. On the
 * price field that is a silent rewrite of a monetary value with no visual cue —
 * the `no-spinner` styling hides the arrows but not the behaviour. It happened
 * for real: a product entered at 12 SAR was stored as 11.82, eighteen 0.01
 * decrements, and nothing in the system retained the intended figure.
 *
 * `Product.price` is what checkout charges, so this is a financial-correctness
 * guard, not a cosmetic one.
 *
 * Asserted against source text because this suite has no DOM: these are client
 * components, and rendering them would need React plus a document. The property
 * being pinned is narrow enough that reading the JSX is honest — the handler is
 * either on the element or it is not.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const FORMS: [string, string][] = [
  ["add product", "../app/dashboard/shop/[slug]/add-product/page.tsx"],
  ["edit product", "../app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx"],
];

/** The price field's JSX, from `id="price"` to the end of that element. */
function priceInput(source: string): string {
  const start = source.indexOf('id="price"');
  assert.ok(start > 0, "price input not found");
  const end = source.indexOf("/>", start);
  assert.ok(end > start, "price input is not self-closing as expected");
  return source.slice(start, end);
}

for (const [label, path] of FORMS) {
  describe(`${label}: the price field ignores the wheel`, () => {
    const source = read(path);
    const input = priceInput(source);

    test("it is still a number input with decimal steps", () => {
      // The fix must not have been achieved by weakening the field itself.
      assert.ok(input.includes('type="number"'));
      assert.ok(input.includes('step="0.01"'), "decimal prices must remain enterable");
      assert.ok(input.includes('min="0"'));
      assert.ok(input.includes('inputMode="decimal"'));
    });

    test("a wheel event drops focus instead of changing the value", () => {
      assert.ok(
        /onWheel=\{\(e\) => e\.currentTarget\.blur\(\)\}/.test(input),
        "price input must blur on wheel"
      );
    });

    test("keyboard entry is untouched", () => {
      // onChange is what typing uses; the fix must not have replaced it.
      assert.ok(input.includes("onChange={(e) => setPrice(e.target.value)}"));
      assert.ok(!input.includes("readOnly"), "the field must stay editable");
      assert.ok(!input.includes("disabled"), "the field must stay editable");
    });

    test("no price arithmetic was introduced in the form", () => {
      // The server stores exactly what is typed. No commission, VAT or
      // conversion belongs on this path.
      assert.ok(source.includes("price: parseFloat(price)") || source.includes("price: parseFloat(price),"));
      assert.ok(!/price\s*\*\s*[\d.]/.test(source), "no multiplier on price");
      assert.ok(!/\b0\.985\b|\b0\.015\b/.test(source), "no fee rate in the form");
    });
  });
}
