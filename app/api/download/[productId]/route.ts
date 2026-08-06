import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
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

    // Fetch the product from database
    const product = await prisma.product.findUnique({
      where: { id: actualProductId },
      select: {
        id: true,
        name: true,
        fileUrl: true,
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    if (!product.fileUrl) {
      return NextResponse.json(
        { error: "No file available for this product. Please contact support." },
        { status: 404 }
      );
    }

    // Log by IDs only — never log the fileUrl (it is the paid asset).
    console.log(`Download authorized: product=${product.id} order=${actualOrderId}`);

    // Check if JSON format is requested (for API calls from success page)
    const format = searchParams.get("format");
    const wantsJson = format === "json";

    // If JSON format is requested (from success page fetch), return JSON
    if (wantsJson) {
      return NextResponse.json({
        productName: product.name,
        downloadUrl: product.fileUrl,
      });
    }

    // Default: redirect to the file URL (for email links and direct browser access)
    return NextResponse.redirect(product.fileUrl);
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

