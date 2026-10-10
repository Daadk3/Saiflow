/**
 * lib/checkout/attempt: one current attempt per browser and product.
 *
 * Behaviour, with no database and no Geidea. `decide` is pure: every rule
 * that keeps a second payable session from starting is driven here with
 * the exact attempt rows the checkout route would read. `releaseArgs` is the
 * one statement that may release an attempt; its predicate is checked here
 * against rows in every state, the way the database would evaluate it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CHECKOUT_COOKIE,
  PENDING_WINDOW_MS,
  SESSION_CREATE_FAILED,
  SUPERSEDED_BEFORE_SESSION,
  attemptKey,
  bearerCookie,
  bearerHash,
  decide,
  newBearer,
  readBearer,
  releaseArgs,
  type CurrentAttempt,
  type Expected,
} from "../lib/checkout/attempt";
import { EXPIRY_GRACE_MS } from "../lib/payments/payment-status";

const NOW = new Date("2026-10-05T12:00:00Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const BEARER = newBearer();
const HASH = bearerHash(BEARER);
const KEY = attemptKey(HASH, "prod_1");
const SESSION = "f1a0f785-7601-4d53-8f43-08dc33d8302c";

class FakeDecimal {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const expected = (over: Partial<Expected> = {}): Expected => ({
  tokenHash: HASH,
  productId: "prod_1",
  environment: "TEST",
  amount: "49.00",
  currency: "SAR",
  presentation: "DROPIN",
  ...over,
});

/** A live drop-in attempt: session created five minutes ago, ten minutes left. */
const attempt = (over: Partial<CurrentAttempt> = {}): CurrentAttempt => ({
  merchantReferenceId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  clientTokenHash: HASH,
  productId: "prod_1",
  provider: "GEIDEA",
  environment: "TEST",
  amount: new FakeDecimal("49"),
  currency: "SAR",
  status: "SESSION_CREATED",
  presentation: "DROPIN",
  providerSessionId: SESSION,
  failureReason: null,
  expiresAt: at(10 * MIN),
  createdAt: at(-5 * MIN),
  order: null,
  ...over,
});

/** An attempt whose session request has not stored a session id. */
const unstarted = (over: Partial<CurrentAttempt> = {}) =>
  attempt({ status: "CREATED", providerSessionId: null, createdAt: at(-PENDING_WINDOW_MS), ...over });

describe("the bearer", () => {
  test("is 32 random bytes, base64url, and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const value = newBearer();
      assert.match(value, /^[A-Za-z0-9_-]{43}$/);
      seen.add(value);
    }
    assert.equal(seen.size, 200);
  });

  test("only its SHA-256 is stored, and the key binds it to one product", () => {
    assert.match(HASH, /^[0-9a-f]{64}$/);
    assert.notEqual(HASH, BEARER);
    assert.equal(bearerHash(BEARER), HASH, "stable");
    assert.equal(KEY, `${HASH}:prod_1`);
    assert.notEqual(attemptKey(HASH, "prod_1"), attemptKey(HASH, "prod_2"));
  });

  test("is read only from its own cookie, and only in the shape issued", () => {
    assert.equal(readBearer(null), null);
    assert.equal(readBearer(""), null);
    assert.equal(readBearer(`${CHECKOUT_COOKIE}=${BEARER}`), BEARER);
    assert.equal(readBearer(`NEXT_LOCALE=ar; ${CHECKOUT_COOKIE}=${BEARER}; other=1`), BEARER);
    assert.equal(readBearer(`x${CHECKOUT_COOKIE}=${BEARER}`), null, "a lookalike name");
    assert.equal(readBearer(`${CHECKOUT_COOKIE}=short`), null);
    assert.equal(readBearer(`${CHECKOUT_COOKIE}=${BEARER}x`), null);
    assert.equal(readBearer(`${CHECKOUT_COOKIE}=${BEARER.slice(0, 42)}+`), null);
  });

  test("travels in an HttpOnly, SameSite=Lax cookie scoped to the checkout route", () => {
    const secure = bearerCookie(BEARER, true);
    assert.ok(secure.startsWith(`${CHECKOUT_COOKIE}=${BEARER}; `));
    for (const part of ["Path=/api/checkout", "HttpOnly", "SameSite=Lax", "Secure", "Max-Age=604800"]) {
      assert.ok(secure.split("; ").includes(part), part);
    }
    assert.ok(!bearerCookie(BEARER, false).includes("Secure"), "plain http on localhost only");
  });
});

