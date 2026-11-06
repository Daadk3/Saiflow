import type { ModerationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { inspectProduct } from "@/lib/inspect";
import {
  explainScanReason,
  type ScanExplanationKey,
} from "@/lib/scan-explanation";
import { isAllowedAssetUrl } from "@/lib/validations";
import { unsellableReason, type UnsellableReason } from "@/lib/sellable";
import { isDeliverableSafe } from "@/lib/file-safety";
import {
  AUTOMATIC_CHECK_LABELS,
  LISTING_STANDARDS,
  MIN_DESCRIPTION_LENGTH,
  type ListingCheck,
} from "@/lib/listing-standards";
import { checklistRows, hasCoverImage, type ChecklistRow } from "@/lib/review-checklist";
import { isLocalHtmlAppReview } from "@/lib/local-html-review";
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
  /**
   * A reason and a boolean, plus an allowlisted explanation when the file is
   * blocked. Never the columns it was derived from, and never the raw
   * `scanReason` string: `blockedBecause` is null when the stored token is
   * missing or not one this build knows.
   */
  fileSafety: ModeratorFileSafety & { blockedBecause: ScanExplanationKey | null };
  /**
   * Whether /api/admin/inspect/[productId] would actually serve this file.
   *
   * `inspectProduct` is the function the route calls, including its refusal
   * of a scan status this build does not recognise. A key is not enough: an
   * UNSAFE file has no inspection path, and offering one would misdescribe
   * the product to the person deciding on it.
   *
   * This is a display hint. The route re-derives the decision itself and does
   * not trust anything computed here.
   */
  canInspect: boolean;
  /** FILE, or HOSTED_ACCESS for access to something the seller hosts. */
  deliveryType: "FILE" | "HOSTED_ACCESS";
  /** Why an APPROVED product is still not on sale (lib/sellable), or null. */
  notSellableReason: UnsellableReason | null;
  /**
   * The founder's 8-point review checklist (lib/review-checklist): stored
   * auto-checks for points 3, 6 and 7, manual review for the rest. It
   * replaced the "Before approving" list from listingChecks on this page.
   */
  checklist: ChecklistRow[];
  /**
   * True when the attached file's scan facts name the local HTML app archive.
   * A boolean, never the stored JSON: extra fields on that object must not
   * reach the page. It does not approve anything and it does not change delivery.
   */
  localHtmlApp: boolean;
}

/**
 * The review checklist for one product. Pass or fail only where the server
 * can tell (the file's safety check, a preview image, a description long
 * enough to say what's included); every listing standard follows as a manual
 * check, because only a person can judge whether the file matches or the
 * listing is honest.
 */
export function listingChecks(product: {
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
  thumbnailUrl: string | null;
  images: string[];
  description: string | null;
}): ListingCheck[] {
  const safe = isDeliverableSafe(product as Parameters<typeof isDeliverableSafe>[0]);
  const hasPreview = Boolean(product.thumbnailUrl || product.images[0]);
  const longEnough = (product.description ?? "").trim().length >= MIN_DESCRIPTION_LENGTH;
  return [
    { key: "file_safe", label: AUTOMATIC_CHECK_LABELS.file_safe, state: safe ? "pass" : "fail" },
    { key: "preview_image", label: AUTOMATIC_CHECK_LABELS.preview_image, state: hasPreview ? "pass" : "fail" },
    { key: "description_length", label: AUTOMATIC_CHECK_LABELS.description_length, state: longEnough ? "pass" : "fail" },
    ...LISTING_STANDARDS.map((standard, i) => ({ key: `standard_${i + 1}`, label: standard, state: "manual" as const })),
  ];
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
      reviewChecks: true,
      // What it delivers, and only whether its private access record exists:
      // the link itself is loaded separately (lib/hosted-access/admin).
      deliveryType: true,
      hostedAccess: { select: { productId: true } },
      deliverables: { select: { fileKey: true, fileScanStatus: true, fileScanKey: true } },
      shop: {
        // No logo: the preview does not render one, and a column that is not
        // selected cannot be rendered by a later edit. isActive feeds the
        // sellable reason only.
        select: { name: true, slug: true, isActive: true },
      },
    },
  });

  if (!product) return null;

  const gate = moderatorFileSafety(product);

  // The specific category lives on the upload, not on the product. Read only
  // for a file the gate has already called unsafe, and only the reason
  // column. `explainScanReason` drops anything it does not recognise, so the
  // value that leaves this function is a key from a fixed list or null.
  let blockedBecause: ScanExplanationKey | null = null;
  let localHtmlApp = false;
  if (product.fileKey) {
    const asset = await prisma.fileAsset.findUnique({
      where: { key: product.fileKey },
      select: { scanReason: true, contentFacts: true },
    });
    if (gate.reason === "unsafe") blockedBecause = explainScanReason(asset?.scanReason);
    localHtmlApp = isLocalHtmlAppReview(asset?.contentFacts);
  }
  const fileSafety = { ...gate, blockedBecause };

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
    shop: { name: product.shop.name, slug: product.shop.slug },
    fileSafety,
    canInspect: inspectProduct(product, "admin").decision.allow,
    deliveryType: product.deliveryType,
    notSellableReason:
      product.moderationStatus === "APPROVED" && unsellableReason(product) !== "sellable"
        ? unsellableReason(product)
        : null,
    // The stored auto-checks, resolved against the file the product has now.
    // Points 2 and 8 carry the old "Before approving" facts as hints, from
    // the same allowlisted images the page shows.
    checklist: checklistRows(product.reviewChecks, product.fileKey, {
      description: product.description,
      hasCover: hasCoverImage(product, isAllowedAssetUrl),
    }),
    localHtmlApp,
  };
}
