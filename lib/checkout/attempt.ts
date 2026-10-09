import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalAmount } from "@/lib/payments/geidea/callback";

/**
 * One current checkout attempt per browser and product.
 *
 * WHY. Each new attempt is a new Geidea session, and each session is
 * separately payable. A buyer who reloads the checkout page, retries after a
 * form that would not load, or falls back to the hosted page while an
 * embedded payment is still in flight would otherwise hold two sessions
 * that can both take money. Callback idempotency cannot help: it is keyed
 * per attempt, and these are two attempts.
 *
 * HOW. Before anything payable exists, the browser holds a bearer: a random
 * secret in an HttpOnly cookie scoped to the checkout route. A checkout
 * request that arrives without one is given one and nothing else: no
 * attempt, no Geidea session. So every session belongs to a bearer the
 * browser already held when it asked, and every tab, reload and retry of
 * that browser presents the same one. The attempt stores only the bearer's
 * SHA-256, plus `currentAttemptKey` = "<hash>:<productId>", which is unique
 * in the database. Every checkout request from that browser for that
 * product finds the same attempt and is answered by `decide`:
 *
 *   resume    the same Geidea session, in the presentation it was created
 *             for, while Geidea's own expiry has not passed;
 *   paid      the attempt produced an Order: its status page, no new payment;
 *   open      the attempt might have been paid, or might still be: its status
 *             page, no new payment, for as long as that stays unknown;
 *   pending   another request from this browser is creating it right now;
 *   replace   no session id from it ever reached a browser, so nothing can
 *             pay it, and a new attempt may start.
 *
 * NOTHING HERE TRUSTS THE BROWSER for money or for an outcome. The bearer
 * only identifies; a resume re-checks the attempt's product, provider,
 * environment, currency and amount against the trusted values the route
 * derived from the product row. A browser report of an error, a cancel, a
 * timeout or a missing iframe never reaches this module at all: replacement
 * depends only on what SaiFlow recorded.
 *
 * PROVIDER SEMANTICS ARE NOT GUESSED. A session is resumed only as itself:
 * the same id, in the same presentation, before the expiry Geidea returned
 * when it created it. Whether a drop-in session may be opened on the hosted
 * page instead is not documented, so it never is.
 *
 * NO CLOCK REPLACES A SESSION. Geidea's expiry is a deadline for starting
 * its checkout, not a record of how a started payment ended: a payment can
 * succeed while its callback, or fulfilment, is still on the way. So once a
 * session id may have reached a browser, nothing SaiFlow holds proves that
 * session unpaid, and its attempt is never replaced: not at expiry, not 30
 * minutes later, not ever. It is resumed while Geidea's deadline allows,
 * shown on its status page after that, and paid once the verified callback
 * makes its Order. A failure or cancel reported by Geidea's callback is not
 * treated as the session's end either: the callback still fulfils a later
 * success on the same attempt.
 *
 * WHAT CAN BE REPLACED, AND HOW. Only an attempt whose session id provably
 * never left the server: Geidea's session request failed, or the request
 * creating it ended without one. The evidence is SaiFlow's own write order:
 * the session id is stored, conditionally on the attempt still being
 * CREATED, before any reply carries it. Replacement releases the attempt in
 * one conditional statement, `releaseArgs`, that matches only while the
 * attempt is still in exactly that state, so it can never take an attempt a
 * callback has claimed in the meantime; and releasing a CREATED attempt
 * also closes it, so the request still creating it finds its own store
 * refused and hands its session id to no one. The route acts only on a
 * release that matched.
 */

/** The bearer cookie. Scoped to the checkout route, invisible to scripts. */
export const CHECKOUT_COOKIE = "saiflow_checkout";
export const CHECKOUT_COOKIE_PATH = "/api/checkout";
/** Long enough to recognise a browser's paid attempt for a week; the safety window is far shorter. */
export const CHECKOUT_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long a CREATED attempt is waited for before it is replaced. Liveness
 * only: checkout's functions are capped at 30 seconds, so after this the
 * request creating it has ended. Safety does not rest on it. The release
 * closes the attempt in the same statement, so even a request still running
 * would find its store refused and deliver nothing.
 */
export const PENDING_WINDOW_MS = 2 * 60 * 1000;

/** Recorded when Geidea's session request fails; no session id reached any browser. */
export const SESSION_CREATE_FAILED = "session_create_failed";
/** Recorded when a CREATED attempt is replaced before its session id was stored. */
export const SUPERSEDED_BEFORE_SESSION = "superseded_before_session";

const BEARER = /^[A-Za-z0-9_-]{43}$/;

/** A fresh bearer: 32 random bytes, base64url. */
export function newBearer(): string {
  return randomBytes(32).toString("base64url");
}

/** The bearer from a Cookie header, or null when absent or not in the one shape issued. */
export function readBearer(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== CHECKOUT_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return BEARER.test(value) ? value : null;
  }
  return null;
}

/** What the database stores in place of the bearer. */
export function bearerHash(bearer: string): string {
  return createHash("sha256").update(bearer).digest("hex");
}

/** The unique key that makes one attempt current for one browser and one product. */
export function attemptKey(tokenHash: string, productId: string): string {
  return `${tokenHash}:${productId}`;
}

