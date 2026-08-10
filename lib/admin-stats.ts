/**
 * Founder Dashboard — the single shared query layer.
 *
 * Every admin surface (overview page, products directory) reads through this
 * module so there is exactly one implementation of each question the founder
 * asks. No route or page may query Prisma directly for dashboard data.
 *
 * Privacy rule: nothing in this module selects emails or any other PII.
 * Creators are represented by display name only.
 */

import { prisma } from "@/lib/prisma";
import { isAllowedAssetUrl } from "@/lib/validations";
import type { ModerationStatus, Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Review-source rule                                                  */
/* ------------------------------------------------------------------ */
/**
 * A product is HUMAN-REVIEWED only when its most recent admin decision
 * (APPROVED/REJECTED event with actor `admin:*`) matches its current status.
 * Everything else — including rows backfilled APPROVED by the moderation
 * migration — is NOT YET REVIEWED. ("Migration approved" is never shown to
 * the founder; the mechanism lives in a tooltip, not the vocabulary.)
 */
const ADMIN_DECISION: Prisma.ModerationEventWhereInput = {
  action: { in: ["APPROVED", "REJECTED"] },
  actor: { startsWith: "admin:" },
};

/** Count-level shorthand: has any admin decision ever been recorded. */
const NEVER_ADMIN_DECIDED: Prisma.ProductWhereInput = {
  NOT: { moderationEvents: { some: ADMIN_DECISION } },
};

/* ------------------------------------------------------------------ */
/* Overview stats                                                      */
/* ------------------------------------------------------------------ */

export interface FounderStats {
  users: number;
  creators: number;
  shops: number;
  products: number;
  byStatus: Record<ModerationStatus, number>;
  /** APPROVED products with no recorded human decision — the review backlog. */
  notYetReviewed: number;
  pending: number;
  /** Active, approved products whose downloadable file is missing. */
  missingFile: { id: string; name: string; slug: string; shopSlug: string }[];
  /** Rolling 24h pulse. */
  pulse: { newUsers: number; newProducts: number; newShops: number; newReports: number };
  /** Labelled, excluded from any revenue math (which we never do). */
  testOrders: number;
}

export async function getFounderStats(): Promise<FounderStats> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    users,
    creatorRows,
    shops,
    products,
    countPending,
    countApproved,
    countRejected,
    notYetReviewed,
    missingFileRows,
    newUsers,
    newProducts,
    newShops,
    newReports,
    testOrders,
  ] = await prisma.$transaction([
    prisma.user.count(),
    prisma.shopUser.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.shop.count(),
    prisma.product.count(),
    prisma.product.count({ where: { moderationStatus: "PENDING" } }),
    prisma.product.count({ where: { moderationStatus: "APPROVED" } }),
    prisma.product.count({ where: { moderationStatus: "REJECTED" } }),
    prisma.product.count({
      where: { moderationStatus: "APPROVED", ...NEVER_ADMIN_DECIDED },
    }),
    prisma.product.findMany({
      where: { fileUrl: null, isActive: true, moderationStatus: "APPROVED" },
      select: { id: true, name: true, slug: true, shop: { select: { slug: true } } },
      take: 5,
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
    prisma.product.count({ where: { createdAt: { gte: since } } }),
    prisma.shop.count({ where: { createdAt: { gte: since } } }),
    prisma.moderationEvent.count({ where: { action: "REPORTED", createdAt: { gte: since } } }),
    prisma.order.count({ where: { stripeSessionId: { startsWith: "cs_test_" } } }),
  ]);

  const byStatus: Record<ModerationStatus, number> = {
    PENDING: countPending,
    APPROVED: countApproved,
    REJECTED: countRejected,
  };

  return {
    users,
    creators: creatorRows.length,
    shops,
    products,
    byStatus,
    notYetReviewed,
    pending: byStatus.PENDING,
    missingFile: missingFileRows.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      shopSlug: p.shop.slug,
    })),
    pulse: { newUsers, newProducts, newShops, newReports },
    testOrders,
  };
}

/* ------------------------------------------------------------------ */
/* Products directory                                                  */
/* ------------------------------------------------------------------ */

