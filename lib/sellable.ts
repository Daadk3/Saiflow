import type { ModerationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SAFE_DELIVERABLE_WHERE,
  deliverableGateReason,
  isDeliverableSafe,
  type DeliverableGateReason,
  type DeliverableSafety,
} from "@/lib/file-safety";

/**
 * What "a buyer can see and buy this product" means, in one place.
 *
 * Four conditions, ANDed:
 *   1. the product is active,
 *   2. a moderator approved it,
 *   3. its shop is active (not suspended), and
 *   4. its deliverable passed the safety check for the file attached now
 *      (SAFE_DELIVERABLE_WHERE / isDeliverableSafe, the reviewed authority).
 *
 * Every public surface (home, browse, store page, product page, checkout
 * page, sitemap) filters with SELLABLE_PRODUCT_WHERE, and the admin's "live"
 * counts use it too, so "live" means the same thing everywhere. Before this
 * the rule was copied by hand into each page, and the copies had drifted:
 * /browse never checked the shop.
 *
 * The in-memory twin, isSellable, applies the same rule to a row already
 * loaded, and unsellableReason says which condition failed first. Tests hold
 * the where-clause and the functions in agreement (tests/sellable.test.ts).
 *
 * The download route deliberately does NOT use this: a buyer who already
 * paid keeps their file even if the product is later unlisted. It still
 * requires the safety check (isDeliverableSafe) on every download.
 */

/** The shop half of the rule; exported so a query that also filters the shop (by slug) keeps it. */
export const SELLABLE_SHOP_WHERE = { isActive: true } satisfies Prisma.ShopWhereInput;

export const SELLABLE_PRODUCT_WHERE = {
  isActive: true,
  moderationStatus: "APPROVED",
  shop: SELLABLE_SHOP_WHERE,
  ...SAFE_DELIVERABLE_WHERE,
} satisfies Prisma.ProductWhereInput;

/**
 * Approved and active, but not sellable because of the file: the products a
 * founder must act on (ask for a file, retry a scan, or reject).
 *
 * Written as an explicit OR of the ways SAFE_DELIVERABLE_WHERE can fail,
 * rather than `NOT: SAFE_DELIVERABLE_WHERE`, because of SQL's NULLs: NOT over
 * a conjunction containing `fileScanKey = fileKey` evaluates to NULL (so the
 * row is dropped) whenever either key is NULL, which is exactly the fileless
 * case this list exists for. Each null case is therefore its own branch, and
 * the key comparison is negated only where both keys are non-null. Pinned by
 * tests/sellable.test.ts.
 *
 * A suspended shop's products are not listed here: suspension, not the file,
 * is why they are off sale.
 */
export const APPROVED_NOT_SELLABLE_WHERE = {
  isActive: true,
  moderationStatus: "APPROVED",
  shop: SELLABLE_SHOP_WHERE,
  OR: [
    { fileKey: null },
    { fileScanStatus: { not: "SAFE" } },
    { fileScanKey: null },
    { NOT: { fileScanKey: { equals: prisma.product.fields.fileKey } } },
  ],
} satisfies Prisma.ProductWhereInput;

export interface SellableFacts extends DeliverableSafety {
  isActive: boolean;
  moderationStatus: ModerationStatus;
  shop: { isActive: boolean };
}

export type UnsellableReason = "sellable" | "inactive" | "not_approved" | "shop_inactive" | Exclude<DeliverableGateReason, "safe">;

/**
 * Which condition fails first, in the order a founder would fix them: the
 * listing itself, then the decision, then the shop, then the file (with the
 * file's own reason from deliverableGateReason).
 */
export function unsellableReason(product: SellableFacts): UnsellableReason {
  if (!product.isActive) return "inactive";
  if (product.moderationStatus !== "APPROVED") return "not_approved";
  if (!product.shop.isActive) return "shop_inactive";
  const file = deliverableGateReason(product);
  return file === "safe" ? "sellable" : file;
}

/** The same rule as SELLABLE_PRODUCT_WHERE, for a row already loaded. */
export function isSellable(product: SellableFacts): boolean {
  return (
    product.isActive &&
    product.moderationStatus === "APPROVED" &&
    product.shop.isActive &&
    isDeliverableSafe(product)
  );
}
