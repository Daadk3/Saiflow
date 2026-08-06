import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

const BASE = "https://www.saiflow.io";

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
        products: { where: { isActive: true, moderationStatus: "APPROVED" }, select: { slug: true } },
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
