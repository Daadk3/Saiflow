/**
 * After a decision on a product's admin page, the page must show it.
 *
 * Found on the Preview (commit c85a491): rejecting with a reason saved, but
 * the page kept "Pending" with Approve and Reject live until a manual reload.
 *
 * What must hold:
 * - The route's answer is read once: success closes the dialog; a refusal or
 *   failure leaves it open with the error inside (lib/decision-feedback).
 * - After success the page data is refreshed in a transition, and when that
 *   finishes the page either shows the decision (a confirmation appears) or
 *   is reloaded from the server. It is never left showing the old status.
 * - A rejected product's row in the products list shows its reason, shortened.
 *
 * Behavioural for the functions; structural (reads the source) for the wiring.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DECISION_TOAST_MS, afterDecision, readDecisionResponse } from "../lib/decision-feedback.ts";
import { shortReason } from "../lib/rejection-reasons.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("reading the route's answer", () => {
  test("success", () => {
    assert.deepEqual(readDecisionResponse(true, null), { ok: true });
  });

  test("a refusal keeps its own message, a blocked approval its reason, anything else a generic failure", () => {
    assert.deepEqual(readDecisionResponse(false, { error: "Reason is required" }), { ok: false, error: { text: "Reason is required" } });
    assert.deepEqual(readDecisionResponse(false, { error: "not_approvable", reason: "file_changed" }), {
      ok: false,
      error: { key: "approveBlocked.file_changed" },
    });
    for (const body of [{}, null, "oops", { error: "" }, { error: 42 }, { error: "not_approvable" }]) {
      assert.deepEqual(readDecisionResponse(false, body), { ok: false, error: { key: "failed" } }, JSON.stringify(body));
    }
  });
});

describe("after a decision", () => {
  test("nothing to say before any decision", () => {
    for (const status of ["PENDING", "APPROVED", "REJECTED"] as const) {
      assert.equal(afterDecision(null, status, false), "idle");
      assert.equal(afterDecision(null, status, true), "idle");
    }
  });

  test("waits while the refresh runs", () => {
    assert.equal(afterDecision("REJECTED", "PENDING", true), "waiting");
    assert.equal(afterDecision("APPROVED", "PENDING", true), "waiting");
  });

  test("the reported case: the refresh finished but the page still says Pending, so it reloads", () => {
    assert.equal(afterDecision("REJECTED", "PENDING", false), "reload");
    assert.equal(afterDecision("REJECTED", "APPROVED", false), "reload");
    assert.equal(afterDecision("APPROVED", "PENDING", false), "reload");
  });

  test("the page shows the decision, so the confirmation appears", () => {
    assert.equal(afterDecision("REJECTED", "REJECTED", false), "done");
    assert.equal(afterDecision("APPROVED", "APPROVED", false), "done");
  });

  test("the confirmation is short", () => {
    assert.ok(DECISION_TOAST_MS >= 3000 && DECISION_TOAST_MS <= 8000);
  });
});

describe("the decision buttons", () => {
  const src = strip(read("components/admin/DecisionButtons.tsx"));
  const send = src.slice(src.indexOf("async function send("), src.indexOf("return (", src.indexOf("async function send(")));

  test("a refusal sets the error and returns before the dialog is closed", () => {
    const refusal = send.indexOf("if (!result.ok)");
    const close = send.indexOf("setRejecting(false)");
    assert.ok(refusal > 0 && close > refusal, "the dialog closes only after the success check");
    assert.match(send.slice(refusal, close), /setError\([\s\S]*?\);\s*return;/);
    assert.match(send, /catch \{\s*setError\(t\("failed"\)\);/, "a network failure is shown too");
    assert.doesNotMatch(send.slice(send.indexOf("catch {")), /setRejecting\(false\)/, "and does not close the dialog");
    // The dialog shows the error while it is open.
    assert.match(src, /<RejectDialog[\s\S]*?error=\{rejecting \? error : null\}/);
  });

  test("success refreshes the page in a transition, recording the decision inside it", () => {
    assert.match(src, /const \[refreshing, startRefresh\] = useTransition\(\);/);
    assert.match(send, /startRefresh\(\(\) => \{\s*setDecided\(action\);\s*router\.refresh\(\);\s*\}\);/);
    assert.match(src, /const stage = afterDecision\(decided, status, refreshing\);/);
  });

  test("a refresh that did not bring the decision back reloads the page", () => {
    assert.match(src, /if \(stage === "reload"\) \{\s*console\.warn\([^)]*\);\s*window\.location\.reload\(\);/);
  });

  test("the controls wait for the refresh, and the confirmation is announced", () => {
    assert.match(src, /decide\("APPROVED"\)\}\s*disabled=\{busy \|\| refreshing \|\| approveBlocked !== null\}/);
    assert.match(src, /decide\("REJECTED"\)\}\s*disabled=\{busy \|\| refreshing\}/);
    assert.match(src, /<div ref=\{statusRef\} tabIndex=\{-1\} role="status" aria-live="polite"[^>]*>[\s\S]*?stage === "done" && decided[\s\S]*?t\(`decided\.\$\{decided\}`\)[\s\S]*?<\/div>/);
    assert.match(src, /setTimeout\(\(\) => setDecided\(null\), DECISION_TOAST_MS\)/);
  });

  test("focus stays on the controls after a decision, and Cancel clears a failed rejection's error", () => {
    assert.match(src, /if \(stage !== "done"\) return;\s*statusRef\.current\?\.focus\(\);/);
    assert.match(src, /<div ref=\{statusRef\} tabIndex=\{-1\} role="status"/);
    assert.match(src, /onCancel=\{\(\) => \{\s*setRejecting\(false\);\s*setError\(null\);\s*\}\}/);
  });
});

describe("the rejection reason in the products list", () => {
  test("shortReason collapses whitespace, keeps whole characters and marks a cut", () => {
    assert.equal(shortReason(null), null);
    assert.equal(shortReason("  \n "), null);
    assert.equal(shortReason("Logo sold\n\nas a  template"), "Logo sold as a template");
    const long = "ا".repeat(200);
    const cut = shortReason(long, 120)!;
    assert.equal(Array.from(cut).length, 120);
    assert.ok(cut.endsWith("…"));
    const emoji = "👍".repeat(130);
    assert.ok(Array.from(shortReason(emoji, 120)!).slice(0, -1).every((c) => c === "👍"), "no emoji is split");
    assert.equal(shortReason("x".repeat(120), 120), "x".repeat(120), "exactly the limit is not cut");
  });

  test("only a rejected product whose latest admin decision is the rejection gets one", () => {
    const stats = strip(read("lib/admin-stats.ts"));
    assert.match(stats, /where: ADMIN_DECISION,\s*orderBy: \{ createdAt: "desc" \},\s*take: 1,\s*select: \{ newStatus: true, reason: true \}/);
    assert.match(
      stats,
      /rejectionReason:\s*p\.moderationStatus === "REJECTED" && latest\?\.newStatus === "REJECTED" \? shortReason\(latest\.reason\) : null/
    );
  });

  test("both layouts render it", () => {
    const page = strip(read("app/dashboard/admin/products/page.tsx"));
    assert.equal(page.match(/<RejectionReason reason=\{p\.rejectionReason\} t=\{t\} \/>/g)?.length, 2);
    assert.match(page, /<bdi dir="auto">\{reason\}<\/bdi>/);
  });
});

test("the new messages exist in both languages", () => {
  for (const file of ["messages/en.json", "messages/ar.json"]) {
    const d = JSON.parse(read(file)).admin.directory;
    for (const v of [d.updating, d.decided?.APPROVED, d.decided?.REJECTED, d.rejectionReasonLabel]) {
      assert.equal(typeof v, "string", file);
      assert.ok(v.length > 0, file);
    }
  }
});
