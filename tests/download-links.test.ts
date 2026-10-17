/**
 * Receipt links that expire (lib/download-links), the safe return path after
 * sign-in (lib/safe-callback), and the pages a buyer lands on.
 *
 * What must hold:
 * - A link opens exactly one order's file for exactly one product, until it
 *   expires; a changed character, another product, another key or a late
 *   click all fail, and only a genuine link is ever called "expired".
 * - No link is ever signed without a secret.
 * - Sign-in returns only to a path on this site.
 * - The receipt, the expired page and My purchases say the same thing.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECEIPT_LINK_TTL_DAYS,
  receiptDownloadUrl,
  receiptLinkExpiry,
  signReceiptToken,
  verifyReceiptToken,
  withinReceiptWindow,
} from "../lib/download-links.ts";
import { postSignInUrl, safeCallbackPath } from "../lib/safe-callback.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SECRET = "test-only-secret-not-real";
const DAY = 86_400_000;
const issued = new Date("2026-10-17T12:00:00Z");

describe("receipt links", () => {
  test("they last seven days", () => {
    assert.equal(RECEIPT_LINK_TTL_DAYS, 7);
    assert.equal(receiptLinkExpiry(issued).toISOString(), "2026-10-24T12:00:00.000Z");
    assert.equal(withinReceiptWindow(issued, new Date("2026-10-24T12:00:00Z")), true, "the last moment still counts");
    assert.equal(withinReceiptWindow(issued, new Date("2026-10-24T12:00:01Z")), false);
  });

  test("a link opens its own order and product until it expires", () => {
    const token = signReceiptToken({ orderId: "cmorder123", productId: "prod_1", expiresAt: receiptLinkExpiry(issued) }, SECRET);
    assert.deepEqual(verifyReceiptToken(token, "prod_1", SECRET, new Date(issued.getTime() + 6 * DAY)), { ok: true, orderId: "cmorder123" });
    assert.deepEqual(verifyReceiptToken(token, "prod_1", SECRET, new Date(issued.getTime() + 8 * DAY)), { ok: false, reason: "expired" });
  });

  test("anything not signed by this server for this product is refused, and never called expired", () => {
    const old = new Date(issued.getTime() - 30 * DAY);
    const token = signReceiptToken({ orderId: "cmorder123", productId: "prod_1", expiresAt: old }, SECRET);
    const [id, exp, sig] = token.split(".");
    const now = issued;
    assert.deepEqual(verifyReceiptToken(token, "prod_2", SECRET, now), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyReceiptToken(token, "prod_1", "another-secret", now), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyReceiptToken(`cmorder124.${exp}.${sig}`, "prod_1", SECRET, now), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyReceiptToken(`${id}.${Number(exp) + 999999}.${sig}`, "prod_1", SECRET, now), { ok: false, reason: "bad_signature" });
    for (const malformed of ["", "a.b", "a.b.c.d", `${id}.soon.${sig}`, `${id}.${exp}.short`, `bad id.${exp}.${sig}`]) {
      assert.deepEqual(verifyReceiptToken(malformed, "prod_1", SECRET, now), { ok: false, reason: "malformed" }, malformed);
    }
  });

  test("no secret: nothing is signed, and nothing verifies", () => {
    assert.throws(() => signReceiptToken({ orderId: "cmorder123", productId: "prod_1", expiresAt: issued }, undefined));
    assert.throws(() => signReceiptToken({ orderId: "cmorder123", productId: "prod_1", expiresAt: issued }, ""));
    const token = signReceiptToken({ orderId: "cmorder123", productId: "prod_1", expiresAt: issued }, SECRET);
    assert.deepEqual(verifyReceiptToken(token, "prod_1", undefined, issued), { ok: false, reason: "no_secret" });
  });

  test("the receipt's URL carries the token and nothing else", () => {
    const url = new URL(receiptDownloadUrl("https://www.saiflow.io", { orderId: "cmorder123", productId: "prod 1", issuedAt: issued }, SECRET));
    assert.equal(url.pathname, "/api/download/prod%201");
    assert.deepEqual([...url.searchParams.keys()], ["t"]);
    assert.ok(!url.search.includes("orderId"));
    assert.deepEqual(verifyReceiptToken(url.searchParams.get("t")!, "prod 1", SECRET, issued), { ok: true, orderId: "cmorder123" });
  });
});

describe("returning after sign-in", () => {
  test("only a path on this site", () => {
    assert.equal(safeCallbackPath("/dashboard/purchases"), "/dashboard/purchases");
    assert.equal(safeCallbackPath("/dashboard/shop/x?tab=1"), "/dashboard/shop/x?tab=1");
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "dashboard", "/a\u0000b", "/" + "x".repeat(600)]) {
      assert.equal(safeCallbackPath(bad), "/dashboard", JSON.stringify(bad));
    }
  });

  test("after a Google sign-in too: back to a page on this site, never another origin", () => {
    const base = "https://www.saiflow.io";
    assert.equal(postSignInUrl("/dashboard/purchases", base), `${base}/dashboard/purchases`);
    assert.equal(postSignInUrl(`${base}/dashboard/purchases?x=1`, base), `${base}/dashboard/purchases?x=1`);
    for (const away of ["https://evil.example/dashboard", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", "/"]) {
      assert.equal(postSignInUrl(away, base), `${base}/dashboard`, away);
    }
    assert.ok(read("app/api/auth/authOptions.ts").includes("return postSignInUrl(url, baseUrl);"));
  });

  test("the login page uses it for both sign-in methods", () => {
    const login = read("app/login/page.tsx");
    assert.ok(login.includes("router.push(callbackFromLocation())"));
    assert.ok(login.includes('signIn("google", { callbackUrl: callbackFromLocation() })'));
    assert.ok(!login.includes('router.push("/dashboard")'));
  });
});

describe("what the buyer is told", () => {
  test("the receipt says how long the link works and where to go after", () => {
    const email = read("lib/email.ts");
    assert.ok(email.includes("${RECEIPT_LINK_TTL_DAYS}"));
    assert.ok(email.includes("مشترياتي") && email.includes("My purchases"));
    assert.ok(!email.includes("at any time"), "the old promise is gone");
  });

  test("My purchases is server-rendered, signed-in only, and lists by the buyer's address", () => {
    const page = read("app/dashboard/purchases/page.tsx");
    assert.ok(!page.includes('"use client"'));
    assert.ok(page.includes("getServerSession(authOptions)"));
    assert.ok(page.includes('redirect("/login?callbackUrl=/dashboard/purchases")'));
    assert.ok(page.includes('customerEmail: { equals: email, mode: "insensitive" }'));
    assert.ok(page.includes("?purchase="));
    assert.ok(!/fileUrl|fileKey/.test(page), "lists only; the download route decides");
  });

  test("both new pages have their words in both languages", () => {
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    for (const ns of ["purchases", "downloadExpired"]) {
      assert.deepEqual(Object.keys(en[ns]).sort(), Object.keys(ar[ns]).sort(), ns);
    }
    assert.ok(en.dashboard.viewPurchases && ar.dashboard.viewPurchases);
    assert.ok(read("app/download/expired/page.tsx").includes("/login?callbackUrl=/dashboard/purchases"));
  });
});
