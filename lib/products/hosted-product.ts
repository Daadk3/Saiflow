import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { isAllowedAssetUrl } from "@/lib/validations";
import { IMAGE_NOT_ALLOWED, verifyImageProvenance } from "@/lib/image-provenance";
import { isProductCategory } from "@/lib/categories";
import { refreshReviewChecks } from "@/lib/review-checks-store";
import { withoutReviewChecks } from "@/lib/review-checklist";
import { priceProblemMessage, validatePrice } from "@/lib/pricing";
import { listingWrite } from "@/lib/products/listing-write";
import { getAdminEmails } from "@/lib/admin";
import { adminProductReviewUrl } from "@/lib/notification-links";
import { redactId } from "@/lib/redact-id";
import { runAfterResponse } from "@/lib/after-response";
import {
  HOSTED_ACCESS_PROBLEM_MESSAGES,
  validateAccessInstructions,
  validateHostedUrl,
  type HostedUrlProblem,
  type InstructionsProblem,
} from "@/lib/hosted-access/validate";

/**
 * Create and edit for HOSTED_ACCESS products (access to something the seller
 * hosts, such as an AI agent).
 *
 * Kept apart from lib/products/create-product and the file branch of
 * PUT /api/products/[id] on purpose: those paths are the file-safety gates'
 * front door and stay byte-for-byte what they were. A hosted product never
 * has a fileUrl or fileKey, so every file gate (checkout's, download's,
 * approval's) keeps refusing it by data shape, and only the hosted branches
 * added beside them can sell, approve or deliver one.
 *
 * The private details live in HostedAccess, never in name or description,
 * and are returned only to the shop's own members.
 */

function refusal(problem: HostedUrlProblem | InstructionsProblem, field: "accessUrl" | "accessInstructions") {
  const message = HOSTED_ACCESS_PROBLEM_MESSAGES[problem];
  return NextResponse.json(
    { error: message.en, errorAr: message.ar, code: `hosted_${problem}`, field },
    { status: 400 }
  );
}

/** Both private fields, validated together. */
function checkHostedFields(accessUrl: unknown, accessInstructions: unknown) {
  const url = validateHostedUrl(accessUrl);
  if (!url.ok) return { ok: false as const, response: refusal(url.problem, "accessUrl") };
  const instructions = validateAccessInstructions(accessInstructions);
  if (!instructions.ok) return { ok: false as const, response: refusal(instructions.problem, "accessInstructions") };
  return { ok: true as const, accessUrl: url.value, instructions: instructions.value };
}

/**
 * The founder hears about a new hosted product straight away: there is no
 * file scan whose verdict would announce it. Never throws, never sends the
 * link itself, only a pointer to the admin review page.
 */
async function announceHostedForReview(product: { id: string; name: string; shopName: string }): Promise<void> {
  try {
    // Loaded here rather than at the top so this module stays importable
    // wherever the notifier is stubbed.
    const { sendNotification } = await import("@/lib/notify");
    await sendNotification({
      kind: "ready_for_review",
      ref: product.id,
      to: getAdminEmails(),
      subject: `منتج وصول مستضاف بانتظار المراجعة: ${product.name}`,
      heading: {
        ar: "منتج وصول مستضاف (مثل وكيل ذكاء اصطناعي) بانتظار اعتمادك",
        en: "A hosted-access product (e.g. an AI agent) awaits your approval",
      },
      lines: [
        { ar: `المنتج: ${product.name}`, en: `Product: ${product.name}` },
        { ar: `المتجر: ${product.shopName}`, en: `Store: ${product.shopName}` },
        { ar: "راجع الرابط والتعليمات قبل الاعتماد.", en: "Check the link and instructions before approving." },
      ],
      link: { url: adminProductReviewUrl(product.id), label: { ar: "مراجعة المنتج الآن", en: "Review now" } },
    });
  } catch (error) {
    console.error("[notify] hosted announce failed", (error as Error)?.name);
  }
}

