import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { isDeliverableSafe } from "@/lib/file-safety";
import { createDeliveryUrl, MAX_DELIVERY_TTL_SECONDS } from "@/lib/storage/provider";

/**
 * Buyer delivery — the last gate, and the only one where bytes actually move.
 *
 * Two independent conditions, both required, in this order:
 *
 *   1. PROOF OF PURCHASE — unchanged from before. Orders are written only by
 *      the signature-verified Stripe webhook, and only for sessions already
 *      marked paid, so a matching Order's mere existence IS the proof.
 *   2. DELIVERABLE SAFETY — new. `isDeliverableSafe` is the single reviewed
 *      authority: a non-null current fileKey, a SAFE verdict, and that verdict
 *      bound to THAT key. Nothing else delivers.
 *
 * Having paid is not a reason to receive malware. A buyer who purchased before
 * a file was replaced, or whose file later failed a scan, is refused here and
 * pointed at support — which is the correct outcome even though it is the
 * unhappy one.
 *
 * WHAT CHANGED, and why it mattered. This route used to hand back
 * `product.fileUrl`: redirected to it for email links, and serialised it into
 * JSON for the success page, which rendered it as an anchor. That URL is
 * permanent and unauthenticated — for legacy public objects it was an
 * infinitely shareable link to a paid asset, and for post-Stage-B private
 * objects it simply 403'd, so buyers of new products could not download at
 * all. `fileUrl` is no longer selected by this route, which is the cheapest
 * guarantee it cannot be delivered by accident.
 *
 * Delivery is now a short-lived signed URL minted from the DB-derived
 * `fileKey`, and only after both gates pass. The JSON channel returns an
 * application PATH rather than a URL, so the browser re-enters this handler
 * — and both gates — instead of holding a credential.
 */

/**
 * How long a buyer's delivery URL stays valid.
 *
 * Longer than inspection's 60s and deliberately so: a founder clicking
 * "inspect" is at a desk, while a buyer may be on a phone on mobile data
 * starting a 128MB download. The TTL only has to survive until the transfer
 * STARTS. Still bounded by the reviewed D1 ceiling, and asserted against it.
 */
const DOWNLOAD_TTL_SECONDS = MAX_DELIVERY_TTL_SECONDS;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    // This endpoint is unauthenticated by design — proof of purchase is a
    // (productId, orderId) pair — so a guess is cheap. It now hands back
    // signed bytes rather than a URL that might 404, which is worth a limit.
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const { productId } = await params;
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // P0 AUTHORIZATION: a download requires proof of purchase.
    // Orders are created ONLY by the signature-verified Stripe webhook, and only
    // for sessions with payment_status === "paid" — so a matching Order's mere
    // existence IS proof of a completed, paid purchase. No order => no file.
    //
    // Unchanged by D4. The safety gate is added AFTER this, never in place of it.
    let order: { id: string; productId: string } | null = null;

    if (productId.startsWith("cs_")) {
      // Success-page channel: the path param is a Stripe checkout session id.
      order = await prisma.order.findUnique({
        where: { stripeSessionId: productId },
        select: { id: true, productId: true },
      });
    } else if (orderId) {
      // Email channel: bare productId + ?orderId=. The order must exist AND
      // belong to the requested product.
      const found = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, productId: true },
      });
      if (found && found.productId === productId) {
        order = found;
      }
    }

    // No valid proof of purchase => refuse. Closes the unauthenticated
    // bare-productId enumeration hole.
    if (!order) {
      return NextResponse.json(
        { error: "Not authorized to download this product" },
        { status: 403 }
      );
    }

    const actualProductId = order.productId;
    const actualOrderId = order.id;

    // `fileUrl` is deliberately NOT selected. Nothing here needs it, and not
    // selecting it is the cheapest guarantee it can never be returned or
    // redirected to. The three scan columns are what the gate reads.
    const product = await prisma.product.findUnique({
      where: { id: actualProductId },
      select: {
        id: true,
        name: true,
        fileKey: true,
        fileScanStatus: true,
        fileScanKey: true,
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    /**
     * THE SAFETY GATE. Called directly, never re-derived, never reduced to a
     * status check. It refuses a missing key, PENDING_SCAN, SCAN_ERROR,
     * UNSAFE, a SAFE verdict bound to a since-replaced key, and any status a
     * later migration might add.
     *
     * Legacy products land here too: rows predating Stage B carry no fileKey,
     * so they refuse rather than falling back to their old public URL. That
     * fallback is exactly what must not exist, and Stage E is what will give
     * these files a real verdict.
     *
     * The reason is not disclosed. A buyer learning that a file they bought
     * was flagged as malware tells them something about the seller that
     * SaiFlow should be deciding how to communicate, not leaking from an API.
     */
    if (!isDeliverableSafe(product)) {
      return NextResponse.json(
        {
          error: "file_not_available",
          message:
            "This file is not available for download. Please contact support.",
        },
        { status: 409 }
      );
    }

    // Identifiers only — never the key, never a URL.
    console.log(
      `Download authorized: product=${product.id} order=${actualOrderId}`
    );

    /**
     * JSON channel, for the success page.
     *
     * Returns an application PATH, never a URL to storage and never a signed
     * credential. The browser follows it back into this handler, so the
     * purchase and safety gates are re-evaluated at the moment of download
     * rather than trusted from whenever the page was rendered. It also means
     * nothing durable is embedded in the page.
     */
    const format = searchParams.get("format");
    if (format === "json") {
      return NextResponse.json({
        productName: product.name,
        // Rebuilt from validated inputs rather than echoing the request, so no
        // client-supplied query parameter can ride along.
        downloadUrl: productId.startsWith("cs_")
          ? `/api/download/${encodeURIComponent(productId)}`
          : `/api/download/${encodeURIComponent(productId)}?orderId=${encodeURIComponent(actualOrderId)}`,
      });
    }

    /**
     * Delivery. The key comes from the row — a client cannot supply one, and
     * `fileUrl` is not even loaded. Signing happens only here, after both
     * gates, so no refusal path can produce a credential.
     */
    const delivery = await createDeliveryUrl(product.fileKey as string, {
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
    });

    if (!delivery.ok) {
      // Fail closed, surfacing only the failure category.
      return NextResponse.json(
        { error: "delivery_unavailable", reason: delivery.reason },
        { status: 503 }
      );
    }

    const res = NextResponse.redirect(delivery.url, 302);
    // `no-store` stops the redirect being cached and replayed after the
    // credential expires; `no-referrer` stops the URL travelling onward in a
    // Referer header. vercel.json already sets no-store across /api/*; this
    // repeats it so the guarantee does not depend on platform configuration.
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (error) {
    // Never echo the cause: it can carry a signed URL.
    console.error("Download error:", (error as Error)?.name);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
