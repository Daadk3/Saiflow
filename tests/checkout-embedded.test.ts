/**
 * lib/checkout/embedded: what the checkout page checks before it acts.
 *
 * Behavioural and pure. Every value the server hands the page is checked
 * against the one shape it may have; anything else becomes an explanation,
 * never a guess. Which explanations may still offer Geidea's hosted page is
 * the controller's rule, tested in checkout-dropin-controller.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DROPIN_CONTAINER_PREFIX,
  RESUME_WINDOW_MS,
  attemptConflictFrom,
  dropInContainerId,
  identityRequired,
  checkoutPath,
  hasExpired,
  isHostedCheckoutUrl,
  isSuccessPath,
  isTrustedScriptUrl,
  parseDropInSession,
  resumePathFor,
  serializeAttempt,
  startProblemFor,
} from "../lib/checkout/embedded";

const REF = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SESSION_ID = "f1a0f785-7601-4d53-8f43-08dc33d8302c";
const SCRIPT = "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js";

describe("addresses", () => {
  test("the checkout path is SaiFlow's own page, with both slugs encoded", () => {
    assert.equal(checkoutPath("daad-s-store", "planner"), "/checkout/daad-s-store/planner");
    assert.equal(checkoutPath("a/b", "c?d#e"), "/checkout/a%2Fb/c%3Fd%23e");
  });

  test("a container id is the shared prefix plus one mount's token, and always safe as an HTML id", () => {
    assert.equal(DROPIN_CONTAINER_PREFIX, "saiflow-geidea-dropin");
    assert.equal(dropInContainerId("7-3f2a1b6c-9d10"), "saiflow-geidea-dropin-7-3f2a1b6c-9d10");
    assert.equal(dropInContainerId('1-a"b<c>d e/f#g'), "saiflow-geidea-dropin-1-abcdefg", "nothing that could break out of an id");
    assert.equal(dropInContainerId("x".repeat(200)).length, DROPIN_CONTAINER_PREFIX.length + 1 + 64);
    assert.notEqual(dropInContainerId("1-a"), dropInContainerId("2-a"));
  });

  test("Geidea's library: https, that exact path, nothing more", () => {
    assert.equal(isTrustedScriptUrl(SCRIPT), true);
    for (const bad of [
      "http://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js",
      "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.js",
      "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js?v=1",
      "https://www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js#x",
      "https://user:pw@www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js",
      "//www.ksamerchant.geidea.test/hpp/geideaCheckout.min.js",
      "/hpp/geideaCheckout.min.js",
      "javascript:alert(1)",
      "data:text/javascript,alert(1)",
      "",
      null,
      42,
    ]) {
      assert.equal(isTrustedScriptUrl(bad), false, String(bad));
    }
  });

  test("Geidea's hosted page for one session, and nothing else", () => {
    assert.equal(isHostedCheckoutUrl(`https://www.ksamerchant.geidea.test/hpp/checkout/?${SESSION_ID}`), true);
    for (const bad of [
      `http://www.ksamerchant.geidea.test/hpp/checkout/?${SESSION_ID}`,
      `https://www.ksamerchant.geidea.test/hpp/checkout/?${SESSION_ID}&next=https://evil.example`,
      `https://www.ksamerchant.geidea.test/hpp/checkout?${SESSION_ID}`,
      "https://www.ksamerchant.geidea.test/hpp/checkout/?not-a-session",
      "https://evil.example/login",
      "javascript:alert(1)",
      undefined,
    ]) {
      assert.equal(isHostedCheckoutUrl(bad), false, String(bad));
    }
  });

  test("the success path is SaiFlow's own, relative, for one reference", () => {
    assert.equal(isSuccessPath(`/success?ref=${REF}`), true);
    for (const bad of [
      `https://saiflow.test/success?ref=${REF}`,
      `//evil.example/success?ref=${REF}`,
      `/success?ref=${REF}&next=/x`,
      `/success?ref=${REF}#x`,
      "/success?ref=not-a-uuid",
      `/successful?ref=${REF}`,
      `/api/download/x?ref=${REF}`,
      "",
      null,
    ]) {
      assert.equal(isSuccessPath(bad), false, String(bad));
    }
  });
});

describe("the server's drop-in reply", () => {
  const good = () => ({ sessionId: SESSION_ID, scriptUrl: SCRIPT, expiresAt: "2026-09-21T20:02:17.501Z", successPath: `/success?ref=${REF}` });

  test("a well-formed reply is accepted and typed", () => {
    assert.deepEqual(parseDropInSession(good()), {
      sessionId: SESSION_ID,
      scriptUrl: SCRIPT,
      expiresAt: Date.parse("2026-09-21T20:02:17.501Z"),
      successPath: `/success?ref=${REF}`,
    });
    assert.ok(parseDropInSession({ ...good(), extra: "ignored" }));
  });

  test("any field out of shape makes the whole reply unusable", () => {
    const bad: Record<string, unknown>[] = [
      { ...good(), sessionId: "abc" },
      { ...good(), sessionId: undefined },
      { ...good(), scriptUrl: "https://evil.example/x.js" },
      { ...good(), scriptUrl: undefined },
      { ...good(), successPath: "https://evil.example/success" },
      { ...good(), expiresAt: "soon" },
      { ...good(), expiresAt: 1790000000000 },
    ];
    for (const body of bad) assert.equal(parseDropInSession(body), null, JSON.stringify(body));
    for (const body of [null, undefined, "x", [], 1, { url: `https://h.test/hpp/checkout/?${SESSION_ID}` }]) {
      assert.equal(parseDropInSession(body), null);
    }
  });

  test("the expiry is a plain comparison at the boundary", () => {
    assert.equal(hasExpired(1_000, 999), false);
    assert.equal(hasExpired(1_000, 1_000), true);
    assert.equal(hasExpired(1_000, 1_001), true);
  });

  test("a refusal from the checkout route maps to one of five explanations", () => {
    assert.equal(startProblemFor(429), "rate_limited");
    assert.equal(startProblemFor(400), "not_available");
    assert.equal(startProblemFor(404), "not_available");
    assert.equal(startProblemFor(503), "payments_off");
    assert.equal(startProblemFor(428), "cookies", "asked for an identity twice: the cookie is not being kept");
    for (const status of [500, 502, 504, 401, 403]) assert.equal(startProblemFor(status), "service");
  });
});

describe("the route's answer that this browser has just been issued its identity", () => {
  test("is a 428 naming identity_required, and nothing else", () => {
    assert.equal(identityRequired(428, { error: "identity_required" }), true);
    assert.equal(identityRequired(409, { error: "identity_required" }), false);
    assert.equal(identityRequired(200, { error: "identity_required" }), false);
    assert.equal(identityRequired(428, { error: "attempt_pending" }), false);
    for (const body of [null, "identity_required", [], 1, {}]) assert.equal(identityRequired(428, body), false);
  });
});

describe("the server's answer that this browser already has an attempt", () => {
  const PATH = `/success?ref=${REF}`;

  test("paid, or possibly still payable: that attempt's own status page", () => {
    assert.deepEqual(attemptConflictFrom(409, { error: "already_paid", statusPath: PATH }), { kind: "status", statusPath: PATH });
    assert.deepEqual(attemptConflictFrom(409, { error: "attempt_open", statusPath: PATH }), { kind: "status", statusPath: PATH });
  });

  test("still being created: wait, with its status page only when SaiFlow's own path is given", () => {
    assert.deepEqual(attemptConflictFrom(409, { error: "attempt_pending", statusPath: PATH }), { kind: "pending", statusPath: PATH });
    assert.deepEqual(attemptConflictFrom(409, { error: "attempt_pending" }), { kind: "pending", statusPath: null });
    assert.deepEqual(attemptConflictFrom(409, { error: "attempt_pending", statusPath: "https://evil.example/" }), {
      kind: "pending",
      statusPath: null,
    });
  });

  test("a status path that is not SaiFlow's own makes the answer unusable", () => {
    for (const statusPath of [
      `https://evil.example/success?ref=${REF}`,
      `//evil.example/success?ref=${REF}`,
      "/api/download/x",
      "/success?ref=not-a-uuid",
      `/success?ref=${REF}&next=/x`,
      undefined,
      42,
    ]) {
      assert.equal(attemptConflictFrom(409, { error: "attempt_open", statusPath }), null, String(statusPath));
      assert.equal(attemptConflictFrom(409, { error: "already_paid", statusPath }), null, String(statusPath));
    }
  });

  test("anything but a 409 naming a known answer is not about an attempt", () => {
    assert.equal(attemptConflictFrom(200, { error: "attempt_open", statusPath: PATH }), null);
    assert.equal(attemptConflictFrom(400, { error: "attempt_open", statusPath: PATH }), null);
    assert.equal(attemptConflictFrom(503, { error: "attempt_pending" }), null);
    assert.equal(attemptConflictFrom(409, { error: "something_else", statusPath: PATH }), null);
    for (const body of [null, "attempt_open", [], 1]) assert.equal(attemptConflictFrom(409, body), null);
  });
});

describe("returning to the checkout page after an attempt", () => {
  const NOW = 1_800_000_000_000;
  const stored = (over: Record<string, unknown> = {}) =>
    serializeAttempt({ productId: "prod_1", successPath: `/success?ref=${REF}`, startedAt: NOW - 60_000, ...over } as never);

  test("a plain load, or a reload, asks the server whatever was stored, and the server answers with this browser's attempt", () => {
    assert.equal(resumePathFor("", stored(), "prod_1", NOW), null);
    assert.equal(resumePathFor("?", stored(), "prod_1", NOW), null);
  });

  test("arriving with a query string soon after this tab started an attempt goes to that attempt's status", () => {
    assert.equal(resumePathFor("?orderId=abc", stored(), "prod_1", NOW), `/success?ref=${REF}`);
  });

  test("but never for another product, a stale or future-dated attempt, or a corrupted record", () => {
    assert.equal(resumePathFor("?x=1", stored(), "prod_2", NOW), null);
    assert.equal(resumePathFor("?x=1", stored({ startedAt: NOW - RESUME_WINDOW_MS - 1 }), "prod_1", NOW), null);
    assert.equal(resumePathFor("?x=1", stored({ startedAt: NOW + 5_000 }), "prod_1", NOW), null);
    assert.equal(resumePathFor("?x=1", stored({ successPath: "https://evil.example/" }), "prod_1", NOW), null);
    assert.equal(resumePathFor("?x=1", "{not json", "prod_1", NOW), null);
    assert.equal(resumePathFor("?x=1", null, "prod_1", NOW), null);
  });
});