describe("a live session is resumed as itself", () => {
  test("same bearer, product, provider, environment, amount and presentation: the same session", () => {
    assert.deepEqual(decide(attempt(), expected(), NOW), { kind: "resume", sessionId: SESSION, expiresAt: at(10 * MIN) });
  });

  test("a redirect attempt resumes for a redirect request", () => {
    const d = decide(attempt({ presentation: "REDIRECT" }), expected({ presentation: "REDIRECT" }), NOW);
    assert.equal(d.kind, "resume");
  });

  test("a failure or cancel reported by Geidea's callback does not end the session: it is resumed, not replaced", () => {
    for (const status of ["FAILED", "CANCELLED"]) {
      const d = decide(attempt({ status, failureReason: "declined" }), expected(), NOW);
      assert.equal(d.kind, "resume", status);
    }
  });
});

describe("an attempt that might have been paid, or might still be, is never replaced", () => {
  test("another presentation is not reused, and is not replaced either: the status page", () => {
    assert.deepEqual(decide(attempt(), expected({ presentation: "REDIRECT" }), NOW), {
      kind: "open",
      reason: "presentation",
    });
    assert.deepEqual(decide(attempt({ presentation: null }), expected(), NOW), { kind: "open", reason: "presentation" });
  });

  test("a changed price, currency, environment or provider is not resumed, and not replaced", () => {
    for (const changed of [
      attempt({ amount: new FakeDecimal("59") }),
      attempt({ currency: "USD" }),
      attempt({ environment: "PRODUCTION" }),
      attempt({ provider: "STRIPE" }),
    ]) {
      assert.deepEqual(decide(changed, expected(), NOW), { kind: "open", reason: "terms_changed" });
    }
  });

  test("past Geidea's expiry: the status page", () => {
    assert.deepEqual(decide(attempt({ expiresAt: at(-1 * MIN) }), expected(), NOW), { kind: "open", reason: "expired" });
    assert.deepEqual(decide(attempt({ expiresAt: NOW }), expected(), NOW), { kind: "open", reason: "expired" });
  });

  test("no clock ever replaces a session that may have reached a browser: not at the 30-minute display margin, not days later", () => {
    for (const status of ["SESSION_CREATED", "FAILED", "CANCELLED", "EXPIRED"]) {
      for (const sinceExpiry of [EXPIRY_GRACE_MS, EXPIRY_GRACE_MS + 1, 45 * MIN, DAY, 30 * DAY, 400 * DAY]) {
        const d = decide(attempt({ status, expiresAt: at(-sinceExpiry) }), expected(), NOW);
        assert.equal(d.kind, "open", `${status}, ${sinceExpiry / MIN} minutes after expiry`);
      }
    }
  });

  test("expired by Geidea's own callback: not resumed, and not replaced", () => {
    assert.deepEqual(decide(attempt({ status: "EXPIRED" }), expected(), NOW), { kind: "open", reason: "provider_expired" });
  });

  test("PAID without its Order is mid-fulfilment: the status page, never paid on the attempt's word", () => {
    assert.deepEqual(decide(attempt({ status: "PAID" }), expected(), NOW), { kind: "open", reason: "confirming" });
  });

  test("a row that does not match the bearer or product it was found by is shown, never resumed", () => {
    assert.deepEqual(decide(attempt({ clientTokenHash: bearerHash(newBearer()) }), expected(), NOW), {
      kind: "open",
      reason: "bearer",
    });
    assert.deepEqual(decide(attempt({ clientTokenHash: null }), expected(), NOW), { kind: "open", reason: "bearer" });
    assert.deepEqual(decide(attempt({ productId: "prod_2" }), expected(), NOW), { kind: "open", reason: "bearer" });
  });

  test("an unknown status, or a session with no recorded expiry, is shown, never resumed or replaced", () => {
    assert.deepEqual(decide(attempt({ status: "SOMETHING_NEW" }), expected(), NOW), { kind: "open", reason: "unknown" });
    assert.deepEqual(decide(attempt({ expiresAt: null }), expected(), NOW), { kind: "open", reason: "unknown" });
    assert.deepEqual(decide(attempt({ status: "CANCELLED", providerSessionId: null }), expected(), NOW), {
      kind: "open",
      reason: "unknown",
    });
  });
});

