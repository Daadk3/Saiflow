import { permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LEGACY_SHOP_SLUG, NEUTRAL_SHOP_SLUG, legacyShopRedirectPath } from "@/lib/shop-slug";

/**
 * 308 to the neutral slug when the database has already been renamed.
 * A lookup failure leaves the request on the URL it came in on.
 * See prisma/manual/rename-founder-shop-slug.sql for the data step.
 * That SQL is not part of deploy and must be run only after approval.
 */
export async function redirectLegacyShopPath(pathname: string): Promise<void> {
  if (legacyShopRedirectPath(pathname, true, true) === null) return;

  let legacyGone = false;
  let neutralActive = false;
  try {
    const [legacy, neutral] = await Promise.all([
      prisma.shop.findUnique({ where: { slug: LEGACY_SHOP_SLUG }, select: { id: true } }),
      prisma.shop.findUnique({ where: { slug: NEUTRAL_SHOP_SLUG }, select: { isActive: true } }),
    ]);
    legacyGone = legacy === null;
    neutralActive = neutral?.isActive === true;
  } catch (error) {
    console.error("Shop slug redirect: lookup failed, serving the requested URL.", error);
    return;
  }

  const target = legacyShopRedirectPath(pathname, legacyGone, neutralActive);
  if (target) permanentRedirect(target);
}
