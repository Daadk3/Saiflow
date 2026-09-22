/**
 * The return flow: the polling helper, exercised with an injected fetch and
 * an injected sleep so every stop condition runs without a timer or a
 * network; then the success page and the translations, structurally.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_ATTEMPTS,
  pollPaymentStatus,
} from "../lib/payments/status-poll.ts";

const REF = "5fde430a-4ed5-4876-9929-11871c32ff8b";

type Answer = { status: number; body?: unknown; throws?: boolean };

function harness(answers: Answer[]) {
  const urls: string[] = [];
  const sleeps: number[] = [];
  const updates: unknown[] = [];
  let i = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal((init as { cache?: string })?.cache, "no-store");
    const answer = answers[Math.min(i, answers.length - 1)];
    i++;
    if (answer.throws) throw new TypeError("fetch failed");
    return new Response(answer.body === undefined ? "" : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { urls, sleeps, updates, fetchImpl, sleep };
}

const processing = { status: 200, body: { status: "processing", productName: "Pack", orderExists: false } };
const DOWNLOAD = `/api/download/prod_1?ref=${REF}`;
const paid = { status: 200, body: { status: "paid", productName: "Pack", orderExists: true, downloadUrl: DOWNLOAD } };

describe("pollPaymentStatus", () => {
  test("polls while processing and settles on paid", async () => {
    const h = harness([processing, processing, paid]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep, intervalMs: 1500, onUpdate: (u) => h.updates.push(u) });
    assert.deepEqual(outcome, { kind: "settled", status: "paid", productName: "Pack", downloadUrl: DOWNLOAD });
    assert.equal(h.urls.length, 3);
    assert.deepEqual(h.sleeps, [1500, 1500], "sleeps only between polls, never after settling");
    assert.deepEqual(h.updates, [{ attempt: 1, productName: "Pack" }, { attempt: 2, productName: "Pack" }]);
  });

  test("settles immediately on failed, cancelled or expired", async () => {
    for (const status of ["failed", "cancelled", "expired"]) {
      const h = harness([{ status: 200, body: { status, productName: "Pack", orderExists: false } }]);
      const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep });
      assert.deepEqual(outcome, { kind: "settled", status, productName: "Pack", downloadUrl: null });
      assert.equal(h.urls.length, 1);
      assert.equal(h.sleeps.length, 0);
    }
  });

  test("gives up after maxAttempts and reports processing", async () => {
    const h = harness([processing]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep, intervalMs: 1000, maxAttempts: 5 });
    assert.deepEqual(outcome, { kind: "processing", productName: "Pack" });
    assert.equal(h.urls.length, 5);
    assert.deepEqual(h.sleeps, [1000, 1000, 1000, 1000]);
  });

  test("the defaults are a conservative interval and a bounded budget", () => {
    assert.ok(DEFAULT_INTERVAL_MS >= 1000 && DEFAULT_INTERVAL_MS <= 2000);
    assert.ok(DEFAULT_MAX_ATTEMPTS * DEFAULT_INTERVAL_MS <= 120_000, "never polls longer than two minutes");
    assert.ok(DEFAULT_MAX_ATTEMPTS * DEFAULT_INTERVAL_MS >= 30_000, "long enough for a late callback");
  });

  test("an unknown or malformed reference stops at once", async () => {
    let h = harness([{ status: 404, body: { error: "unknown_reference" } }]);
    assert.deepEqual(await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep }), { kind: "unknown" });
    assert.equal(h.urls.length, 1);

    h = harness([{ status: 400, body: { error: "malformed" } }]);
    assert.deepEqual(await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep }), { kind: "unknown" });

    h = harness([paid]);
    assert.deepEqual(await pollPaymentStatus({ ref: "not-a-ref", fetchImpl: h.fetchImpl, sleep: h.sleep }), { kind: "unknown" });
    assert.equal(h.urls.length, 0, "an invalid reference is never sent");
  });

  test("transient failures are retried within the budget", async () => {
    const h = harness([{ status: 500 }, { status: 429, body: { error: "too_many_requests" } }, { throws: true, status: 0 }, { status: 200, body: { nonsense: true } }, paid]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep, maxAttempts: 10 });
    assert.deepEqual(outcome, { kind: "settled", status: "paid", productName: "Pack", downloadUrl: DOWNLOAD });
    assert.equal(h.urls.length, 5);
  });

  test("only failures within the whole budget is an error, not processing", async () => {
    const h = harness([{ status: 500 }]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep, maxAttempts: 3 });
    assert.deepEqual(outcome, { kind: "error" });
    assert.equal(h.urls.length, 3);
  });

  test("a body claiming paid with the wrong shape is not trusted", async () => {
    const h = harness([{ status: 200, body: { status: "paid" } }, { status: 200, body: { status: "PAID", productName: "x", orderExists: true } }, paid]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep, maxAttempts: 5 });
    assert.equal(h.urls.length, 3, "the two malformed answers were skipped, not accepted");
    assert.deepEqual(outcome, { kind: "settled", status: "paid", productName: "Pack", downloadUrl: DOWNLOAD });
  });

  test("a download path is kept only when it is SaiFlow's own relative download route", async () => {
    const withPath = async (downloadUrl: unknown) => {
      const h = harness([{ status: 200, body: { status: "paid", productName: "Pack", orderExists: true, downloadUrl } }]);
      return pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep });
    };
    assert.equal(((await withPath(DOWNLOAD)) as { downloadUrl: string | null }).downloadUrl, DOWNLOAD);
    for (const bad of [undefined, null, "", "https://evil.test/api/download/prod_1?ref=" + REF, "//evil.test/x", "/api/download/prod_1", "/api/download/prod_1?ref=" + REF + "&x=1", "/somewhere/else", 42]) {
      assert.equal(((await withPath(bad)) as { downloadUrl: string | null }).downloadUrl, null, String(bad));
    }
  });

  test("a download path on a non-paid answer is dropped", async () => {
    const h = harness([{ status: 200, body: { status: "failed", productName: "Pack", orderExists: false, downloadUrl: DOWNLOAD } }]);
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep });
    assert.deepEqual(outcome, { kind: "settled", status: "failed", productName: "Pack", downloadUrl: null });
  });

  test("abort stops polling", async () => {
    const controller = new AbortController();
    const h = harness([processing]);
    const sleep = async () => {
      controller.abort();
    };
    const outcome = await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep, signal: controller.signal, maxAttempts: 10 });
    assert.deepEqual(outcome, { kind: "aborted" });
    assert.equal(h.urls.length, 1);
  });

  test("only SaiFlow's own status endpoint is ever called, with the reference alone", async () => {
    const h = harness([paid]);
    await pollPaymentStatus({ ref: REF, fetchImpl: h.fetchImpl, sleep: h.sleep });
    assert.deepEqual(h.urls, [`/api/payment-status?ref=${REF}`]);
  });
});

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

describe("the success page", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const page = read("app/success/page.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("reads ref, not the Stripe session id, and polls through the helper", () => {
    assert.ok(page.includes('searchParams.get("ref")'));
    assert.ok(!page.includes("session_id"));
    assert.ok(page.includes("pollPaymentStatus("));
    assert.ok(!/\bfetch\s*\(/.test(page), "no fetch of its own");
  });

  test("never contacts Geidea, never learns an order id, and builds no download address of its own", () => {
    assert.ok(!/geidea/i.test(page));
    assert.ok(!page.includes("/api/download"), "the path comes from the server, never from the page");
    assert.ok(!/orderId|order_id/.test(page));
    assert.ok(!/href=["'`][^"'`]*download/i.test(page), "no literal download href");
  });

  test("shows the download button only in the paid view, and only with the server's path", () => {
    assert.ok(page.includes('outcome.status === "paid"'));
    assert.ok(page.includes('view.kind === "paid" && view.downloadUrl !== null && ('));
    assert.ok(page.includes("href={view.downloadUrl}"));
    assert.equal((page.match(/href=\{view\.downloadUrl\}/g) ?? []).length, 1, "one download anchor");
    assert.ok(page.includes('view.kind === "paid" && view.downloadUrl === null && ('), "a paid view without a path explains itself");
    // The processing, failed, cancelled, expired, timeout, unknown and error
    // views have no download path in their type, so no anchor can render.
    assert.ok(page.includes('{ kind: "failed" | "cancelled" | "expired"; productName: string }'));
    assert.ok(page.includes('{ kind: "paid"; productName: string; downloadUrl: string | null }'));
  });

  test("uses the translation system for every state", () => {
    assert.ok(page.includes('useTranslations("success")'));
    assert.ok(page.includes("t(`${view.kind}Title`)"));
    assert.ok(page.includes("`${view.kind}Body`"));
    assert.ok(!/"Payment (is being confirmed|confirmed|was not completed|was cancelled)/.test(page), "no hard-coded English");
  });

  test("polling is cancelled when the page goes away", () => {
    assert.ok(page.includes("new AbortController()"));
    assert.ok(page.includes("return () => controller.abort();"));
  });

  test("the translations exist in both locales, with the same keys, for every view", () => {
    const en = JSON.parse(read("messages/en.json")).success as Record<string, string>;
    const ar = JSON.parse(read("messages/ar.json")).success as Record<string, string>;
    assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
    for (const kind of ["processing", "paid", "failed", "cancelled", "expired", "timeout", "unknown", "error"]) {
      assert.ok(en[`${kind}Title`] && ar[`${kind}Title`], `${kind}Title`);
      assert.ok(en[`${kind}Body`] && ar[`${kind}Body`], `${kind}Body`);
    }
    for (const key of ["referenceLabel", "helperText", "continueShopping", "suspenseFallback", "downloadCta", "paidNoLink"]) {
      assert.ok(en[key] && ar[key], key);
    }
    assert.equal(en.paidTitle, "Payment confirmed.");
    assert.equal(en.processingTitle, "Payment is being confirmed...");
    assert.equal(en.failedTitle, "Payment was not completed.");
    assert.equal(en.cancelledTitle, "Payment was cancelled.");
    assert.equal(en.expiredTitle, "Payment session expired.");
    for (const key of ["fileReady", "errorNoSession", "errorFailedGet"]) {
      assert.ok(!(key in en), `${key} belongs to the removed Stripe flow`);
    }
  });
});
