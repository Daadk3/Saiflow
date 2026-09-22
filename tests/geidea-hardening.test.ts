/**
 * Pre-preview hardening: the log redaction helper and the checkout limit.
 *
 * Both are exercised for real: `redactId` directly, and the checkout
 * allowance through the real rate-limit module, which is also how this file
 * proves the module's cleanup timer no longer pins a test process.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { redactId } from "../lib/redact-id.ts";
import { rateLimiters } from "../lib/rate-limit.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("redactId", () => {
  test("keeps eight characters of a long identifier", () => {
    assert.equal(redactId("5fde430a-4ed5-4876-9929-11871c32ff8b"), "5fde430a…");
    assert.equal(redactId("cmfx1abcdefghijklmnopqrst"), "cmfx1abc…");
  });

  test("halves a short identifier so a fixture cannot pass through whole", () => {
    assert.equal(redactId("order_1"), "orde…");
    assert.equal(redactId("ps_1"), "ps…");
    assert.equal(redactId("abcdefgh"), "abcd…");
    assert.equal(redactId("a"), "a…");
  });

  test("empty and missing values are empty", () => {
    assert.equal(redactId(""), "");
    assert.equal(redactId(null), "");
    assert.equal(redactId(undefined), "");
  });

  test("never returns its input", () => {
    for (const value of ["a", "ab", "order_1", "5fde430a-4ed5-4876-9929-11871c32ff8b", "x".repeat(100)]) {
      assert.notEqual(redactId(value), value);
      assert.ok(redactId(value).length < value.length + 2);
    }
  });

  test("every payment route logs through it", () => {
    for (const path of [
      "app/api/checkout/route.ts",
      "app/api/webhooks/geidea/route.ts",
      "app/api/download/[productId]/route.ts",
    ]) {
      const src = read(path);
      assert.ok(src.includes('import { redactId } from "@/lib/redact-id";'), path);
    }
    const checkout = read("app/api/checkout/route.ts");
    assert.equal((checkout.match(/ref: redactId\(merchantReferenceId\)/g) ?? []).length, 2);
    assert.ok(!/ref: merchantReferenceId[,\s]/.test(checkout), "no unredacted reference field");
    const callback = read("app/api/webhooks/geidea/route.ts");
    assert.ok(callback.includes("ref: redactId(order.merchantReferenceId)"));
    assert.ok(callback.includes("ref: redactId(session.merchantReferenceId)"));
    assert.ok(callback.includes("order: redactId(result.orderId)"));
    assert.ok(callback.includes("order: redactId(existing.id)"));
    assert.ok(!/ref: (order|session)\.merchantReferenceId/.test(callback));
    const download = read("app/api/download/[productId]/route.ts");
    assert.ok(download.includes("order=${redactId(actualOrderId)}"));
  });
});

describe("the checkout rate limit", () => {
  test("allows fifteen requests per address, refuses the sixteenth, and limits addresses independently", () => {
    for (let i = 0; i < 15; i++) {
      assert.equal(rateLimiters.checkout("198.51.100.1").success, true, `request ${i + 1}`);
    }
    assert.equal(rateLimiters.checkout("198.51.100.1").success, false);
    assert.equal(rateLimiters.checkout("198.51.100.1").remaining, 0);
    assert.equal(rateLimiters.checkout("198.51.100.2").success, true);
  });

  test("is fifteen per ten minutes, and its cleanup timer cannot pin a process", () => {
    const src = read("lib/rate-limit.ts");
    assert.ok(/checkout: \(ip: string\) =>\s*rateLimit\(`checkout:\$\{ip\}`, \{ windowMs: 10 \* 60 \* 1000, maxRequests: 15 \}\)/.test(src));
    assert.ok(src.includes(".unref();"), "the cleanup interval is unref'd");
  });

  test("checkout uses the checkout allowance, not the general one, before the body is read", () => {
    const src = read("app/api/checkout/route.ts");
    const limit = src.indexOf("rateLimiters.checkout(getClientIp(req))");
    const body = src.indexOf("await req.json()");
    const product = src.indexOf("prisma.product.findUnique");
    assert.ok(limit > 0 && body > limit && product > body);
    assert.ok(src.includes('{ error: "Too many requests" }, { status: 429 }'));
  });
});
