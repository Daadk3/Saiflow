/**
 * Turns a seller's listing payload into columns for Product create and update.
 *
 * A key that is absent, or present and undefined, is left alone: an older
 * client that does not know about these fields cannot clear them. `null`
 * clears. The checks themselves are in lib/product-landing.
 */
import { Prisma } from "@prisma/client";
import { parseCompareAt, parseLanding, type ListingError } from "@/lib/product-landing";

export interface ListingColumns {
  compareAtPrice?: string | null;
  landing?: Prisma.InputJsonValue | typeof Prisma.DbNull;
}

export type ListingWrite =
  | { ok: true; data: ListingColumns }
  | ListingError;

export function listingWrite(source: object, sellingPrice: string): ListingWrite {
  const record = source as Record<string, unknown>;
  const data: ListingColumns = {};

  if ("compareAtPrice" in record && record.compareAtPrice !== undefined) {
    const parsed = parseCompareAt(record.compareAtPrice, sellingPrice);
    if (!parsed.ok) return parsed;
    data.compareAtPrice = parsed.compareAtPrice;
  }

  if ("landing" in record && record.landing !== undefined) {
    const parsed = parseLanding(record.landing);
    if (!parsed.ok) return parsed;
    // SQL NULL, not JSON null, so a cleared page reads the same as one that
    // never had sections.
    data.landing = parsed.landing === null ? Prisma.DbNull : (parsed.landing as unknown as Prisma.InputJsonValue);
  }

  return { ok: true, data };
}
