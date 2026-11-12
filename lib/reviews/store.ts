/**
 * Writing and reading reviews. Public reads never include a hidden row and
 * never include the buyer's email: the mask is applied here, before a page
 * can render it.
 */

import { prisma } from "@/lib/prisma";
import { maskedBuyer, PUBLIC_REVIEW_LIMIT, roundReviewAverage } from "@/lib/reviews/display";

export type PublicReview = {
  id: string;
  stars: number;
  body: string | null;
  buyer: string;
  createdAt: string;
};

export type PublicReviewSummary = {
  average: number | null;
  count: number;
  reviews: PublicReview[];
  truncated: boolean;
};

export async function loadPublicReviews(productId: string): Promise<PublicReviewSummary> {
  const where = { productId, hiddenAt: null } as const;
  const [rows, aggregate] = await Promise.all([
    prisma.productReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PUBLIC_REVIEW_LIMIT,
      select: { id: true, stars: true, body: true, buyerEmail: true, createdAt: true },
    }),
    prisma.productReview.aggregate({
      where,
      _avg: { stars: true },
      _count: { _all: true },
    }),
  ]);
  const count = aggregate._count._all;
  const average =
    count > 0 && aggregate._avg.stars !== null ? roundReviewAverage(Number(aggregate._avg.stars)) : null;
  return {
    average,
    count,
    truncated: count > rows.length,
    reviews: rows.map((row) => ({
      id: row.id,
      stars: row.stars,
      body: row.body,
      buyer: maskedBuyer(row.buyerEmail),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002";
}

/**
 * Create the buyer's review, or update the one they already have for this
 * product. A second purchase does not create a second review. Hiding is left
 * as the moderator set it: an edit does not put a hidden review back.
 */
export async function saveReview(input: {
  orderId: string;
  productId: string;
  email: string;
  stars: number;
  body: string | null;
}): Promise<{ created: boolean }> {
  const where = { buyerEmail_productId: { buyerEmail: input.email, productId: input.productId } };
  const existing = await prisma.productReview.findUnique({ where, select: { id: true } });
  if (existing) {
    await prisma.productReview.update({
      where: { id: existing.id },
      data: { stars: input.stars, body: input.body },
    });
    return { created: false };
  }
  try {
    await prisma.productReview.create({
      data: {
        productId: input.productId,
        orderId: input.orderId,
        buyerEmail: input.email,
        stars: input.stars,
        body: input.body,
      },
    });
    return { created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await prisma.productReview.update({
      where,
      data: { stars: input.stars, body: input.body },
    });
    return { created: false };
  }
}

export type ModerationReview = {
  id: string;
  stars: number;
  body: string | null;
  buyer: string;
  hidden: boolean;
  hiddenReason: string | null;
  productName: string;
  shopName: string;
  reports: { reason: string; createdAt: string }[];
};

/** Reported reviews, and reviews a moderator has hidden. Newest activity first. */
export async function loadReviewModerationQueue(): Promise<ModerationReview[]> {
  const rows = await prisma.productReview.findMany({
    where: { OR: [{ reports: { some: {} } }, { hiddenAt: { not: null } }] },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      stars: true,
      body: true,
      buyerEmail: true,
      hiddenAt: true,
      hiddenReason: true,
      product: { select: { name: true, shop: { select: { name: true } } } },
      reports: { orderBy: { createdAt: "desc" }, take: 5, select: { reason: true, createdAt: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    stars: row.stars,
    body: row.body,
    buyer: maskedBuyer(row.buyerEmail),
    hidden: row.hiddenAt !== null,
    hiddenReason: row.hiddenReason,
    productName: row.product.name,
    shopName: row.product.shop.name,
    reports: row.reports.map((report) => ({ reason: report.reason, createdAt: report.createdAt.toISOString() })),
  }));
}
