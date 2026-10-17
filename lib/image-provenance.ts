import type { UploadRoute } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractOwnAssetKey } from "@/lib/validations";

/**
 * Prove that a picture may be shown as this shop's: a product thumbnail, the
 * shop's logo, or its cover.
 *
 * The deliverable has had this check for a long time
 * (`verifyDeliverableProvenance` in lib/file-safety). Pictures only had a
 * host check, which proves an image is on SaiFlow's storage but not whose it
 * is, so one seller could put another shop's logo, or any other SaiFlow
 * image, on their own storefront. Every upload route records a FileAsset row
 * from server-verified middleware (app/api/uploadthing/core.ts), so the
 * shop and the route of an upload are facts we already hold.
 *
 * Callers check a picture only when it CHANGES. A picture saved before
 * uploads were recorded has no row, and re-saving a form must not fail on a
 * value the seller did not touch.
 *
 * Fails closed: an unconfigured storage app id, a URL that is not ours, an
 * upload we never recorded, another shop's upload, or an upload made through
 * a different route are all refused.
 */

export type ImageRoute = Extract<UploadRoute, "PRODUCT_THUMBNAIL" | "SHOP_LOGO" | "SHOP_COVER">;
export type ImageProvenanceFailure = "not_ours" | "missing" | "wrong_shop" | "wrong_route";
export type ImageProvenanceResult = { ok: true } | { ok: false; reason: ImageProvenanceFailure };

/** The decision itself, separated from the lookup so every branch can be tested directly. */
export function imageProvenanceVerdict(
  asset: { shopId: string; route: UploadRoute } | null,
  shopId: string,
  route: ImageRoute
): ImageProvenanceResult {
  if (!asset) return { ok: false, reason: "missing" };
  if (asset.shopId !== shopId) return { ok: false, reason: "wrong_shop" };
  if (asset.route !== route) return { ok: false, reason: "wrong_route" };
  return { ok: true };
}

export async function verifyImageProvenance(
  url: unknown,
  shopId: string,
  route: ImageRoute
): Promise<ImageProvenanceResult> {
  const key = extractOwnAssetKey(url);
  if (!key) return { ok: false, reason: "not_ours" };
  const asset = await prisma.fileAsset.findUnique({
    where: { key },
    select: { shopId: true, route: true },
  });
  return imageProvenanceVerdict(asset, shopId, route);
}

/** The one refusal every route sends, whatever the reason: a seller learns nothing about other shops' uploads. */
export const IMAGE_NOT_ALLOWED = {
  // The forms show `error` as written, like every other refusal from these routes.
  error: "This image can't be used here. Please upload it again from this page.",
  code: "image_not_allowed",
} as const;
