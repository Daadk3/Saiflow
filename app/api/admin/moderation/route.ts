import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { isLocalHtmlAppReview } from "@/lib/local-html-review";
import { checklistRows, hasCoverImage } from "@/lib/review-checklist";
import { inspectProduct } from "@/lib/inspect";
import { isAllowedAssetUrl } from "@/lib/validations";

// GET - Pending moderation queue (admins only)
export async function GET(req: Request) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pending = await prisma.product.findMany({
      where: { moderationStatus: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        currency: true,
        category: true,
        thumbnailUrl: true,
        images: true,
        // The deliverable's own URL is deliberately NOT selected. Since Stage B
        // it is a private object that no browser can open, and the queue now
        // inspects through /api/admin/inspect/[productId] instead. The scan
        // columns are read only to ask that route's policy whether the link
        // would serve the file. A key alone is not enough: UNSAFE is refused.
        fileKey: true,
        fileScanStatus: true,
        fileScanKey: true,
        certifiedAt: true,
        createdAt: true,
        reviewChecks: true,
        shop: { select: { name: true, slug: true } },
      },
    });

    // The local-HTML label is a boolean derived from the scan facts. The facts
    // themselves stay here: they can carry flag codes, and the queue does not
    // need them. A missing asset is simply "not this product type".
    const fileKeys = pending.flatMap((row) => (row.fileKey ? [row.fileKey] : []));
    const assets = fileKeys.length
      ? await prisma.fileAsset.findMany({
          where: { key: { in: fileKeys } },
          select: { key: true, contentFacts: true },
        })
      : [];
    const localHtmlKeys = new Set(
      assets.filter((asset) => isLocalHtmlAppReview(asset.contentFacts)).map((asset) => asset.key)
    );

    // Emit booleans, never a key, a scan column or a URL. `canInspect` is the
    // route's own decision, so the queue does not link a file the route will
    // refuse. `scanBlocked` tells the queue to say why the link is absent.
    return NextResponse.json({
      pending: pending.map((row) => {
        const decision = inspectProduct(row, "admin").decision;
        const { fileKey, fileScanStatus, fileScanKey, reviewChecks, images, ...rest } = row;
        void fileScanStatus;
        void fileScanKey;
        return {
          ...rest,
          canInspect: decision.allow,
          scanBlocked: !decision.allow && decision.code === "unsafe",
          localHtmlApp: fileKey !== null && localHtmlKeys.has(fileKey),
          // The 8-point checklist, already resolved to rows. The key is only
          // compared here, never sent.
          checklist: checklistRows(reviewChecks, fileKey, {
            description: rest.description,
            hasCover: hasCoverImage({ thumbnailUrl: rest.thumbnailUrl, images }, isAllowedAssetUrl),
          }),
        };
      }),
    });
  } catch (error) {
    console.error("Error fetching moderation queue:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