/** The Set-Cookie value that hands the browser its bearer. */
export function bearerCookie(bearer: string, secure: boolean): string {
  return [
    `${CHECKOUT_COOKIE}=${bearer}`,
    `Path=${CHECKOUT_COOKIE_PATH}`,
    `Max-Age=${CHECKOUT_COOKIE_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export type Presentation = "REDIRECT" | "DROPIN";

/** An attempt as `decide` reads it. */
export interface CurrentAttempt {
  merchantReferenceId: string;
  clientTokenHash: string | null;
  productId: string;
  provider: string;
  environment: string;
  amount: unknown;
  currency: string;
  status: string;
  presentation: string | null;
  providerSessionId: string | null;
  failureReason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  order: { id: string } | null;
}

/** What the route trusts for this request, all derived server-side. */
export interface Expected {
  tokenHash: string;
  productId: string;
  environment: "TEST" | "PRODUCTION";
  /** The product row's price, canonicalised. */
  amount: string;
  currency: string;
  presentation: Presentation;
}

export type OpenReason =
  | "bearer"
  | "confirming"
  | "terms_changed"
  | "provider_expired"
  | "expired"
  | "presentation"
  | "unknown";

/**
 * The exact state an attempt must still be in when it is released for a
 * replacement. Both say that no session id was ever stored for it, which is
 * what proves no browser can hold one.
 */
export type ReleaseWhen =
  | { status: "CREATED"; providerSessionId: null }
  | { status: "FAILED"; failureReason: typeof SESSION_CREATE_FAILED; providerSessionId: null };

export type Decision =
  | { kind: "resume"; sessionId: string; expiresAt: Date }
  | { kind: "paid" }
  | { kind: "open"; reason: OpenReason }
  | { kind: "pending" }
  | { kind: "replace"; when: ReleaseWhen };

/**
 * The one statement that releases an attempt for replacement: an updateMany
 * that matches only this attempt, only while it is still this browser's
 * current attempt, and only while it is still in the state `decide` saw. A
 * callback that claimed it, or another request that released it first,
 * leaves nothing to match, and the caller must then answer from the attempt
 * as it is now. Releasing a CREATED attempt also closes it, so the request
 * that may still be creating it can no longer store a session id.
 */
export function releaseArgs(attemptId: string, key: string, when: ReleaseWhen) {
  return {
    where: { id: attemptId, currentAttemptKey: key, ...when },
    data:
      when.status === "CREATED"
        ? { currentAttemptKey: null, status: "FAILED" as const, failureReason: SUPERSEDED_BEFORE_SESSION }
        : { currentAttemptKey: null },
  };
}

function sameHash(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Whether Geidea created a session for this attempt that a browser could have received. */
function hasSession(attempt: CurrentAttempt): attempt is CurrentAttempt & { providerSessionId: string } {
  return typeof attempt.providerSessionId === "string" && attempt.providerSessionId.length > 0;
}

export function decide(attempt: CurrentAttempt, expected: Expected, now: Date): Decision {
  // The key was derived from this bearer and product; anything else is a
  // record that cannot be vouched for, so it is shown, never resumed.
  if (!sameHash(attempt.clientTokenHash, expected.tokenHash) || attempt.productId !== expected.productId) {
    return { kind: "open", reason: "bearer" };
  }

  // The verified callback's Order is the only proof of payment.
  if (attempt.order !== null) return { kind: "paid" };
  if (attempt.status === "PAID") return { kind: "open", reason: "confirming" };

  if (!hasSession(attempt)) {
    // No session id was ever stored for this attempt, and the route stores
    // one before any reply carries it: no browser can hold one.
    if (attempt.status === "FAILED" && attempt.failureReason === SESSION_CREATE_FAILED) {
      return { kind: "replace", when: { status: "FAILED", failureReason: SESSION_CREATE_FAILED, providerSessionId: null } };
    }
    if (attempt.status === "CREATED") {
      return now.getTime() - attempt.createdAt.getTime() < PENDING_WINDOW_MS
        ? { kind: "pending" }
        : { kind: "replace", when: { status: "CREATED", providerSessionId: null } };
    }
    return { kind: "open", reason: "unknown" };
  }

  // From here a session id may have reached a browser. Nothing below ever
  // replaces the attempt: only its Order says how it ended.
  if (!["SESSION_CREATED", "FAILED", "CANCELLED", "EXPIRED"].includes(attempt.status)) {
    return { kind: "open", reason: "unknown" };
  }
  if (attempt.expiresAt === null) return { kind: "open", reason: "unknown" };

  if (
    attempt.provider !== "GEIDEA" ||
    attempt.environment !== expected.environment ||
    attempt.currency !== expected.currency ||
    canonicalAmount(attempt.amount) !== expected.amount
  ) {
    return { kind: "open", reason: "terms_changed" };
  }
  if (attempt.status === "EXPIRED") return { kind: "open", reason: "provider_expired" };
  if (now.getTime() >= attempt.expiresAt.getTime()) return { kind: "open", reason: "expired" };
  if (attempt.presentation !== expected.presentation) return { kind: "open", reason: "presentation" };

  return { kind: "resume", sessionId: attempt.providerSessionId, expiresAt: attempt.expiresAt };
}
