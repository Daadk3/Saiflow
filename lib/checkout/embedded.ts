/**
 * SaiFlow's embedded checkout: the rules the browser applies before it acts.
 *
 * Client-safe and pure, so every rule is tested without a browser. Nothing
 * here decides anything about money. These functions only check that what
 * the server handed the page has the one shape it may have before the page
 * uses it: a library to load, a session to mount, a success page to go to
 * afterwards, a hosted page to fall back to. Anything else is treated as a
 * failure to start, never a guess, and never a reason for a second session.
 *
 * Payment authority stays exactly where it was: Geidea's signed callback,
 * SaiFlow's comparison against the attempt row, the authenticated order
 * inquiry, and the Order written in one transaction. The browser learns the
 * outcome from the success page, which reads SaiFlow's own rows.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where Geidea serves its Checkout v2 library on the configured hosted-page host. */
export const GEIDEA_SCRIPT_PATH = "/hpp/geideaCheckout.min.js";
/** Geidea's hosted checkout page for one session: `/hpp/checkout/?<sessionId>`. */
export const HOSTED_CHECKOUT_PATH = "/hpp/checkout/";
/**
 * Every drop-in container id starts with this; the rest is unique to one
 * mounted checkout page (see `dropInContainerId`). There is deliberately no
 * fixed id: a Geidea iframe that arrives late for a page the buyer has left
 * must have nowhere on the current page to land.
 */
export const DROPIN_CONTAINER_PREFIX = "saiflow-geidea-dropin";

/** The container id for one mount: the prefix and that mount's token, safe as an HTML id. */
export function dropInContainerId(token: string): string {
  return `${DROPIN_CONTAINER_PREFIX}-${token.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64)}`;
}
/** Per-tab record of the attempt this page started; see `resumePathFor`. */
export const ATTEMPT_STORAGE_KEY = "saiflow.checkout.attempt";
/** How long after starting an attempt a return to this page is read as the end of it. */
export const RESUME_WINDOW_MS = 30 * 60 * 1000;

/** SaiFlow's own checkout page for a product. Both slugs are encoded at the boundary. */
export function checkoutPath(shopSlug: string, productSlug: string): string {
  return `/checkout/${encodeURIComponent(shopSlug)}/${encodeURIComponent(productSlug)}`;
}

function httpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") {
    return null;
  }
  return url;
}

/** Geidea's library, as the server derived it from configuration: https, that path, nothing else. */
export function isTrustedScriptUrl(value: unknown): value is string {
  const url = httpsUrl(value);
  return url !== null && url.pathname === GEIDEA_SCRIPT_PATH && url.search === "";
}

/** Geidea's hosted checkout page for one session, and nothing else. */
export function isHostedCheckoutUrl(value: unknown): value is string {
  const url = httpsUrl(value);
  return url !== null && url.pathname === HOSTED_CHECKOUT_PATH && UUID.test(url.search.slice(1));
}

/** SaiFlow's own success page for one attempt, as a relative path, and nothing else. */
export function isSuccessPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^\/success\?ref=([^&#]+)$/.exec(value);
  return match !== null && UUID.test(match[1]);
}

export interface DropInSession {
  sessionId: string;
  scriptUrl: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  successPath: string;
}

/** The server's drop-in reply, checked field by field; null if any field is off. */
export function parseDropInSession(body: unknown): DropInSession | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { sessionId, scriptUrl, expiresAt, successPath } = body as Record<string, unknown>;
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) return null;
  if (!isTrustedScriptUrl(scriptUrl)) return null;
  if (!isSuccessPath(successPath)) return null;
  if (typeof expiresAt !== "string") return null;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return null;
  return { sessionId, scriptUrl, expiresAt: expiry, successPath };
}

/** The session has lapsed. The page says so; it never tears down a form mid-payment. */
export function hasExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}

export interface StoredAttempt {
  productId: string;
  successPath: string;
  startedAt: number;
}

export function serializeAttempt(attempt: StoredAttempt): string {
  return JSON.stringify(attempt);
}

function parseStoredAttempt(raw: unknown): StoredAttempt | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const { productId, successPath, startedAt } = value as Record<string, unknown>;
  if (typeof productId !== "string" || productId.length === 0) return null;
  if (!isSuccessPath(successPath)) return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { productId, successPath, startedAt };
}

/**
 * Whether a checkout page that has just loaded should send the buyer to an
 * earlier attempt's status page instead of starting a new payment.
 *
 * Geidea documents that after an embedded payment it returns the customer
 * "to the parent URL from where the checkout was started". If that ever
 * happens as a full page load, a fresh session here would show a new payment
 * form to a buyer who has just paid. SaiFlow never links to its checkout page
 * with a query string, so arriving with one, for the same product, soon after
 * this tab started an attempt, is read as that return, and the buyer goes to
 * the attempt's own status page, which is the authority. A plain reload has
 * no query string and starts afresh. The caller clears the record before
 * following the answer, so the back button cannot loop.
 */
export function resumePathFor(
  search: string,
  stored: unknown,
  productId: string,
  now: number
): string | null {
  if (search === "" || search === "?") return null;
  const attempt = parseStoredAttempt(stored);
  if (attempt === null || attempt.productId !== productId) return null;
  const age = now - attempt.startedAt;
  if (age < 0 || age > RESUME_WINDOW_MS) return null;
  return attempt.successPath;
}

/**
 * The checkout route's answer when this browser already has an attempt for
 * the product (see lib/checkout/attempt): its status page, for an attempt
 * that is paid or that might still be, or a short wait while another request
 * from this browser creates it. Never a reason to ask for another session.
 */
export type AttemptConflict =
  | { kind: "status"; statusPath: string }
  | { kind: "pending"; statusPath: string | null };

export function attemptConflictFrom(status: number, body: unknown): AttemptConflict | null {
  if (status !== 409 || body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { error, statusPath } = body as Record<string, unknown>;
  const path = isSuccessPath(statusPath) ? statusPath : null;
  if (error === "attempt_pending") return { kind: "pending", statusPath: path };
  if ((error === "attempt_open" || error === "already_paid") && path !== null) {
    return { kind: "status", statusPath: path };
  }
  return null;
}

/**
 * The checkout route's answer to a request that held no checkout identity:
 * it has just been issued one, in a cookie, and nothing was started. Asked
 * again, the browser carries it. A browser that keeps arriving without it
 * is not storing the cookie.
 */
export function identityRequired(status: number, body: unknown): boolean {
  return (
    status === 428 &&
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).error === "identity_required"
  );
}

/**
 * Why the page could not start a payment: from the checkout route's status,
 * or, for `lock_unavailable`, because this browser could not give checkout
 * its cross-tab lock and so nothing was sent (lib/checkout/tab-lock).
 */
export type StartProblem =
  | "rate_limited"
  | "not_available"
  | "payments_off"
  | "cookies"
  | "lock_unavailable"
  | "service";

export function startProblemFor(status: number): StartProblem {
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 404) return "not_available";
  if (status === 503) return "payments_off";
  if (status === 428) return "cookies";
  return "service";
}
