import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

    // Retrieve the Stripe checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify payment is complete
    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed" },
        { status: 402 }
      );
    }

    // Get productId from session metadata
    const productId = session.metadata?.productId;

    if (!productId) {
      return NextResponse.json(
        { error: "Product information not found in session" },
        { status: 404 }
      );
    }

    // Fetch the product from database
    const product = await prisma.product.findUnique({
      where: { id: productId },
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

    // Optionally validate that the file URL is accessible
    // (skip validation for now to avoid delays, but log for debugging)
    console.log(`Download requested for product ${product.name}, fileUrl: ${product.fileUrl}`);

    return NextResponse.json({
      productName: product.name,
      downloadUrl: product.fileUrl,
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

