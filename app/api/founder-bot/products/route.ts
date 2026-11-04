import { NextResponse } from "next/server";

import { createProductForSeller } from "@/app/api/products/route";
import { recordProvenance } from "@/app/api/uploadthing/core";
import { isProductCategory } from "@/lib/categories";
import { authorizeFounderBot } from "@/lib/founder-bot/gate";
import { founderOwnsShop, loadFounderUser } from "@/lib/founder-bot/owner";
import { uploadAcceptedFile } from "@/lib/founder-bot/upload";
import { redactId } from "@/lib/redact-id";
import { checklistRows } from "@/lib/review-checklist";
import { accountKey, rateLimiters, retryAfterSeconds } from "@/lib/rate-limit";
import { decideUpload } from "@/lib/upload-accept";
import { PRODUCT_FILE_CONFIG, PRODUCT_THUMBNAIL_CONFIG } from "@/lib/upload-config";
import { isAllowedAssetUrl } from "@/lib/validations";
import { prisma } from "@/lib/prisma";

// The product file is scanned after this response, same budget as a dashboard upload.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Largest body we will read: the biggest deliverable plus a cover and form overhead. */
const MAX_BODY_BYTES = 150 * 1024 * 1024;

async function requireFounder(req: Request) {
  const gate = authorizeFounderBot(req);
  if (!gate.ok) return gate;
  const user = await loadFounderUser(gate.email);
  if (!user) {
    return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { ok: true as const, user, email: gate.email };
}

function textField(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" ? value : null;
}

function isUpload(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

/** Keep the extension, drop path pieces and control characters. */
function uploadName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? "").replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const cleaned = base.slice(0, 180);
  return cleaned.length > 0 ? cleaned : "file";
}

async function namedFile(file: File): Promise<File> {
  const name = uploadName(file.name || "file");
  if (name === file.name) return file;
  return new File([await file.arrayBuffer()], name, { type: file.type });
}

