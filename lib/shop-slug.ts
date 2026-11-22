/**
 * The founder's public store used a slug built from a personal name.
 * The neutral slug is `sahab-store` (the store is Sahab Store).
 *
 * Redirect only after the row has moved: if `daad-s-store` still exists,
 * the old URL keeps serving it. If both rows exist, the old URL also keeps
 * serving, so a different shop cannot take over the name. The redirect
 * turns on when the old slug is gone and `sahab-store` is an active shop.
 */
export const LEGACY_SHOP_SLUG = "daad-s-store";
export const NEUTRAL_SHOP_SLUG = "sahab-store";

const PREFIXES = ["/shop/", "/checkout/"] as const;

/** The path to send, or null when this request should stay where it is. */
export function legacyShopRedirectPath(pathname: string, legacyGone: boolean, neutralActive: boolean): string | null {
  if (!legacyGone || !neutralActive) return null;
  for (const prefix of PREFIXES) {
    const marker = `${prefix}${LEGACY_SHOP_SLUG}`;
    if (pathname === marker || pathname.startsWith(`${marker}/`)) {
      return `${prefix}${NEUTRAL_SHOP_SLUG}${pathname.slice(marker.length)}`;
    }
  }
  return null;
}
