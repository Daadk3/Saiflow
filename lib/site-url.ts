/**
 * The canonical public origin, and the permanent product URL built from it.
 *
 * WHY A CONSTANT RATHER THAN `window.location`
 * A creator copies a product link in order to paste it somewhere permanent —
 * a TikTok bio, a WhatsApp broadcast, an invoice. The one thing that must
 * never happen is that they paste a deployment-specific host. Every pull
 * request builds a Vercel Preview at `*.vercel.app`, and the creator dashboard
 * renders there identically to production, so `window.location.origin` would
 * hand back the preview host and produce a link that dies with the
 * deployment. The bug would be invisible in review — the page looks correct —
 * and would only surface as a dead link in someone's audience.
 *
 * So the origin is a literal. Not `window.location`, not a request header, not
 * `VERCEL_URL`.
 *
 * WHY NOT AN ENVIRONMENT VARIABLE
 * An env var reintroduces the same failure with more steps: it can be set on
 * the Preview environment, left unset and fall back to a guess, or drift
 * between environments. The value is a fixed property of the product — the
 * domain SaiFlow is served on — not a deployment parameter. A literal cannot
 * be misconfigured, and a test can pin it exactly.
 *
 * THE SAME STRING ALREADY LIVES IN app/sitemap.ts, app/robots.ts,
 * app/layout.tsx and both public page files. Consolidating those five is a
 * separate tidy-up: they are server-rendered and already correct, and folding
 * them in here would put unrelated files in a UI change. This module is the
 * place that consolidation should eventually land.
 */

/** Canonical public origin. No trailing slash. */
export const SITE_URL = "https://www.saiflow.io";

/**
 * The permanent public address of a product.
 *
 * The shape mirrors the route exactly — `app/shop/[slug]/product/[productSlug]`
 * — and both slugs are frozen at creation (B-1), so the string this returns is
 * stable for the life of the product. That is the entire point: it is safe to
 * hand to an audience.
 *
 * Segments are percent-encoded. Today every slug is already URL-safe, because
 * `slugBase` emits only `[a-z0-9-]` and the non-Latin fallback is
 * `product-<random>` — so encoding is a no-op on real data. It is here for the
 * case that is not true yet: encoding at the boundary means a slug containing
 * `?`, `#` or a space can never silently truncate or re-target the URL. A
 * correctness property should not depend on a generator that a future change
 * might loosen.
 *
 * `encodeURIComponent`, not `encodeURI`, and per segment rather than over the
 * whole string: `encodeURI` leaves `?` and `#` intact, which are precisely the
 * characters that would change which resource the URL points at.
 *
 * DELIBERATELY TOTAL AND UNJUDGING. This builds an address; it does not decide
 * whether the address currently serves a page. A product awaiting moderation
 * or a file-safety check has a reserved URL that 404s until it is eligible,
 * and the creator is still entitled to see and copy it. Sellability is the
 * server's business (`SAFE_DELIVERABLE_WHERE`), and nothing here consults,
 * mirrors or weakens it.
 *
 * KNOWN LIMITATION, NOT HANDLED HERE. Exactly one shop in production carries
 * an empty slug (a pre-fallback Arabic name), for which this returns
 * `.../shop//product/x`. That URL is already 404 today and the repair is a
 * separate one-row data fix. Inventing a placeholder here would paper over a
 * broken address and hand the creator a link that looks plausible and cannot
 * work — worse than an obviously wrong one.
 */
export function productUrl(shopSlug: string, productSlug: string): string {
  return `${SITE_URL}/shop/${encodeURIComponent(shopSlug)}/product/${encodeURIComponent(productSlug)}`;
}
