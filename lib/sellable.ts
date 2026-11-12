import type { ModerationStatus, Prisma, ProductDeliveryType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  SAFE_DELIVERABLE_WHERE,
  deliverableGateReason,
  isDeliverableSafe,
  type DeliverableGateReason,
  type DeliverableSafety,
} from "@/lib/file-safety";
import { extrasAreSafe, noUnsafeExtrasWhere, unsafeExtraFilter } from "@/lib/product-deliverables";

export { noUnsafeExtrasWhere };

/**
 * What "a buyer can see and buy this product" means, in one place.
 *
 * Five conditions, ANDed:
 *   1. the product is active,
 *   2. a moderator approved it,
 *   3. its shop is active (not suspended),
 *   4. the founder has turned sales on for that shop, and
 *   5. its deliverable passed the safety check for the file attached now
 *      (SAFE_DELIVERABLE_WHERE / isDeliverableSafe, the reviewed authority).
 *
 * Sales on is a store switch, not an approval. A product still has to be
 * approved on its own. A store with sales off is absent from listings and
 * checkout; its product page can still open to say it is not for sale yet.
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
 * HOSTED ACCESS. Condition 4 depends on what the product delivers. A FILE
 * product (every existing row) needs exactly what it always needed:
 * SAFE_DELIVERABLE_WHERE. A HOSTED_ACCESS product (access to something the
 * seller hosts, such as an AI agent) has no file to scan; it needs its
 * private access record to exist instead. A hosted product carries no file
 * key, so the file branch can never match it, and a FILE product can never
 * match the hosted branch. The two branches sit under AND so a caller that
 * sets its own OR (browse's search) cannot overwrite them.
 *
 * In memory, a row loaded without `deliveryType` is treated as FILE, which
 * fails closed for a hosted row: it has no file, so it is never sellable
 * through a query that forgot to load the column.
 *
 * The download route deliberately does NOT use this: a buyer who already
 * paid keeps their file even if the product is later unlisted. It still
 * requires the safety check (isDeliverableSafe) on every download.
 */

/**
 * The shop half of the rule; exported so a query that also filters the shop
 * (by slug) keeps it. Sales stay off until the founder turns them on.
 */
export const SELLABLE_SHOP_WHERE = { isActive: true, salesEnabled: true } satisfies Prisma.ShopWhereInput;

/** Condition 4 for a HOSTED_ACCESS product: its private access record exists. */
export const HOSTED_ACCESS_READY_WHERE = {
  deliveryType: "HOSTED_ACCESS",
  hostedAccess: { isNot: null },
  // A hosted product has no deliverable files. Any extra row, scanned or
  // not, keeps it off sale until those rows are gone.
  deliverables: { none: {} },
} satisfies Prisma.ProductWhereInput;

export const SELLABLE_PRODUCT_WHERE = {
  isActive: true,
  moderationStatus: "APPROVED",
  shop: SELLABLE_SHOP_WHERE,
      AND: [
        {
          OR: [
            // Condition 4 for a FILE product: the reviewed safety clause, unchanged.
            {
              deliveryType: "FILE",
              ...SAFE_DELIVERABLE_WHERE,
            },
            HOSTED_ACCESS_READY_WHERE,
          ],
        },
        // Extra files, if any, must each be SAFE for their own key. No rows
        // means a single-file product, which passes.
        noUnsafeExtrasWhere(),
      ],
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
 * is why they are off sale. A shop with sales turned off is left out for the
 * same reason: the switch, not the file, is why they are off sale.
 */
export const APPROVED_NOT_SELLABLE_WHERE = {
  // File products only: a hosted product has no file by design, and is never
  // approvable without its access record (the moderation route).
  deliveryType: "FILE",
  isActive: true,
  moderationStatus: "APPROVED",
  shop: SELLABLE_SHOP_WHERE,
  OR: [
    { fileKey: null },
    { fileScanStatus: { not: "SAFE" } },
    { fileScanKey: null },
    { NOT: { fileScanKey: { equals: prisma.product.fields.fileKey } } },
    { deliverables: { some: unsafeExtraFilter() } },
  ],
} satisfies Prisma.ProductWhereInput;

export interface SellableFacts extends DeliverableSafety {
  isActive: boolean;
  moderationStatus: ModerationStatus;
  shop: { isActive: boolean; salesEnabled: boolean };
  /** Missing means FILE: see the note above. */
  deliveryType?: ProductDeliveryType;
  /** Only its presence is read; select an id, never the link. */
  hostedAccess?: object | null;
  /**
   * Extra files. An empty array is a loaded single-file product. Omitting
   * the field is not that: the relation was not retrieved, and the product
   * is not sellable until a query includes it.
   */
  deliverables?: DeliverableSafety[] | null;
}

export type UnsellableReason =
  | "sellable"
  | "inactive"
  | "not_approved"
  | "shop_inactive"
  | "sales_disabled"
  | "hosted_access_missing"
  | "hosted_has_files"
  | Exclude<DeliverableGateReason, "safe">;

/** Condition 4 in memory, per delivery type. */
function deliveryReason(
  product: SellableFacts
): "sellable" | "hosted_access_missing" | "hosted_has_files" | Exclude<DeliverableGateReason, "safe"> {
  if (product.deliveryType === "HOSTED_ACCESS") {
    if (!product.hostedAccess) return "hosted_access_missing";
    if (!Array.isArray(product.deliverables) || product.deliverables.length > 0) return "hosted_has_files";
    return "sellable";
  }
  const file = deliverableGateReason(product);
  if (file !== "safe") return file;
  if (!Array.isArray(product.deliverables)) return "pending_scan";
  for (const extra of product.deliverables) {
    const reason = deliverableGateReason(extra);
    if (reason !== "safe") return reason;
  }
  return "sellable";
}

/**
 * Which condition fails first, in the order a founder would fix them: the
 * listing itself, then the decision, then the shop (suspended before sales
 * off), then the file (with the file's own reason from deliverableGateReason).
 */
export function unsellableReason(product: SellableFacts): UnsellableReason {
  if (!product.isActive) return "inactive";
  if (product.moderationStatus !== "APPROVED") return "not_approved";
  if (!product.shop.isActive) return "shop_inactive";
  if (!product.shop.salesEnabled) return "sales_disabled";
  return deliveryReason(product);
}

/** The same rule as SELLABLE_PRODUCT_WHERE, for a row already loaded. */
export function isSellable(product: SellableFacts): boolean {
  return (
    product.isActive &&
    product.moderationStatus === "APPROVED" &&
    product.shop.isActive &&
    product.shop.salesEnabled &&
    (product.deliveryType === "HOSTED_ACCESS"
      ? Boolean(product.hostedAccess) &&
        Array.isArray(product.deliverables) &&
        product.deliverables.length === 0
      : isDeliverableSafe(product) && extrasAreSafe(product.deliverables))
  );
}
