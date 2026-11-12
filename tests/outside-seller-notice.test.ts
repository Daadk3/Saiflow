/**
 * The outside-seller notice is a disclaimer on the pages where someone
 * opens a store or prepares a product. It is not a gate.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldShowOutsideSellerNotice } from "../lib/outside-seller-notice.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const EN =
  "SaiFlow currently sells only its own products. Accounts for outside sellers, whether they have a Saudi bank account or are based abroad, will open soon. You can create your store and prepare your products now, but they won't be published or sold until we open. We'll let you know as soon as we do.";
const AR =
  "تبيع منصة SaiFlow حالياً منتجاتها الخاصة فقط. سيتم فتح حسابات البائعين الخارجيين قريباً، سواء كان لديهم حساب بنكي سعودي أو كانوا خارج المملكة. يمكنك الآن إنشاء متجرك وتجهيز منتجاتك، لكنها لن تُنشر أو تُباع حتى نفتح التسجيل. سنبلغك فور ذلك.";

const PAGES = [
  "app/signup/page.tsx",
  "app/dashboard/create-shop/page.tsx",
  "app/dashboard/shop/[slug]/add-product/page.tsx",
  "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx",
];

describe("who sees the notice", () => {
  test("a signed-out visitor sees it", () => {
    assert.equal(shouldShowOutsideSellerNotice("unauthenticated", undefined), true);
    assert.equal(shouldShowOutsideSellerNotice("unauthenticated", false), true);
  });

  test("an outside seller sees it", () => {
    assert.equal(shouldShowOutsideSellerNotice("authenticated", false), true);
    assert.equal(shouldShowOutsideSellerNotice("authenticated", undefined), true);
    assert.equal(shouldShowOutsideSellerNotice("authenticated", false, false), true);
  });

  test("a signed-in owner of a store with sales on does not see it, including while that check is loading", () => {
    assert.equal(shouldShowOutsideSellerNotice("authenticated", false, true), false);
    assert.equal(shouldShowOutsideSellerNotice("authenticated", undefined, true), false);
    assert.equal(shouldShowOutsideSellerNotice("authenticated", false, null), false);
  });

  test("the founder/admin session does not see it, including while the session is loading", () => {
    assert.equal(shouldShowOutsideSellerNotice("authenticated", true), false);
    assert.equal(shouldShowOutsideSellerNotice("loading", undefined), false);
    assert.equal(shouldShowOutsideSellerNotice("loading", true), false);
  });
});

describe("the words", () => {
  test("English and Arabic are the agreed sentences, and nothing else", () => {
    const en = JSON.parse(read("messages/en.json"));
    const ar = JSON.parse(read("messages/ar.json"));
    assert.deepEqual(Object.keys(en.outsideSeller), ["notice"]);
    assert.deepEqual(Object.keys(ar.outsideSeller), ["notice"]);
    assert.equal(en.outsideSeller.notice, EN);
    assert.equal(ar.outsideSeller.notice, AR);
  });
});

describe("where it is shown, and that it does not block anything", () => {
  test("signup, store creation, product create and product edit render the same notice", () => {
    for (const file of PAGES) {
      const src = read(file);
      assert.ok(src.includes('import { OutsideSellerNotice } from "@/components/OutsideSellerNotice";'), file);
      assert.equal(src.split("<OutsideSellerNotice />").length - 1, 1, file);
    }
  });

  test("the notice is a note, uses the shared copy, and never disables a control", () => {
    const src = read("components/OutsideSellerNotice.tsx");
    assert.ok(src.includes('role="note"'));
    assert.ok(src.includes('useTranslations("outsideSeller")'));
    assert.ok(src.includes("shouldShowOutsideSellerNotice(status, session?.user?.isAdmin, ownership)"));
    assert.ok(src.includes('fetch("/api/shops")'));
    assert.ok(src.includes("text-start"));
    assert.ok(!src.includes("disabled="));
    assert.ok(!src.includes("<button"));
    assert.ok(!src.includes("<input"));
    assert.ok(!src.includes("FOUNDER_BOT_OWNER_EMAIL"));
  });

  test("each page still submits on its own, with the notice outside the decision", () => {
    for (const file of PAGES) {
      const src = read(file);
      assert.ok(src.includes("<form"), file);
      assert.ok(/type="submit"|type='submit'/.test(src), file);
      const notice = src.indexOf("<OutsideSellerNotice />");
      const form = src.indexOf("<form");
      assert.ok(notice > 0 && notice < form, `${file} shows the notice before the form`);
    }
  });
});