/**
 * The founder's products and their moderation status.
 * Optional `shopId` limits the list to one store she owns.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireFounder(req);
    if (!auth.ok) return auth.response;

    const shopId = new URL(req.url).searchParams.get("shopId");
    if (shopId !== null) {
      if (shopId.length < 1 || shopId.length > 64) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const owns = await founderOwnsShop(auth.user.id, shopId);
      if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const products = await prisma.product.findMany({
      where: {
        ...(shopId ? { shopId } : {}),
        shop: { shopUsers: { some: { userId: auth.user.id, role: "OWNER" } } },
      },
      orderBy: { createdAt: "desc" },
      take: 51,
      select: {
        id: true,
        shopId: true,
        name: true,
        slug: true,
        description: true,
        price: true,
        currency: true,
        category: true,
        moderationStatus: true,
        fileScanStatus: true,
        fileKey: true,
        thumbnailUrl: true,
        reviewChecks: true,
        createdAt: true,
      },
    });

    const truncated = products.length > 50;
    return NextResponse.json({
      products: products.slice(0, 50).map((product) => ({
        id: product.id,
        shopId: product.shopId,
        name: product.name,
        slug: product.slug,
        price: product.price,
        currency: product.currency,
        category: product.category,
        moderationStatus: product.moderationStatus,
        fileScanStatus: product.fileScanStatus,
        createdAt: product.createdAt,
        // The same eight points the review queue shows. Flags only.
        checklist: checklistRows(product.reviewChecks, product.fileKey, {
          description: product.description,
          hasCover: isAllowedAssetUrl(product.thumbnailUrl),
        }).map(({ id, state }) => ({ id, state })),
      })),
      truncated,
    });
  } catch (error) {
    console.error("[founder-bot] list products failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * Upload one product into a store the founder owns.
 *
 * The file and the cover go through the same type and size rules as the
 * dashboard routes, then through the same product create (pending moderation,
 * provenance, scan, review checklist). This route cannot approve anything.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireFounder(req);
    if (!auth.ok) return auth.response;

    const limit = rateLimiters.createProduct(accountKey(auth.email));
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limit.resetTime)) } }
      );
    }

    const declaredLength = req.headers.get("content-length");
    if (declaredLength !== null) {
      const bytes = Number(declaredLength);
      if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Upload is too large" }, { status: 413 });
      }
    }

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Expected a form upload" }, { status: 400 });

    const shopId = textField(form, "shopId");
    if (!shopId || shopId.length > 64) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const owns = await founderOwnsShop(auth.user.id, shopId);
    if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const title = textField(form, "title") ?? textField(form, "name");
    const description = textField(form, "description");
    const price = textField(form, "price");
    const category = textField(form, "category");
    const currency = textField(form, "currency");
    if (!isProductCategory(category)) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }

    const rawFile = form.get("file");
    if (!isUpload(rawFile)) {
      return NextResponse.json({ error: "Upload your product file before submitting." }, { status: 400 });
    }
    const file = await namedFile(rawFile);
    const fileDecision = decideUpload(PRODUCT_FILE_CONFIG, { name: file.name, size: file.size, type: file.type });
    if (!fileDecision.ok) {
      const error =
        fileDecision.reason === "size"
          ? "This file is too large."
          : fileDecision.reason === "empty"
            ? "The product file is empty."
            : "This file type is not allowed.";
      return NextResponse.json({ error }, { status: 400 });
    }

    const rawCover = form.get("cover");
    let cover: File | null = null;
    let coverDecision: ReturnType<typeof decideUpload> | null = null;
    if (rawCover !== null) {
      if (!isUpload(rawCover)) {
        return NextResponse.json({ error: "Cover image must be a file." }, { status: 400 });
      }
      cover = await namedFile(rawCover);
      coverDecision = decideUpload(PRODUCT_THUMBNAIL_CONFIG, {
        name: cover.name,
        size: cover.size,
        type: cover.type,
      });
      if (!coverDecision.ok) {
        const error =
          coverDecision.reason === "size"
            ? "This cover image is too large."
            : coverDecision.reason === "empty"
              ? "The cover image is empty."
              : "This cover image type is not allowed.";
        return NextResponse.json({ error }, { status: 400 });
      }
    }

    const storedFile = await uploadAcceptedFile(file, fileDecision);
    if (!storedFile.ok) {
      const status = storedFile.reason === "unconfigured" ? 503 : 500;
      const error = storedFile.reason === "unconfigured" ? "File storage is not configured." : "The file could not be stored.";
      return NextResponse.json({ error }, { status });
    }
    await recordProvenance("PRODUCT_FILE")({
      file: {
        key: storedFile.file.key,
        name: storedFile.file.name,
        size: storedFile.file.size,
        type: storedFile.file.type || file.type || "application/octet-stream",
        ufsUrl: storedFile.file.ufsUrl,
      },
      metadata: { userId: auth.user.id, shopId },
    });

    let thumbnailUrl: string | undefined;
    if (cover && coverDecision?.ok) {
      const storedCover = await uploadAcceptedFile(cover, coverDecision);
      if (!storedCover.ok) {
        const status = storedCover.reason === "unconfigured" ? 503 : 500;
        return NextResponse.json({ error: "The cover image could not be stored." }, { status });
      }
      await recordProvenance("PRODUCT_THUMBNAIL")({
        file: {
          key: storedCover.file.key,
          name: storedCover.file.name,
          size: storedCover.file.size,
          type: storedCover.file.type || cover.type || "application/octet-stream",
          ufsUrl: storedCover.file.ufsUrl,
        },
        metadata: { userId: auth.user.id, shopId },
      });
      thumbnailUrl = storedCover.file.ufsUrl;
    }

    const created = await createProductForSeller(
      auth.user,
      {
        name: title,
        description,
        price,
        category,
        shopId,
        fileUrl: storedFile.file.ufsUrl,
        thumbnailUrl,
        currency: currency ?? "SAR",
        // The authenticated founder is certifying this upload. Not a client field.
        certified: true,
      },
      {
        actor: `founder-bot:${auth.user.id}`,
        reason: "Created by the founder bot. Seller certified ownership, legality, and responsibility at upload.",
      }
    );

    if (created.status !== 201) return created;
    const payload = (await created.json()) as {
      id?: string;
      shopId?: string;
      name?: string;
      slug?: string;
      price?: unknown;
      currency?: string;
      category?: string | null;
      moderationStatus?: string;
      fileScanStatus?: string;
    };
    if (payload.moderationStatus !== "PENDING" || !payload.id) {
      console.error("[founder-bot] product was not left pending");
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
    }

    console.info(`[founder-bot] action=product-created product=${redactId(payload.id)} shop=${redactId(shopId)}`);
    return NextResponse.json(
      {
        id: payload.id,
        shopId: payload.shopId,
        name: payload.name,
        slug: payload.slug,
        price: payload.price,
        currency: payload.currency,
        category: payload.category,
        moderationStatus: payload.moderationStatus,
        fileScanStatus: payload.fileScanStatus,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[founder-bot] create product failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