describe("a payment that succeeded, whose callback arrives more than 30 minutes after expiry", () => {
  test("before the callback the attempt is shown, never replaced; after it, it is paid", () => {
    // The buyer paid just before Geidea's deadline; the callback is late.
    const waiting = attempt({ expiresAt: at(-45 * MIN) });
    assert.deepEqual(decide(waiting, expected(), NOW), { kind: "open", reason: "expired" });

    // The verified callback claims the attempt and creates its Order in one
    // transaction. Mid-way, PAID without the Order is still only shown.
    assert.deepEqual(decide({ ...waiting, status: "PAID" }, expected(), NOW), { kind: "open", reason: "confirming" });
    assert.deepEqual(decide({ ...waiting, status: "PAID", order: { id: "order_1" } }, expected(), NOW), { kind: "paid" });
  });

  test("however long after, and whatever else has changed since", () => {
    const paid = attempt({ status: "PAID", order: { id: "o" }, expiresAt: at(-30 * DAY), amount: new FakeDecimal("1") });
    assert.deepEqual(decide(paid, expected(), NOW), { kind: "paid" });
  });
});

describe("the attempt being created", () => {
  test("an attempt still waiting for its session is pending, briefly", () => {
    const creating = attempt({ status: "CREATED", providerSessionId: null, createdAt: at(-10 * 1000) });
    assert.deepEqual(decide(creating, expected(), NOW), { kind: "pending" });
  });
});

describe("only an attempt whose session id never left the server is replaced", () => {
  test("Geidea's session request failed", () => {
    const failed = attempt({ status: "FAILED", failureReason: SESSION_CREATE_FAILED, providerSessionId: null });
    assert.deepEqual(decide(failed, expected(), NOW), {
      kind: "replace",
      when: { status: "FAILED", failureReason: SESSION_CREATE_FAILED, providerSessionId: null },
    });
  });

  test("the request creating it stored no session id within the pending window", () => {
    assert.deepEqual(decide(unstarted(), expected(), NOW), {
      kind: "replace",
      when: { status: "CREATED", providerSessionId: null },
    });
  });

  test("a failure with a session id is never replaced, whatever its reason says", () => {
    const d = decide(attempt({ status: "FAILED", failureReason: SESSION_CREATE_FAILED }), expected(), NOW);
    assert.notEqual(d.kind, "replace");
  });

  test("a browser's report never reaches the decision: nothing here reads one", () => {
    const src = readFileSync(new URL("../lib/checkout/attempt.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/onError|onCancel|iframe|timeout|navigator|window|document/.test(src));
  });

  test("the status page's display margin is not imported here at all", () => {
    const src = readFileSync(new URL("../lib/checkout/attempt.ts", import.meta.url), "utf8");
    assert.ok(!src.includes("EXPIRY_GRACE_MS"));
    assert.ok(!src.includes("payment-status"));
  });
});

describe("the release is one conditional statement, and it matches only a replaceable attempt", () => {
  /** How Postgres evaluates the release's WHERE clause on one row. */
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row[k] ?? null) === v);

  test("an unstarted attempt is released and closed in the same statement", () => {
    assert.deepEqual(releaseArgs("ps_1", KEY, { status: "CREATED", providerSessionId: null }), {
      where: { id: "ps_1", currentAttemptKey: KEY, status: "CREATED", providerSessionId: null },
      data: { currentAttemptKey: null, status: "FAILED", failureReason: SUPERSEDED_BEFORE_SESSION },
    });
  });

  test("a failed session request is released only while it still says so", () => {
    assert.deepEqual(
      releaseArgs("ps_1", KEY, { status: "FAILED", failureReason: SESSION_CREATE_FAILED, providerSessionId: null }),
      {
        where: { id: "ps_1", currentAttemptKey: KEY, status: "FAILED", failureReason: SESSION_CREATE_FAILED, providerSessionId: null },
        data: { currentAttemptKey: null },
      }
    );
  });

  test("a row a callback has claimed, or that has a session id, or is no longer current, never matches", () => {
    const { where } = releaseArgs("ps_1", KEY, { status: "CREATED", providerSessionId: null });
    const row = { id: "ps_1", currentAttemptKey: KEY, status: "CREATED", providerSessionId: null };
    assert.ok(matches(row, where), "the state decide saw");
    assert.ok(!matches({ ...row, status: "PAID" }, where), "claimed by the callback");
    assert.ok(!matches({ ...row, status: "SESSION_CREATED", providerSessionId: SESSION }, where), "a session id was stored");
    assert.ok(!matches({ ...row, currentAttemptKey: null }, where), "released by another request");
    assert.ok(!matches({ ...row, status: "FAILED", failureReason: SUPERSEDED_BEFORE_SESSION }, where), "already closed");
  });
});
