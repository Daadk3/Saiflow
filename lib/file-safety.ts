/**
 * The single definition of "this product's current deliverable has passed
 * scanning".
 *
 * It lives in one place because it will be consumed from at least three
 * separate gates — founder inspection, checkout, and buyer download — and each
 * one re-deriving it is an opportunity to get it subtly wrong.
 *
 * Nothing consumes it yet. The scanner arrives in Stage C; this exists first so
 * that when it does, the predicate is already fixed and tested.
 */

import type { FileScanStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** The three columns the predicate reads. */
export interface DeliverableSafety {
  fileKey: string | null;
  fileScanStatus: FileScanStatus;
  fileScanKey: string | null;
}

/**
 * The ONLY correct way to ask whether the file currently attached to a product
 * has passed scanning.
 *
 * Two mistakes this exists to prevent:
 *
 * 1. Testing `fileScanStatus === "SAFE"` alone. The status describes whichever
 *    file `fileScanKey` names, which is not necessarily the file attached now.
 *
 * 2. Testing `fileScanKey === fileKey` without the null guard. In JavaScript
 *    `null === null` is TRUE, so a product carrying no file at all would
 *    satisfy the comparison. The `fileKey !== null` clause is what stops a
 *    fileless product from ever looking safe.
 */
export function isDeliverableSafe(product: DeliverableSafety): boolean {
  return (
    product.fileKey !== null &&
    product.fileScanStatus === "SAFE" &&
    product.fileScanKey === product.fileKey
  );
}

/**
 * Database-level equivalent, for gating inside a query rather than filtering
 * after the fact.
 *
 * The column-to-column comparison uses a Prisma field reference, so the whole
 * predicate — including `fileScanKey = fileKey` — is evaluated by Postgres and
 * cannot be forgotten by a caller that only remembers the status.
 */
export const SAFE_DELIVERABLE_WHERE = {
  fileKey: { not: null },
  fileScanStatus: "SAFE",
  fileScanKey: { equals: prisma.product.fields.fileKey },
} satisfies Prisma.ProductWhereInput;
