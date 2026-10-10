import { SITE_URL } from "@/lib/site-url";

/**
 * Absolute links for notifications.
 *
 * An email is read outside the app, so every link in one must be absolute,
 * and it must open the deployment that produced it: a review link sent from
 * a Preview has to open that Preview, or the founder lands on a product that
 * does not exist where they landed. NEXTAUTH_URL is set per environment for
 * exactly this reason (sign-in callbacks have the same constraint) and the
 * receipt email already trusts it, so it is the origin whenever it is a
 * well-formed http(s) URL. The canonical public origin is the fallback.
 * Never a request header, never VERCEL_URL.
 *
 * Every dynamic segment is percent-encoded at this boundary, so an id or a
 * slug can never re-target the address it is embedded in.
 */
export function notificationOrigin(): string {
  const raw = process.env.NEXTAUTH_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // fall through to the canonical origin
    }
  }
  return SITE_URL;
}

const seg = (value: string) => encodeURIComponent(value);

/** The admin's product review page: preview, file status, approve or reject. */
export function adminProductReviewUrl(productId: string): string {
  return `${notificationOrigin()}/dashboard/admin/products/${seg(productId)}/preview`;
}

export function moderationQueueUrl(): string {
  return `${notificationOrigin()}/dashboard/moderation`;
}

export function adminDashboardUrl(): string {
  return `${notificationOrigin()}/dashboard/admin`;
}

export function publicShopUrl(shopSlug: string): string {
  return `${notificationOrigin()}/shop/${seg(shopSlug)}`;
}

export function sellerShopUrl(shopSlug: string): string {
  return `${notificationOrigin()}/dashboard/shop/${seg(shopSlug)}`;
}

export function sellerProductEditUrl(shopSlug: string, productSlug: string): string {
  return `${notificationOrigin()}/dashboard/shop/${seg(shopSlug)}/product/${seg(productSlug)}/edit`;
}

export function sellerSalesUrl(): string {
  return `${notificationOrigin()}/dashboard/sales`;
}
