import type { ModerationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inspectDecision } from "@/lib/inspect";
import { isAllowedAssetUrl } from "@/lib/validations";
import {
  moderatorFileSafety,
  type ModeratorFileSafety,
} from "@/lib/moderator-file-status";

/**
 * The data behind the admin moderation preview.
 *
 * WHY THIS IS A SEPARATE MODULE. The preview page needs the scan columns to
 * derive a safety status, and it must never render them. Keeping the query
 * here means the page file contains no file-column identifier at all — not
 * `fileUrl`, not `fileKey`, not `fileScanKey` — so "the page cannot leak the
 * deliverable" is a property a reader (and a test) can check by looking, not
 * a discipline someone has to maintain while editing JSX.
 *
 * WHY IT DOES NOT REUSE THE STOREFRONT QUERY. The public product page filters
 * on `isActive`, `moderationStatus: "APPROVED"` and `SAFE_DELIVERABLE_WHERE`,
 * which is precisely why a moderator could not open a PENDING product through
 * it. This lookup is keyed on the product id and applies NONE of those
 * filters, because the unapproved and unscanned products are the ones
 * moderation exists to look at.
 *
 * That is safe only because of where the caller lives. The single route that
 * calls this sits under app/dashboard/admin/, whose layout redirects anyone
 * who is not a marketplace admin, and re-checks that itself. No public route
 * imports this module, and none may: the public gate is unchanged and stays
 * unchanged.
 */
export interface AdminProductPreview {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  /**
   * Preview imagery, filtered to SaiFlow's own storage hosts.
   *
   * The public product page can render these unfiltered because it only ever
   * renders APPROVED products whose file already passed scanning. This page
   * deliberately renders the opposite — unapproved, unscanned, seller-supplied
   * rows — so it is the one surface where a hostile or simply broken image URL
   * is most likely to arrive. Two things go wrong if it does: next/image
   * throws on a host that is not in remotePatterns, turning "let the moderator
   * look" back into an error page, and an arbitrary host would get a request
   * from an authenticated founder session.
   *
   * `isAllowedAssetUrl` is the same allowlist that guards what may be stored
   * in the first place; anything it rejects is dropped rather than rendered.
   */
  images: string[];
  thumbnailUrl: string | null;
  moderationStatus: ModerationStatus;
  isActive: boolean;
  createdAt: Date;
  shop: {
    name: string;
    slug: string;
  };
  /** A reason and a boolean. Never the columns it was derived from. */
  fileSafety: ModeratorFileSafety;
  /**
   * Whether /api/admin/inspect/[productId] would actually serve this file.
   *
   * Read from the same policy table the route enforces rather than from
   * "there is a key", so the preview never renders a link that can only 403 —
   * an UNSAFE file has no inspection path in D2 by design, and offering one
   * would misdescribe the product's state to the person deciding on it.
   *
   * This is a display hint. The route re-derives the decision itself and does
   * not trust anything computed here.
   */
  canInspect: boolean;
}

export async function getAdminProductPreview(
  id: string
): Promise<AdminProductPreview | null> {
  const product = await prisma.product.findUnique({
    // Id only. No moderation filter and no safety filter — see above.
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      currency: true,
      category: true,
      images: true,
      thumbnailUrl: true,
      moderationStatus: true,
      isActive: true,
      createdAt: true,
      // The three columns the safety derivation reads, and only those.
      // `fileUrl` is deliberately not selected: nothing here needs it, and
      // not selecting it is the cheapest guarantee it cannot be rendered.
      fileKey: true,
      fileScanStatus: true,
      fileScanKey: true,
      shop: {
        // No logo: the preview does not render one, and a column that is not
        // selected cannot be rendered by a later edit.
        select: { name: true, slug: true },
      },
    },
  });

  if (!product) return null;

  const fileSafety = moderatorFileSafety(product);

  // Rebuilt field by field rather than spread, so a column added to the
  // select above cannot reach the page by accident.
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: Number(product.price),
    currency: product.currency,
    category: product.category,
    images: product.images.filter(isAllowedAssetUrl),
    thumbnailUrl: isAllowedAssetUrl(product.thumbnailUrl)
      ? product.thumbnailUrl
      : null,
    moderationStatus: product.moderationStatus,
    isActive: product.isActive,
    createdAt: product.createdAt,
    shop: product.shop,
    fileSafety,
    canInspect: inspectDecision(fileSafety.reason, "admin").allow,
  };
}
