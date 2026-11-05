/**
 * Whether a card entered at checkout can be really charged: only when Geidea
 * is fully configured AND configured as "production". Anything else (a test
 * account, a missing variable, no GEIDEA_ENV) charges nothing, and the
 * checkout page says so with a "Test mode, no real charge" banner.
 *
 * Fails toward the banner: a half-configured deployment is "not live". The
 * checkout route stays the authority on what may be charged (it also refuses
 * a production account except for a founder test, or a public checkout when
 * LIVE_PUBLIC_ALLOWED is set and LIVE_PAYMENTS_MODE is "public";
 * lib/payments/live-mode); this only decides what the page tells the buyer.
 */
export function isLiveCheckout(configured: boolean, mode: "test" | "production" | null): boolean {
  return configured && mode === "production";
}