export async function createHostedProductForSeller(
  user: { id: string },
  input: {
    name: unknown;
    description: unknown;
    price: unknown;
    category: unknown;
    shopId: unknown;
    thumbnailUrl: unknown;
    currency: unknown;
    certified: unknown;
    accessUrl: unknown;
    accessInstructions: unknown;
    hostedAccessCertified: unknown;
    compareAtPrice?: unknown;
    landing?: unknown;
  }
): Promise<NextResponse> {
  const { name, description, price, category, shopId, thumbnailUrl, currency, certified } = input;
  try {
    if (certified !== true) {
      return NextResponse.json(
        { error: "You must accept the seller certification to publish a product." },
        { status: 400 }
      );
    }
    // A second, specific promise: the access note is not a place for secrets.
    if (input.hostedAccessCertified !== true) {
      return NextResponse.json(
        {
          error: "Confirm that the access link and instructions contain no passwords, keys, payment details or patient data.",
          code: "hosted_certification_required",
        },
        { status: 400 }
      );
    }
    if (!name || price === undefined || price === null || typeof shopId !== "string" || !shopId) {
      return NextResponse.json({ error: "Name, price, and shopId are required" }, { status: 400 });
    }
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 200) {
      return NextResponse.json({ error: "Product name must be between 2 and 200 characters" }, { status: 400 });
    }
    const priceCheck = validatePrice(price);
    if (!priceCheck.ok) {
      return NextResponse.json({ error: priceProblemMessage(priceCheck.reason) }, { status: 400 });
    }
    if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 10000)) {
      return NextResponse.json({ error: "Description must be less than 10,000 characters" }, { status: 400 });
    }
    const listing = listingWrite(input, priceCheck.price);
    if (!listing.ok) {
      return NextResponse.json({ error: listing.error, errorAr: listing.errorAr }, { status: 400 });
    }
    if (thumbnailUrl && !isAllowedAssetUrl(thumbnailUrl)) {
      return NextResponse.json({ error: "Invalid thumbnail URL" }, { status: 400 });
    }
    if (category && !isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    if (currency && currency !== "SAR") {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }

    const shopUser = await prisma.shopUser.findFirst({
      where: { userId: user.id, shopId },
      select: { id: true, shop: { select: { name: true } } },
    });
    if (!shopUser) {
      return NextResponse.json({ error: "You don't have access to this shop" }, { status: 403 });
    }

    // After membership, so an outsider learns nothing about the rules.
    const fields = checkHostedFields(input.accessUrl, input.accessInstructions);
    if (!fields.ok) return fields.response;

    if (thumbnailUrl) {
      const image = await verifyImageProvenance(thumbnailUrl, shopId, "PRODUCT_THUMBNAIL");
      if (!image.ok) return NextResponse.json(IMAGE_NOT_ALLOWED, { status: 400 });
    }

    const slug = slugify(name, "product");
    const now = new Date();
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name: name.trim(),
          slug,
          description: typeof description === "string" ? description : null,
          price: priceCheck.price,
          ...listing.data,
          category: isProductCategory(category) ? category : null,
          shopId,
          deliveryType: "HOSTED_ACCESS",
          // No file, ever: every file gate refuses this row by its shape.
          fileUrl: null,
          fileKey: null,
          thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : null,
          currency: "SAR",
          certifiedAt: now,
          hostedAccess: { create: { accessUrl: fields.accessUrl, instructions: fields.instructions } },
          // moderationStatus defaults to PENDING.
        },
      });
      await tx.moderationEvent.create({
        data: {
          productId: created.id,
          action: "SUBMITTED",
          actor: `seller:${user.id}`,
          reason: "Seller certified ownership, legality, and responsibility, and that the hosted access details contain no secrets or patient data.",
          previousStatus: null,
          newStatus: "PENDING",
        },
      });
      return created;
    });

    await refreshReviewChecks(product.id);
    await runAfterResponse(() =>
      announceHostedForReview({ id: product.id, name: product.name, shopName: shopUser.shop.name })
    );
    console.log(`[products] hosted product created product=${redactId(product.id)}`);

    return NextResponse.json(withoutReviewChecks(product), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error creating hosted product:", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * Edit of a HOSTED_ACCESS product, called by PUT /api/products/[id] after it
 * has loaded the row and proven the caller is a member of its shop.
 *
 * Any change to the link or instructions sends an APPROVED product back to
 * review, exactly as replacing a file does: approval was a decision about
 * what the admin looked at. A REJECTED product returns to review on any
 * save, as file products do.
 */
export async function updateHostedProduct(
  user: { id: string },
  product: {
    id: string;
    name: string;
    description: string | null;
    price: Prisma.Decimal;
    category: string | null;
    thumbnailUrl: string | null;
    shopId: string;
    moderationStatus: "PENDING" | "APPROVED" | "REJECTED";
    shop: { isActive: boolean; name: string };
  },
  body: Record<string, unknown>
): Promise<NextResponse> {
  const { name, description, price, category, thumbnailUrl } = body;

  // A hosted product never takes a file. Refused rather than ignored, so a
  // client cannot believe it attached one.
  if (body.fileUrl !== undefined && body.fileUrl !== null && body.fileUrl !== "") {
    return NextResponse.json(
      { error: "This product gives buyers hosted access, so it has no file.", code: "hosted_no_file" },
      { status: 400 }
    );
  }
  if (category && !isProductCategory(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  let nextPrice: string | undefined;
  if (price !== undefined) {
    const priceCheck = validatePrice(price);
    if (!priceCheck.ok) return NextResponse.json({ error: priceProblemMessage(priceCheck.reason) }, { status: 400 });
    nextPrice = priceCheck.price;
  }
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2 || name.length > 200)) {
    return NextResponse.json({ error: "Product name must be between 2 and 200 characters" }, { status: 400 });
  }
  if (description !== undefined && description !== null && (typeof description !== "string" || description.length > 10000)) {
    return NextResponse.json({ error: "Description must be less than 10,000 characters" }, { status: 400 });
  }
  const listing = listingWrite(body, nextPrice !== undefined ? nextPrice : String(product.price));
  if (!listing.ok) {
    return NextResponse.json({ error: listing.error, errorAr: listing.errorAr }, { status: 400 });
  }
  if (thumbnailUrl !== undefined && thumbnailUrl !== null && thumbnailUrl !== "" && !isAllowedAssetUrl(thumbnailUrl)) {
    return NextResponse.json({ error: "Invalid thumbnail URL" }, { status: 400 });
  }
  if (typeof thumbnailUrl === "string" && thumbnailUrl && thumbnailUrl !== product.thumbnailUrl) {
    const image = await verifyImageProvenance(thumbnailUrl, product.shopId, "PRODUCT_THUMBNAIL");
    if (!image.ok) return NextResponse.json(IMAGE_NOT_ALLOWED, { status: 400 });
  }

  const current = await prisma.hostedAccess.findUnique({
    where: { productId: product.id },
    select: { accessUrl: true, instructions: true },
  });
  // Both fields are always sent by the edit form; when omitted the stored
  // values stand (and are re-validated, so an old row fails closed).
  const fields = checkHostedFields(
    body.accessUrl !== undefined ? body.accessUrl : current?.accessUrl,
    body.accessInstructions !== undefined ? body.accessInstructions : current?.instructions
  );
  if (!fields.ok) return fields.response;
  const accessChanged =
    !current || current.accessUrl !== fields.accessUrl || (current.instructions ?? null) !== fields.instructions;

  if (accessChanged && body.hostedAccessCertified !== true) {
    return NextResponse.json(
      {
        error: "Confirm that the access link and instructions contain no passwords, keys, payment details or patient data.",
        code: "hosted_certification_required",
      },
      { status: 400 }
    );
  }

  try {
    // A rejection reopens on any save, unless the shop is suspended (as with
    // file products). An approval reopens whenever the access details change,
    // suspended shop or not: it may never stand on details nobody reviewed.
    const reopenFrom =
      (product.moderationStatus === "REJECTED" && product.shop.isActive) ||
      (product.moderationStatus === "APPROVED" && accessChanged)
        ? product.moderationStatus
        : null;

    const { updated, resubmitted } = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: product.id },
        data: {
          name: typeof name === "string" && name ? name.trim() : product.name,
          description: description !== undefined ? (description as string | null) : product.description,
          price: nextPrice !== undefined ? nextPrice : product.price,
          ...listing.data,
          category: category !== undefined ? ((category as string) || null) : product.category,
          thumbnailUrl: thumbnailUrl !== undefined ? ((thumbnailUrl as string) || null) : product.thumbnailUrl,
        },
      });
      if (accessChanged) {
        await tx.hostedAccess.upsert({
          where: { productId: product.id },
          create: { productId: product.id, accessUrl: fields.accessUrl, instructions: fields.instructions },
          update: { accessUrl: fields.accessUrl, instructions: fields.instructions },
        });
      }
      let resubmitted = false;
      if (reopenFrom) {
        // Conditional on the status still being what was read, in the same
        // transaction as the access write: an approval racing this edit
        // either sees the new details or is overwritten back to PENDING.
        const reopened = await tx.product.updateMany({
          where: { id: product.id, moderationStatus: reopenFrom },
          data: { moderationStatus: "PENDING" },
        });
        if (reopened.count === 1) {
          await tx.moderationEvent.create({
            data: {
              productId: product.id,
              action: "RESUBMITTED",
              actor: `seller:${user.id}`,
              reason: reopenFrom === "APPROVED" ? "Hosted access link or instructions changed after approval" : null,
              previousStatus: reopenFrom,
              newStatus: "PENDING",
            },
          });
          resubmitted = true;
        }
      }
      return { updated, resubmitted };
    });

    await refreshReviewChecks(product.id);
    if (resubmitted) {
      await runAfterResponse(() =>
        announceHostedForReview({ id: updated.id, name: updated.name, shopName: product.shop.name })
      );
    }
    const sellerProduct = withoutReviewChecks(updated);
    return NextResponse.json(resubmitted ? { ...sellerProduct, moderationStatus: "PENDING" } : sellerProduct);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A product with a similar name already exists in this shop. Try a different name." },
        { status: 400 }
      );
    }
    console.error("Error updating hosted product:", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
