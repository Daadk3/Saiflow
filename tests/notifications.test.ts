/**
 * Transactional notifications: lib/notify and lib/notification-links.
 *
 * BEHAVIOURAL. The provider SDK and Prisma are replaced, the environment is
 * set per test, and every outcome is observed through what was handed to the
 * SDK and what was logged. Nothing here reaches the network: the SDK stand-in
 * records instead of sending, and the real one is never constructed.
 */

import { test, describe, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

interface Sent {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}
type ProviderError = { name: string; message: string; statusCode?: number } | null;

const sent: Sent[] = [];
const logs: string[] = [];
const state = {
  response: { data: { id: "email_1" } as unknown, error: null as ProviderError },
  throwOnSend: false,
  hangSend: false,
  pending: [] as Array<{
    id: string;
    name: string;
    fileKey?: string | null;
    fileScanKey?: string | null;
    shop: { name: string; slug: string };
  }>,
  findManyArgs: [] as Array<{ where: Record<string, unknown> }>,
  findManyThrows: false,
  product: null as Record<string, unknown> | null,
  findUniqueThrows: false,
};

class FakeResend {
  emails: { send: (message: Sent) => Promise<unknown> };
  constructor(key?: string) {
    if (!key) throw new Error("Missing API key.");
    this.emails = {
      send: async (message) => {
        if (state.throwOnSend) throw new Error("ECONNRESET");
        if (state.hangSend) return new Promise(() => undefined);
        sent.push(message);
        return state.response;
      },
    };
  }
}

let notify: typeof import("../lib/notify.ts");
let links: typeof import("../lib/notification-links.ts");

const ADMIN_LIST = "Founder@example.test, founder@example.test , ops@example.test";
const ORIGIN = "https://preview.saiflow.test";

before(async () => {
  mock.module("resend", { namedExports: { Resend: FakeResend } });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          findMany: async (args: { where: Record<string, unknown> }) => {
            if (state.findManyThrows) throw new Error("db down");
            state.findManyArgs.push(args);
            return state.pending;
          },
          findUnique: async () => {
            if (state.findUniqueThrows) throw new Error("db down");
            return state.product;
          },
        },
      },
    },
  });
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  }
  notify = await import("../lib/notify.ts");
  links = await import("../lib/notification-links.ts");
});

beforeEach(() => {
  sent.length = 0;
  logs.length = 0;
  state.response = { data: { id: "email_1" }, error: null };
  state.throwOnSend = false;
  state.hangSend = false;
  state.pending = [];
  state.findManyArgs = [];
  state.findManyThrows = false;
  state.product = null;
  state.findUniqueThrows = false;
  process.env.RESEND_API_KEY = "re_TEST_NOT_A_REAL_KEY";
  process.env.ADMIN_EMAILS = ADMIN_LIST;
  process.env.NEXTAUTH_URL = ORIGIN;
});

afterEach(() => {
  // The one property every test shares: an address never reaches a log line.
  for (const line of logs) assert.ok(!line.includes("@"), `address in log: ${line}`);
});

const shop = { id: "shop_abcdefghij", name: "متجر داد", slug: "daad-s-store" };

/* ------------------------------------------------------------------ */
/* 1. Links                                                            */
/* ------------------------------------------------------------------ */

