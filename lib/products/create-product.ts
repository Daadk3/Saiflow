import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { isAllowedAssetUrl, extractOwnAssetKey } from "@/lib/validations";
import { IMAGE_NOT_ALLOWED, verifyImageProvenance } from "@/lib/image-provenance";
import { FILE_REQUIRED } from "@/lib/product-file-required";
import {
  verifyDeliverableProvenance,
  attachedScanFields,
  reconcileProductScanState,
} from "@/lib/file-safety";
import { isProductCategory } from "@/lib/categories";
import { scheduleScan } from "@/lib/scan/schedule";
import { announceReadyAtAttach } from "@/lib/scan/announce";
import { refreshReviewChecks } from "@/lib/review-checks-store";
import { withoutReviewChecks } from "@/lib/review-checklist";
import { priceProblemMessage, validatePrice } from "@/lib/pricing";

/**
 * Shared product create for the dashboard and the founder bot.
 *
 * This lives outside `app/api/products/route.ts` because a Next.js route file
 * may only export HTTP handlers and route config. Exporting this function from
 * the route makes `next build` reject the file. The checks themselves are
 * unchanged.
 */

export async function createProductForSeller(
  user: { id: string },
  input: {
    name: unknown;
    description: unknown;
    price: unknown;
    category: unknown;
    shopId: unknown;
    fileUrl: unknown;
    thumbnailUrl: unknown;
    currency: unknown;
    certified: unknown;
  },
  audit?: { actor: string; reason: string }
): Promise<NextResponse> {
  const { name, description, price, category, shopId, fileUrl, thumbnailUrl, currency, certified } = input;
  try {
    // Trust & Safety: the seller must explicitly certify ownership, legality
    // under Saudi regulations, and responsibility before every upload.
    if (certified !== true) {
      return NextResponse.json(
        { error: "You must accept the seller certification to publish a product." },
        { status: 400 }
      );
    }

    if (!name || price === undefined || price === null || typeof shopId !== "string" || !shopId) {
      return NextResponse.json(
        { error: "Name, price, and shopId are required" },
        { status: 400 }
      );
    }

    // Bounds validation
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 200) {
      return NextResponse.json(
        { error: "Product name must be between 2 and 200 characters" },
        { status: 400 }
      );
    }
    // The one price validator (lib/pricing): exact halalas, two decimals at
    // most, within the ceiling. The edit route uses the same one, so the two
    // cannot disagree, and the stored value is the exact two-decimal string.
    const priceCheck = validatePrice(price);
    if (!priceCheck.ok) {
      return NextResponse.json({ error: priceProblemMessage(priceCheck.reason) }, { status: 400 });
    }
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 10000)) {
      return NextResponse.json(
        { error: "Description must be less than 10,000 characters" },
        { status: 400 }
      );
    }
    // The deliverable's storage key is derived from the URL, never accepted
    // from the client, so `fileUrl` and `fileKey` can never describe different
    // objects.
    //
    // extractOwnAssetKey additionally requires the URL to sit on SaiFlow's own
    // UploadThing app. Without that, a shop member could reference a file
    // uploaded to a personal UploadThing account and bypass the type and size
    // allowlist completely. A new product has no legacy value to preserve, so
    // the strict check always applies here.
    const fileKey = fileUrl ? extractOwnAssetKey(fileUrl) : null;
    if (fileUrl && !fileKey) {
      return NextResponse.json(
        { error: "Invalid file URL" },
        { status: 400 }
      );
    }
    if (thumbnailUrl && !isAllowedAssetUrl(thumbnailUrl)) {
      return NextResponse.json(
        { error: "Invalid thumbnail URL" },
        { status: 400 }
      );
    }
    // Category must come from the shared taxonomy (lib/categories.ts). An
    // unconstrained value would leave the product live but invisible to every
    // browse filter.
    if (category && !isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    // Saudi-first marketplace: only SAR is supported. Reject any
    // explicit non-SAR currency loudly so future multi-currency
    // attempts fail visibly instead of silently writing USD again.
    const ALLOWED_CURRENCIES = ["SAR"];
    if (currency && (typeof currency !== "string" || !ALLOWED_CURRENCIES.includes(currency))) {
      return NextResponse.json(
        { error: "Invalid currency" },
        { status: 400 }
      );
    }

    // Verify user owns this shop
    const shopUser = await prisma.shopUser.findFirst({
      where: {
        userId: user.id,
        shopId: shopId,
      },
    });

    if (!shopUser) {
      return NextResponse.json(
        { error: "You don't have access to this shop" },
        { status: 403 }
      );
    }

    /**
     * Provenance: the key must have been uploaded through the product-file
     * route, for THIS shop. Host pinning proved the object is SaiFlow's; this
     * proves it is this seller's, and that it was not uploaded as a logo or
     * thumbnail under different size and ACL rules.
     *
     * Checked after shop membership, so an outsider is refused before any
     * lookup reveals whether a key exists.
     */
    // A product without its deliverable is not a product: refused here, not
    // just disabled in the form (lib/product-file-required). After the
    // membership check, so an outsider is always refused as an outsider.
    if (!fileKey || typeof fileUrl !== "string") {
      return NextResponse.json(FILE_REQUIRED, { status: 400 });
    }
    const provenance = await verifyDeliverableProvenance(fileKey, shopId);
    if (!provenance.ok) {
      return NextResponse.json(
        { error: "This file cannot be attached to a product." },
        { status: 400 }
      );
    }
    const scanFields = attachedScanFields(provenance.asset);

    // The thumbnail, likewise: uploaded through the thumbnail route, for
    // this shop (lib/image-provenance).
    if (thumbnailUrl) {
      const image = await verifyImageProvenance(thumbnailUrl, shopId, "PRODUCT_THUMBNAIL");
      if (!image.ok) return NextResponse.json(IMAGE_NOT_ALLOWED, { status: 400 });
    }

    // Create slug from name (falls back to a random handle for non-Latin names)
    const slug = slugify(name, "product");

    // Create the product (PENDING by default) + its audit-trail entry
    // atomically: certification without an audit event would be unprovable.
    const now = new Date();
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: name.trim(),
          slug,
          description: typeof description === "string" ? description : null,
          price: priceCheck.price,
          category: isProductCategory(category) ? category : null,
          shopId,
          fileUrl,
          fileKey,
          ...scanFields,
          thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : null,
          currency: "SAR",
          certifiedAt: now,
          // moderationStatus defaults to PENDING via schema.
          // fileScanStatus defaults to PENDING_SCAN, and fileScanKey stays
          // null — so the safety predicate is false for a brand-new product
          // without anything here having to say so.
        },
      });
      // Dashboard uploads stay `seller:<id>`. The founder bot passes its own
      // actor; anything else is ignored so a caller cannot pretend to be an admin.
      const submitted =
        audit && (audit.actor.startsWith("seller:") || audit.actor.startsWith("founder-bot:"))
          ? audit
          : {
              actor: `seller:${user.id}`,
              reason: "Seller certified ownership, legality, and responsibility at upload.",
            };
      await tx.moderationEvent.create({
        data: {
          productId: created.id,
          action: "SUBMITTED",
          actor: submitted.actor,
          reason: submitted.reason,
          previousStatus: null, // product creation — no prior state
          newStatus: "PENDING",
        },
      });
      return created;
    });

    /**
     * Close the attach/scan race. If the worker settled this file between the
     * provenance read above and this insert, its key-bound update found no
     * product and the row would sit PENDING_SCAN forever. This copies the
     * terminal verdict across; it never invents one.
     *
     * Isolated because the product is already saved and already fail-closed —
     * a reconciliation failure must not turn a successful save into an error.
     */
    if (fileKey) {
      // The file already had a verdict and the insert above carried it. If
      // that verdict is a pass, nothing downstream will announce the product
      // (the worker skips a settled file, the reconciliation only moves
      // PENDING_SCAN rows), so the founder hears about it from here — after
      // the commit, after the response, and never at the seller's expense.
      try {
        await announceReadyAtAttach(product);
      } catch (error) {
        console.error("[notify] announce after create failed", (error as Error)?.name);
      }
      try {
        await reconcileProductScanState(product.id, fileKey);
      } catch (error) {
        console.error("[scan] reconcile after create failed", (error as Error)?.name);
      }
      // The founder's checklist auto-checks (flags only). Never throws.
      await refreshReviewChecks(product.id);
      // The file is attached: scan it now rather than at the next sweep.
      scheduleScan(fileKey);
    }

    // Never the founder's review flags (admin-only).
    return NextResponse.json(withoutReviewChecks(product), { status: 201 });
  } catch (error) {
    // Unique-constraint race on (shopId, slug): return a friendly error, not a 500
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error creating product:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}