export const DIRECTORY_FILTERS = [
  "needs_review",
  "pending",
  "approved",
  "rejected",
  "all",
] as const;
export type DirectoryFilter = (typeof DIRECTORY_FILTERS)[number];

/** Allowlisted sort fields — anything else is rejected by the caller. */
export const DIRECTORY_SORTS = ["createdAt", "price", "name"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];

const PAGE_SIZE = 25; // hard server-side cap; callers cannot raise it

export interface DirectoryRow {
  id: string;
  name: string;
  slug: string;
  thumbnailUrl: string | null;
  price: number;
  currency: string;
  category: string | null;
  moderationStatus: ModerationStatus;
  isActive: boolean;
  createdAt: Date;
  shopName: string;
  shopSlug: string;
  /** Display name of the shop's first member. Never an email. */
  creatorName: string;
  reportCount: number;
  humanReviewed: boolean;
  hasFile: boolean;
  /**
   * The deliverable, for admin inspection during review — null unless the
   * stored URL still satisfies the upload allowlist.
   *
   * Re-checked on read rather than trusted from the row: the allowlist was
   * added after the earliest products were created, so a legacy value could
   * predate it. Filtering here means a non-conforming URL never reaches the
   * browser at all, instead of relying on the client to decline to render it.
   */
  fileUrl: string | null;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  nextCursor: string | null;
  totalForFilter: number;
}

function filterWhere(filter: DirectoryFilter): Prisma.ProductWhereInput {
  switch (filter) {
    case "needs_review":
      return { moderationStatus: "APPROVED", ...NEVER_ADMIN_DECIDED };
    case "pending":
      return { moderationStatus: "PENDING" };
    case "approved":
      return { moderationStatus: "APPROVED" };
    case "rejected":
      return { moderationStatus: "REJECTED" };
    case "all":
      return {};
  }
}

/** cuid sanity check for cursors — rejects anything that isn't id-shaped. */
export function isValidCursor(cursor: string): boolean {
  return /^c[a-z0-9]{8,40}$/.test(cursor);
}

export async function getProductsDirectory(opts: {
  filter: DirectoryFilter;
  sort: DirectorySort;
  dir: "asc" | "desc";
  cursor?: string;
  q?: string;
}): Promise<DirectoryPage> {
  const where: Prisma.ProductWhereInput = {
    ...filterWhere(opts.filter),
    ...(opts.q
      ? { name: { contains: opts.q.slice(0, 100), mode: "insensitive" as const } }
      : {}),
  };

  const [totalForFilter, products] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ [opts.sort]: opts.dir }, { id: "asc" }],
      take: PAGE_SIZE + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        slug: true,
        thumbnailUrl: true,
        price: true,
        currency: true,
        category: true,
        moderationStatus: true,
        isActive: true,
        createdAt: true,
        fileUrl: true,
        shop: {
          select: {
            name: true,
            slug: true,
            shopUsers: {
              take: 1,
              orderBy: { joinedAt: "asc" },
              select: { user: { select: { name: true } } },
            },
          },
        },
        _count: {
          select: { moderationEvents: { where: { action: "REPORTED" } } },
        },
        moderationEvents: {
          where: ADMIN_DECISION,
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { newStatus: true },
        },
      },
    }),
  ]);

  const hasMore = products.length > PAGE_SIZE;
  const page = hasMore ? products.slice(0, PAGE_SIZE) : products;

  return {
    totalForFilter,
    nextCursor: hasMore ? page[page.length - 1].id : null,
    rows: page.map((p) => {
      const latest = p.moderationEvents[0];
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        thumbnailUrl: p.thumbnailUrl,
        price: Number(p.price),
        currency: p.currency,
        category: p.category,
        moderationStatus: p.moderationStatus,
        isActive: p.isActive,
        createdAt: p.createdAt,
        shopName: p.shop.name,
        shopSlug: p.shop.slug,
        creatorName: p.shop.shopUsers[0]?.user.name ?? "—",
        reportCount: p._count.moderationEvents,
        humanReviewed: latest != null && latest.newStatus === p.moderationStatus,
        hasFile: p.fileUrl != null,
        fileUrl: isAllowedAssetUrl(p.fileUrl) ? p.fileUrl : null,
      };
    }),
  };
}