describe("links are absolute and point at the deployment that sends them", () => {
  test("NEXTAUTH_URL is the origin when it is a well-formed http(s) URL", () => {
    assert.equal(links.notificationOrigin(), ORIGIN);
    process.env.NEXTAUTH_URL = "https://preview.saiflow.test/some/path/";
    assert.equal(links.notificationOrigin(), ORIGIN, "path and trailing slash are dropped");
    process.env.NEXTAUTH_URL = "http://localhost:3100";
    assert.equal(links.notificationOrigin(), "http://localhost:3100");
  });

  test("anything else falls back to the canonical public origin", () => {
    const { SITE_URL } = JSON.parse(JSON.stringify({ SITE_URL: "https://www.saiflow.io" }));
    process.env.NEXTAUTH_URL = "not a url";
    assert.equal(links.notificationOrigin(), SITE_URL);
    process.env.NEXTAUTH_URL = "ftp://files.example.test";
    assert.equal(links.notificationOrigin(), SITE_URL);
    delete process.env.NEXTAUTH_URL;
    assert.equal(links.notificationOrigin(), SITE_URL);
    process.env.NEXTAUTH_URL = "   ";
    assert.equal(links.notificationOrigin(), SITE_URL);
  });

  test("every dynamic segment is percent-encoded", () => {
    assert.equal(links.adminProductReviewUrl("a b/c?d"), `${ORIGIN}/dashboard/admin/products/a%20b%2Fc%3Fd/preview`);
    assert.equal(links.publicShopUrl("متجر"), `${ORIGIN}/shop/${encodeURIComponent("متجر")}`);
    assert.equal(links.sellerProductEditUrl("s/1", "p#2"), `${ORIGIN}/dashboard/shop/s%2F1/product/p%232/edit`);
    assert.equal(links.moderationQueueUrl(), `${ORIGIN}/dashboard/moderation`);
    assert.equal(links.adminDashboardUrl(), `${ORIGIN}/dashboard/admin`);
    assert.equal(links.sellerSalesUrl(), `${ORIGIN}/dashboard/sales`);
    assert.equal(links.sellerShopUrl("x"), `${ORIGIN}/dashboard/shop/x`);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Sending                                                          */
/* ------------------------------------------------------------------ */

describe("sending", () => {
  test("recipients are trimmed, lower-cased and de-duplicated; the outcome counts them", async () => {
    const outcome = await notify.notifyAdminsStoreCreated(shop);
    assert.deepEqual(outcome, { ok: true, recipients: 2 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["founder@example.test", "ops@example.test"]);
    assert.equal(sent[0].from, notify.NOTIFY_FROM);
  });

  test("Arabic first, English beneath, as HTML and as text", async () => {
    await notify.notifyAdminsStoreCreated(shop);
    const { html, text, subject } = sent[0];
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes('lang="ar" dir="rtl"'));
    assert.ok(html.includes("أنشأ صانع محتوى متجرًا جديدًا"));
    assert.ok(html.includes('<span lang="en" dir="ltr"'));
    assert.ok(html.includes("A creator opened a new store"));
    assert.ok(text.includes("أنشأ صانع محتوى متجرًا جديدًا\nA creator opened a new store"));
    assert.ok(subject.includes(shop.name));
    assert.ok(html.includes(`href="${ORIGIN}/shop/daad-s-store"`), "absolute link in the button");
    assert.ok(text.includes(`${ORIGIN}/shop/daad-s-store`), "absolute link in the text version");
  });

  test("no admin list: a quiet skip, nothing sent", async () => {
    process.env.ADMIN_EMAILS = "";
    assert.deepEqual(await notify.notifyAdminsStoreCreated(shop), { ok: false, reason: "no_recipients" });
    delete process.env.ADMIN_EMAILS;
    assert.deepEqual(await notify.notifyAdminsStoreCreated(shop), { ok: false, reason: "no_recipients" });
    assert.equal(sent.length, 0);
  });

  test("no provider key: a quiet skip, the SDK is never constructed", async () => {
    delete process.env.RESEND_API_KEY;
    assert.deepEqual(await notify.notifyAdminsStoreCreated(shop), { ok: false, reason: "unconfigured" });
    assert.equal(sent.length, 0);
    assert.ok(logs.some((l) => l.includes("event=store_created") && l.includes("outcome=failed:unconfigured")));
  });

  test("an API-level error is an outcome, not an exception, and is logged without addresses", async () => {
    state.response = { data: null, error: { name: "validation_error", message: "Invalid `to`", statusCode: 422 } };
    assert.deepEqual(await notify.notifyAdminsStoreCreated(shop), { ok: false, reason: "provider_error" });
    const line = logs.find((l) => l.includes("outcome=failed:provider_error"));
    assert.ok(line, "the failure is logged");
    assert.ok(line.includes("detail=validation_error:422"));
    assert.ok(line.includes("ref=shop_abc…"), "the id is redacted");
  });

  test("a transport failure is an outcome, not an exception", async () => {
    state.throwOnSend = true;
    assert.deepEqual(await notify.notifyAdminsStoreCreated(shop), { ok: false, reason: "threw" });
    assert.ok(logs.some((l) => l.includes("outcome=failed:threw") && l.includes("detail=Error")));
  });

  test("a hung provider is abandoned after the timeout", async () => {
    state.hangSend = true;
    const outcome = await notify.sendNotification(
      {
        kind: "probe",
        ref: "ref_1",
        to: ["x@example.test"],
        subject: "s",
        heading: { ar: "أ", en: "a" },
        lines: [],
        link: null,
      },
      { timeoutMs: 20 }
    );
    assert.deepEqual(outcome, { ok: false, reason: "timeout" });
  });

  test("people's text is escaped into HTML and cannot break a header", async () => {
    await notify.notifyAdminsStoreCreated({ ...shop, name: `<b>Zooz</b> & "co" 'x'\r\nBcc: someone` });
    const { html, subject, text } = sent[0];
    assert.ok(html.includes("&lt;b&gt;Zooz&lt;/b&gt; &amp; &quot;co&quot; &#39;x&#39;"));
    assert.ok(!html.includes("<b>Zooz</b>"), "raw markup never reaches the HTML");
    assert.ok(!/[\r\n]/.test(subject), "no line break in a header");
    assert.ok(subject.length <= 200);
    assert.ok(text.includes("<b>Zooz</b>"), "the text version is verbatim, it is not HTML");
  });

  test("the address list itself is validated: blanks and non-addresses are dropped", () => {
    assert.deepEqual(notify.uniqueRecipients([" A@x.test ", "a@x.test", "", null, undefined, "no-at-sign", "two words@x.test"]), ["a@x.test"]);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Events                                                           */
/* ------------------------------------------------------------------ */

describe("a product's file is SAFE and it awaits a decision", () => {
  const ready = {
    id: "prod_abcdefghij",
    name: "قالب تخطيط",
    fileKey: "key_1",
    fileScanKey: "key_1",
    shop: { name: "متجر داد", slug: "daad-s-store" },
  };

  test("the founder gets one email per named product, with a direct review link", async () => {
    state.pending = [ready];
    const outcomes = await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij"]);
    assert.deepEqual(outcomes, [{ ok: true, recipients: 2 }]);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["founder@example.test", "ops@example.test"]);
    assert.equal(sent[0].subject, "منتج بانتظار المراجعة: قالب تخطيط");
    assert.ok(sent[0].html.includes(`href="${ORIGIN}/dashboard/admin/products/prod_abcdefghij/preview"`));
    assert.ok(sent[0].text.includes(`${ORIGIN}/dashboard/admin/products/prod_abcdefghij/preview`));
    assert.ok(sent[0].html.includes("متجر داد"));
  });

  test("the rows are re-read at send time: only SAFE products still waiting for a decision", async () => {
    await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij", "prod_abcdefghij", "prod_second"]);
    assert.deepEqual(state.findManyArgs[0].where, {
      id: { in: ["prod_abcdefghij", "prod_second"] },
      moderationStatus: "PENDING",
      fileScanStatus: "SAFE",
    });
  });

  test("a product whose file was replaced since is not announced: SAFE must be SAFE for the current file", async () => {
    state.pending = [{ ...ready, fileKey: "key_2", fileScanKey: "key_1" }, { ...ready, id: "prod_nofile", fileKey: null }];
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij", "prod_nofile"]), [
      { ok: false, reason: "nothing_to_send" },
    ]);
    assert.equal(sent.length, 0);
  });

  test("a bound key narrows the re-check: a product that moved on to another file is left to that file's announcement", async () => {
    state.pending = [{ ...ready, fileKey: "key_2", fileScanKey: "key_2" }];
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij"], "key_1"), [{ ok: false, reason: "nothing_to_send" }]);
    assert.equal(sent.length, 0);
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij"], "key_2"), [{ ok: true, recipients: 2 }]);
    assert.equal(sent.length, 1);
  });

  test("nothing named, or nothing left to announce, sends nothing", async () => {
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview([]), [{ ok: false, reason: "nothing_to_send" }]);
    assert.equal(state.findManyArgs.length, 0, "no lookup for an empty list");
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview(["prod_decided"]), [{ ok: false, reason: "nothing_to_send" }]);
    assert.equal(sent.length, 0);
  });

  test("two waiting products, two emails", async () => {
    state.pending = [ready, { ...ready, id: "prod_second", name: "ثانٍ" }];
    const outcomes = await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij", "prod_second"]);
    assert.equal(outcomes.length, 2);
    assert.equal(sent.length, 2);
    assert.ok(sent[1].html.includes("/dashboard/admin/products/prod_second/preview"));
  });

  test("a database failure is an outcome, not an exception", async () => {
    state.findManyThrows = true;
    assert.deepEqual(await notify.notifyAdminsProductReadyForReview(["prod_abcdefghij"]), [{ ok: false, reason: "threw" }]);
    assert.equal(sent.length, 0);
  });
});

describe("a moderation decision", () => {
  const product = {
    name: "قالب تخطيط",
    slug: "planner",
    shop: {
      name: "متجر داد",
      slug: "daad-s-store",
      shopUsers: [
        { user: { email: "Seller@Example.test" } },
        { user: { email: "seller@example.test" } },
        { user: { email: null } },
        { user: { email: "partner@example.test" } },
      ],
    },
  };

  test("approved: every member of the shop is told, once each, with a link to their dashboard", async () => {
    state.product = product;
    const outcome = await notify.notifyProductModerated({ productId: "prod_abcdefghij", action: "APPROVED", reason: null });
    assert.deepEqual(outcome, { ok: true, recipients: 2 });
    assert.deepEqual(sent[0].to, ["seller@example.test", "partner@example.test"]);
    assert.equal(sent[0].subject, "تمت الموافقة على منتجك: قالب تخطيط");
    assert.ok(sent[0].html.includes(`href="${ORIGIN}/dashboard/shop/daad-s-store"`));
    assert.ok(sent[0].html.includes("يظهر للعامة عندما يكون ملفه قد اجتاز الفحص"), "approval does not promise a live listing");
  });

  test("rejected: the stored reason is included, escaped, with a link to edit the product", async () => {
    state.product = product;
    const outcome = await notify.notifyProductModerated({
      productId: "prod_abcdefghij",
      action: "REJECTED",
      reason: `<script>alert(1)</script> & "quotes"`,
    });
    assert.deepEqual(outcome, { ok: true, recipients: 2 });
    assert.equal(sent[0].subject, "لم تتم الموافقة على منتجك: قالب تخطيط");
    assert.ok(sent[0].html.includes("السبب: &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;"));
    assert.ok(!sent[0].html.includes("<script>"));
    assert.ok(sent[0].html.includes(`href="${ORIGIN}/dashboard/shop/daad-s-store/product/planner/edit"`));
  });

  test("a rejection with no reason still says so, honestly", async () => {
    state.product = product;
    await notify.notifyProductModerated({ productId: "prod_abcdefghij", action: "REJECTED", reason: null });
    assert.ok(sent[0].text.includes("السبب: —"));
  });

  test("no such product, no members, or a database failure: an outcome, never an exception", async () => {
    assert.deepEqual(await notify.notifyProductModerated({ productId: "missing", action: "APPROVED", reason: null }), { ok: false, reason: "nothing_to_send" });
    state.product = { ...product, shop: { ...product.shop, shopUsers: [] } };
    assert.deepEqual(await notify.notifyProductModerated({ productId: "prod_abcdefghij", action: "APPROVED", reason: null }), { ok: false, reason: "no_recipients" });
    state.findUniqueThrows = true;
    assert.deepEqual(await notify.notifyProductModerated({ productId: "prod_abcdefghij", action: "APPROVED", reason: null }), { ok: false, reason: "threw" });
    assert.equal(sent.length, 0);
  });
});

describe("a fulfilled purchase", () => {
  const sale = {
    orderId: "order_abcdefghijklmnop",
    productId: "prod_abcdefghij",
    productName: "قالب تخطيط",
    amount: "25",
    currency: "SAR",
    environment: "TEST",
    at: new Date("2026-09-23T14:30:00Z"),
  };
  const withMembers = {
    shop: {
      name: "متجر داد",
      slug: "daad-s-store",
      shopUsers: [{ user: { email: "seller@example.test" } }],
    },
  };

  test("the seller and the founder are each told once; the amount is the gross sale, marked as a test", async () => {
    state.product = withMembers;
    const outcome = await notify.notifySaleFulfilled(sale);
    assert.deepEqual(outcome, { seller: { ok: true, recipients: 1 }, admins: { ok: true, recipients: 2 } });
    assert.equal(sent.length, 2);
    const [seller, admin] = sent;
    assert.deepEqual(seller.to, ["seller@example.test"]);
    assert.equal(seller.subject, "[اختبار] بيع جديد: قالب تخطيط");
    assert.ok(seller.html.includes("قيمة البيع: 25.00 SAR"));
    assert.ok(seller.html.includes("هذه عملية اختبار وليست إيرادًا فعليًا."));
    assert.ok(seller.html.includes(`href="${ORIGIN}/dashboard/sales"`));
    assert.deepEqual(admin.to, ["founder@example.test", "ops@example.test"]);
    assert.equal(admin.subject, "[اختبار] عملية بيع: قالب تخطيط");
    assert.ok(admin.html.includes("المبلغ: 25.00 SAR"));
    assert.ok(admin.html.includes("المتجر: متجر داد"));
    assert.ok(admin.html.includes(`href="${ORIGIN}/dashboard/admin"`));
  });

  test("the order id is redacted and the bodies carry no address, no bearer and no payload", async () => {
    state.product = withMembers;
    await notify.notifySaleFulfilled(sale);
    for (const message of sent) {
      assert.ok(message.html.includes("order_ab…"), "redacted reference present");
      assert.ok(!message.html.includes(sale.orderId), "full order id absent");
      assert.ok(!message.text.includes(sale.orderId));
      assert.ok(!message.html.includes("@"), "no address in a body");
      for (const word of ["merchantReferenceId", "providerOrderId", "signature", "token", "card"]) {
        assert.ok(!message.html.toLowerCase().includes(word), `${word} in body`);
      }
    }
  });

  test("a production sale carries no test marker", async () => {
    state.product = withMembers;
    await notify.notifySaleFulfilled({ ...sale, environment: "PRODUCTION" });
    for (const message of sent) {
      assert.ok(!message.subject.includes("[اختبار]"));
      assert.ok(!message.html.includes("هذه عملية اختبار"));
    }
  });

  test("a shop with no members still tells the founder", async () => {
    state.product = { shop: { name: "متجر", slug: "s", shopUsers: [] } };
    const outcome = await notify.notifySaleFulfilled(sale);
    assert.deepEqual(outcome.seller, { ok: false, reason: "no_recipients" });
    assert.deepEqual(outcome.admins, { ok: true, recipients: 2 });
    assert.equal(sent.length, 1);
  });

  test("a lookup failure still tells the founder, with the store unknown", async () => {
    state.findUniqueThrows = true;
    const outcome = await notify.notifySaleFulfilled(sale);
    assert.deepEqual(outcome.seller, { ok: false, reason: "no_recipients" });
    assert.deepEqual(outcome.admins, { ok: true, recipients: 2 });
    assert.ok(sent[0].html.includes("المتجر: —"));
  });

  test("a non-numeric amount is shown as given, never as NaN", async () => {
    state.product = withMembers;
    await notify.notifySaleFulfilled({ ...sale, amount: { toString: () => "9.99" } });
    assert.ok(sent[0].html.includes("9.99 SAR"));
    assert.ok(!sent[0].html.includes("NaN"));
  });
});

/* ------------------------------------------------------------------ */
/* 4. The module keeps its promises (structural)                       */
/* ------------------------------------------------------------------ */

describe("the module keeps its promises (structural)", () => {
  const src = read("lib/notify.ts");

  test("no log line ever interpolates a recipient list", () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const call of code.match(/console\.\w+\([^;]*\);/g) ?? []) {
      assert.ok(!/\bto\b|recipients\.|shopUsers|email/.test(call), `log call references addresses: ${call}`);
    }
  });

  test("the sender is the same verified address the receipt and the report use", () => {
    assert.match(src, /export const NOTIFY_FROM = "Saiflow <noreply@saiflow\.io>";/);
    assert.ok(read("lib/email.ts").includes("'Saiflow <noreply@saiflow.io>'"));
  });

  test("nothing here reads the buyer, the payload, a signature or a card", () => {
    for (const word of ["buyerEmail", "customerEmail", "signature", "cardNumber", "GEIDEA_API_PASSWORD", "merchantReferenceId"]) {
      assert.ok(!src.includes(word), `${word} in lib/notify.ts`);
    }
  });
});
