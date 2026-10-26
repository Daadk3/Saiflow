import { prisma } from "@/lib/prisma";
import { SELLABLE_PRODUCT_WHERE } from "@/lib/sellable";
import { UNKNOWN_COUNTRY_FILTER } from "@/lib/store-location";

/** How many stores the page lists at once, newest first. */
export const STORES_PAGE_SIZE = 200;

export interface StoreRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  /** ISO country code, or null when the store was opened before location was asked. */
  country: string | null;
  /** Free-text city, or null when the seller left it blank. */
  city: string | null;
  /** The shop's OWNER members, so the founder knows whom to contact. */
  owners: Array<{ name: string | null; email: string }>;
  products: number;
  /** Products a buyer can reach right now: approved, active, and a file that passed its check. */
  live: number;
}

export interface CountryCount {
  /** ISO code, or null for stores with no country saved. */
  country: string | null;
  count: number;
}

export interface StoreDirectoryQuery {
  q?: string;
  /** An ISO code, or {@link UNKNOWN_COUNTRY_FILTER} for stores with no country. */
  country?: string;
}

/**
 * Every store, for the founder's directory (the admin layout enforces who
 * can see it). A store with no products appears here and nowhere public,
 * which is the point: until now the only trace of a new store was its
 * notification email.
 *
 * `live` uses the storefront's own rule (lib/sellable: approved, active, shop
 * active, SAFE file), so the number matches what buyers see.
 */
export async function getStoresDirectory(
  query: StoreDirectoryQuery = {}
): Promise<{ rows: StoreRow[]; total: number; byCountry: CountryCount[] }> {
  const q = query.q?.trim() || undefined;
  const where: { name?: { contains: string; mode: "insensitive" }; country?: string | null } = {};
  if (q) where.name = { contains: q, mode: "insensitive" };
  if (query.country === UNKNOWN_COUNTRY_FILTER) where.country = null;
  else if (query.country) where.country = query.country;

  // The list respects the filter. The summary does not: it counts every
  // store, so the founder still sees the full picture while looking at one country.
  const [shops, total] = await prisma.$transaction([
    prisma.shop.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: STORES_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        country: true,
        city: true,
        shopUsers: {
          where: { role: "OWNER" },
          orderBy: { joinedAt: "asc" },
          select: { user: { select: { name: true, email: true } } },
        },
        _count: { select: { products: true } },
      },
    }),
    prisma.shop.count({ where }),
  ]);
  const grouped = await prisma.shop.groupBy({
    by: ["country"],
    _count: { _all: true },
  });

  const liveCounts = shops.length
    ? await prisma.product.groupBy({
        by: ["shopId"],
        where: {
          shopId: { in: shops.map((shop) => shop.id) },
          // "Live" is what a buyer can reach: the one storefront rule.
          ...SELLABLE_PRODUCT_WHERE,
        },
        _count: { _all: true },
      })
    : [];
  const liveByShop = new Map(liveCounts.map((row) => [row.shopId, row._count._all]));

  const byCountry: CountryCount[] = grouped
    .map((row) => ({ country: row.country, count: row._count._all }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.country === null) return 1;
      if (b.country === null) return -1;
      return a.country.localeCompare(b.country);
    });

  return {
    total,
    byCountry,
    rows: shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      isActive: shop.isActive,
      createdAt: shop.createdAt,
      country: shop.country,
      city: shop.city,
      owners: shop.shopUsers.map((member) => ({ name: member.user.name, email: member.user.email })),
      products: shop._count.products,
      live: liveByShop.get(shop.id) ?? 0,
    })),
  };
}
