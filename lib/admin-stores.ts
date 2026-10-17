import { prisma } from "@/lib/prisma";
import { SELLABLE_PRODUCT_WHERE } from "@/lib/sellable";

/** How many stores the page lists at once, newest first. */
export const STORES_PAGE_SIZE = 200;

export interface StoreRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: Date;
  /** The shop's OWNER members, so the founder knows whom to contact. */
  owners: Array<{ name: string | null; email: string }>;
  products: number;
  /** Products a buyer can reach right now: approved, active, and a file that passed its check. */
  live: number;
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
export async function getStoresDirectory(q?: string): Promise<{ rows: StoreRow[]; total: number }> {
  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};
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

  return {
    total,
    rows: shops.map((shop) => ({
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      isActive: shop.isActive,
      createdAt: shop.createdAt,
      owners: shop.shopUsers.map((member) => ({ name: member.user.name, email: member.user.email })),
      products: shop._count.products,
      live: liveByShop.get(shop.id) ?? 0,
    })),
  };
}
