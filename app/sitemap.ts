import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { SAFE_DELIVERABLE_WHERE } from "@/lib/file-safety";

const BASE = "https://www.saiflow.io";

/**
 * Rendered per request, not at build time.
 *
 * Without this a sitemap.ts that uses no dynamic API is statically
 * prerendered, so the file becomes a snapshot of whatever the database said
 * when the deployment was built. That is how a product approved after a deploy
 * stayed absent from the sitemap while /browse — which is dynamic — listed it
 * immediately: same query, same eligibility rule, different freshness.
 *
 * The staleness also runs the other way, and that direction matters more: a
 * product that later becomes UNSAFE, has its file replaced, is deactivated or
 * is rejected would keep its URL advertised here until the next deploy, so
 * crawlers would collect 404s. Nothing unsafe becomes reachable — the product
 * route is dynamic and re-checks the gate on every request — but a sitemap
 * should not name URLs the site will refuse to serve.
 *
 * force-dynamic rather than a revalidate window: sitemaps are fetched by
 * crawlers a handful of times a day, so one query per request costs nothing
 * and buys exact consistency with /browse. The catch below still degrades to
 * the static pages if the database is unreachable, so the failure mode is
 * unchanged.
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/browse`, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/features`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/support`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/docs`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/content-policy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/refunds`, changeFrequency: "yearly", priority: 0.3 },
  ];

  // Live storefronts and products (graceful when DB is unreachable at build)
  try {
    const shops = await prisma.shop.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        // Stage E2: a product that cannot be bought is not offered to search
        // engines either — an indexed URL that 404s on click is worse than an
        // absent one.
        products: {
          where: {
            isActive: true,
            moderationStatus: "APPROVED",
            ...SAFE_DELIVERABLE_WHERE,
          },
          select: { slug: true },
        },
      },
    });
    const shopPages: MetadataRoute.Sitemap = shops.flatMap((shop) => [
      { url: `${BASE}/shop/${shop.slug}`, changeFrequency: "weekly" as const, priority: 0.8 },
      ...shop.products.map((p) => ({
        url: `${BASE}/shop/${shop.slug}/product/${p.slug}`,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      })),
    ]);
    return [...staticPages, ...shopPages];
  } catch {
    return staticPages;
  }
}
