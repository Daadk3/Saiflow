/**
 * The buyer's receipt: the address checkout collects, and the email sent to it.
 *
 * - normalizeBuyerEmail is the one rule the checkout page and the checkout
 *   route both apply, so the page never asks for a session the route would
 *   refuse, and the route never stores an address the receipt cannot use.
 * - sendPurchaseEmail sends Arabic and English in one message, escapes the
 *   seller's product name, keeps the subject to one line, and never logs the
 *   buyer's address.
 */
import { test, describe, mock, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MAX_BUYER_EMAIL_LENGTH, normalizeBuyerEmail } from "../lib/checkout/buyer-email.ts";

describe("the receipt address rule", () => {
  test("ordinary addresses are kept, trimmed and lower-cased", () => {
    assert.equal(normalizeBuyerEmail("buyer@example.com"), "buyer@example.com");
    assert.equal(normalizeBuyerEmail("  Buyer.Name+saiflow@Example.CO.sa "), "buyer.name+saiflow@example.co.sa");
    assert.equal(normalizeBuyerEmail("a@b.co"), "a@b.co");
  });

  test("anything that is not one plain address is refused", () => {
    const refused: unknown[] = [
      undefined,
      null,
      42,
      {},
      ["a@b.co"],
      "",
      "   ",
      "buyer",
      "buyer@",
      "@example.com",
      "buyer@example",
      "buyer@example.c",
      "buyer@@example.com",
      "a@b@example.com",
      "buyer @example.com",
      "buyer@exa mple.com",
      "buyer@example..com",
      "buyer@.example.com",
      "buyer@example.com.",
      "<buyer@example.com>",
      "\"buyer\"@example.com",
      "buyer@example.com,other@example.com",
      "buyer@example.com;other@example.com",
      "buyer@example.com\r\nBcc: other@example.com",
      "buyer@example.com\u0000",
      "buyer(comment)@example.com",
    ];
    for (const value of refused) assert.equal(normalizeBuyerEmail(value), null, JSON.stringify(value));
  });

  test("the length limit is the mail standard's", () => {
    const domain = "@example.com";
    const fits = "a".repeat(MAX_BUYER_EMAIL_LENGTH - domain.length) + domain;
    assert.equal(normalizeBuyerEmail(fits), fits);
    assert.equal(normalizeBuyerEmail("a" + fits), null);
  });

  test("the module is client-safe: no server import, no network, no storage", () => {
    const src = readFileSync(new URL("../lib/checkout/buyer-email.ts", import.meta.url), "utf8");
    assert.ok(!/^import\b/m.test(src), "imports nothing");
    for (const forbidden of ["prisma", "fetch(", "process.env", "localStorage", "sessionStorage"]) {
      assert.ok(!src.includes(forbidden), forbidden);
    }
  });
});

type Sent = { from: string; to: string; subject: string; html: string };
const sent: Sent[] = [];
const logged: unknown[][] = [];
const state = { response: { data: { id: "em_1" }, error: null } as unknown, throwOnSend: false };

class FakeResend {
  emails: { send: (message: Sent) => Promise<unknown> };
  constructor() {
    this.emails = {
      send: async (message) => {
        if (state.throwOnSend) throw new Error("ECONNRESET");
        sent.push(message);
        return state.response;
      },
    };
  }
}

let email: typeof import("../lib/email.ts");

before(async () => {
  mock.module("resend", { namedExports: { Resend: FakeResend } });
  email = await import("../lib/email.ts");
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      logged.push(args);
    };
  }
});

beforeEach(() => {
  sent.length = 0;
  logged.length = 0;
  state.response = { data: { id: "em_1" }, error: null };
  state.throwOnSend = false;
});

const DOWNLOAD = "https://saiflow.test/api/download/prod_1?orderId=ord_1";

describe("the purchase receipt", () => {
  test("one email, in Arabic and English, with the download link", async () => {
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Planner", downloadUrl: DOWNLOAD });
    assert.equal(sent.length, 1);
    const [message] = sent;
    assert.equal(message.to, "buyer@example.com");
    assert.equal(message.from, "Saiflow <noreply@saiflow.io>");
    assert.match(message.subject, /إيصال الشراء/);
    assert.match(message.subject, /Your purchase: Planner/);
    assert.match(message.html, /dir="rtl" lang="ar"/);
    assert.match(message.html, /شكرًا لشرائك/);
    assert.match(message.html, /Thank you for your purchase!/);
    assert.ok(message.html.includes(`href="${DOWNLOAD}"`));
  });

  test("the seller's product name cannot add markup to the receipt", async () => {
    const productName = `Guide <img src=x onerror=alert(1)> "quoted" & <a href="https://evil.example">win</a>`;
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName, downloadUrl: DOWNLOAD });
    const { html, subject } = sent[0];
    assert.ok(!html.includes("<img"), "no image");
    assert.ok(!html.includes("evil.example\">"), "no link");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(html.includes("&quot;quoted&quot; &amp;"));
    assert.equal((html.match(/<a\b/g) ?? []).length, 1, "the download button is the only link");
    assert.ok(!/[\r\n]/.test(subject));
  });

  test("a product name cannot break the subject onto a second header line", async () => {
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Kit\r\nBcc: other@example.com", downloadUrl: DOWNLOAD });
    assert.ok(!/[\r\n]/.test(sent[0].subject));
  });

  test("the buyer's address never appears in a log line, whatever happens", async () => {
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Planner", downloadUrl: DOWNLOAD });
    state.response = { data: null, error: { name: "validation_error", message: "buyer@example.com is invalid" } };
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Planner", downloadUrl: DOWNLOAD });
    state.throwOnSend = true;
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Planner", downloadUrl: DOWNLOAD });
    assert.ok(logged.length >= 3);
    assert.ok(!JSON.stringify(logged).includes("buyer@example.com"));
  });

  test("a refusal reported in the result is logged as a failure, not a send", async () => {
    state.response = { data: null, error: { name: "validation_error", message: "x" } };
    await email.sendPurchaseEmail({ customerEmail: "buyer@example.com", productName: "Planner", downloadUrl: DOWNLOAD });
    assert.deepEqual(logged, [["Failed to send purchase email:", "validation_error"]]);
  });
});
