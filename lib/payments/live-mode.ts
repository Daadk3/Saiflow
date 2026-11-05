/**
 * Who may pay at checkout, and on which Geidea account. One decision, used
 * by the checkout route (the authority) and by the checkout page (which only
 * declines to show a form the route would refuse).
 *
 * THREE SWITCHES, ALL SERVER-SIDE:
 *   - PRE_LAUNCH_MODE (lib/env; on unless exactly "false") closes checkout
 *     to the public. Unchanged.
 *   - LIVE_PAYMENTS_MODE: "off" (default; also missing, empty or anything
 *     unrecognised), "founder_only" or "public".
 *   - FOUNDER_TEST_EMAILS: the addresses allowed a founder test.
 *   - LIVE_STORE_SLUGS: the stores allowed to sell while
 *     LIVE_PAYMENTS_MODE=own_store.
 *
 * FOUNDER TEST (LIVE_PAYMENTS_MODE=founder_only). A signed-in user whose
 * session email is on FOUNDER_TEST_EMAILS may check out even while
 * PRE_LAUNCH_MODE is on, on whichever Geidea account the deployment is
 * configured for (production included), for a product priced at most
 * FOUNDER_TEST_MAX_SAR. The attempt and its Order are marked `founderTest`
 * and are never revenue and never paid out. Everyone else is answered
 * exactly as before: the pre-launch notice. Every other checkout gate still
 * runs.
 *
 * OWN STORE (LIVE_PAYMENTS_MODE=own_store). While PRE_LAUNCH_MODE is on,
 * anyone may buy a product whose store's slug is on LIVE_STORE_SLUGS, on
 * whichever Geidea account the deployment is configured for (production
 * included). These are the platform owner's own stores: the money is theirs,
 * so it is a real sale (not a founder test) and no third-party seller is
 * paid. Every other store stays closed with the pre-launch notice, so
 * SaiFlow never collects money on another seller's behalf. Every other
 * checkout gate still runs.
 *
 * PUBLIC STAYS LOCKED. With PRE_LAUNCH_MODE off, checkout behaves exactly as
 * before this switch existed: a test Geidea account works for everyone, and
 * a production account is refused. "public" does not change that yet:
 * opening real payments to everyone stays a separate, reviewed release
 * (LIVE_PUBLIC_ALLOWED below).
 */

/** Opening real payments to the public is a reviewed release, not an env value. */
export const LIVE_PUBLIC_ALLOWED = false;

/**
 * The most a founder test may charge, in riyals. Geidea requires real-payment
 * tests of at least 10 SAR, and small amounts do not show clearly in
 * settlement, so the cap leaves room for a 30 SAR settlement test.
 */
export const FOUNDER_TEST_MAX_SAR = 50;

export type LivePaymentsMode = "off" | "founder_only" | "own_store" | "public";

/** Exactly "founder_only", "own_store" or "public" (surrounding spaces ignored); everything else is "off". */
export function parseLivePaymentsMode(raw: unknown): LivePaymentsMode {
  if (typeof raw !== "string") return "off";
  const value = raw.trim();
  return value === "founder_only" || value === "own_store" || value === "public" ? value : "off";
}

/** Store slugs: lower-case letters, digits and hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Comma- or space-separated store slugs, lower-cased; anything that is not one slug is dropped. */
export function parseLiveStoreSlugs(raw: unknown): ReadonlySet<string> {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0 && part.length <= 100 && SLUG.test(part))
  );
}

/** Plain ASCII addresses only: no look-alike letters. */
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** Comma- or space-separated addresses, lower-cased; anything that is not one address is dropped. */
export function parseFounderEmails(raw: unknown): ReadonlySet<string> {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length > 0 && part.length <= 254 && EMAIL.test(part))
  );
}

export type CheckoutAccess =
  /** Pre-launch is off: checkout as it always was. */
  | { kind: "public" }
  /** Pre-launch is on, but this signed-in user is on the founder test list. */
  | { kind: "founder_test" }
  /** Pre-launch is on, but this product's store is on LIVE_STORE_SLUGS. */
  | { kind: "own_store" }
  /** Pre-launch is on and this request is not a founder test: the notice. */
  | { kind: "closed" };

export interface AccessInput {
  preLaunch: boolean;
  mode: LivePaymentsMode;
  founderEmails: ReadonlySet<string>;
  /** The server-side session's email, or null when nobody is signed in. */
  sessionEmail: string | null | undefined;
  /** LIVE_STORE_SLUGS, parsed. Only read in own_store mode. */
  liveStoreSlugs?: ReadonlySet<string>;
  /** The product's store slug, from the database row; null before the product is known. */
  shopSlug?: string | null;
}

export function checkoutAccess(input: AccessInput): CheckoutAccess {
  if (!input.preLaunch) return { kind: "public" };
  if (input.mode === "own_store") {
    const slug = typeof input.shopSlug === "string" ? input.shopSlug.trim().toLowerCase() : "";
    return slug.length > 0 && (input.liveStoreSlugs ?? new Set()).has(slug) ? { kind: "own_store" } : { kind: "closed" };
  }
  if (input.mode !== "founder_only") return { kind: "closed" };
  const email = typeof input.sessionEmail === "string" ? input.sessionEmail.trim().toLowerCase() : "";
  return email.length > 0 && input.founderEmails.has(email) ? { kind: "founder_test" } : { kind: "closed" };
}

/**
 * Whether this checkout may use the Geidea account the deployment is
 * configured for. A test account: always (as before). A production account:
 * only for a founder test, an own-store sale, or for the public once LIVE_PUBLIC_ALLOWED and
 * "public" are both set.
 */
export function accountAllowed(access: CheckoutAccess, mode: LivePaymentsMode, account: "test" | "production"): boolean {
  if (account === "test") return true;
  if (access.kind === "founder_test") return true;
  if (access.kind === "own_store") return mode === "own_store";
  return access.kind === "public" && LIVE_PUBLIC_ALLOWED && mode === "public";
}

/**
 * A production Geidea account is used only by the production deployment.
 * Elsewhere (a Preview, a laptop) its callback would go to a host Geidea
 * cannot reach or to the wrong database, so a real card could be charged
 * with no Order to show for it. `vercelEnv` is Vercel's own VERCEL_ENV.
 */
export function productionAccountHere(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

/** A founder test's price cap, on the canonical two-decimal amount ("1.00"). */
export function withinFounderCap(canonicalAmount: string): boolean {
  const value = Number(canonicalAmount);
  return Number.isFinite(value) && value > 0 && value <= FOUNDER_TEST_MAX_SAR;
}
