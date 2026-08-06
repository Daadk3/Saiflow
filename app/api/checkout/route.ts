import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

// Lazy init: Stripe env vars are optional in pre-launch, so a module-level
// `new Stripe(...)` would crash builds/deploys that omit them.
function getStripe(): Stripe {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-11-17.clover",
  });
}

export async function POST(req: Request) {
  // Pre-launch gate: defense in depth alongside the disabled BuyButton.
  // Returns 503 with a machine-readable error code so the client can show
  // a localized message rather than display the English fallback below.
  if (env.PRE_LAUNCH_MODE) {
    return NextResponse.json(
      {
        error: "pre_launch",
        message: "Saiflow is in pre-launch. Payments are not yet available.",
      },
      { status: 503 }
    );
  }

  try {
    const { productId } = await req.json();

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // Get the product from database
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { shop: true },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Unpublished/unapproved products and deactivated shops must not be
    // purchasable, even by direct API call with a known product id.
    if (!product.isActive || product.moderationStatus !== "APPROVED" || !product.shop.isActive) {
      return NextResponse.json(
        { error: "This product is not available for purchase." },
        { status: 400 }
      );
    }

    // Check if product has a file uploaded
    if (!product.fileUrl) {
      return NextResponse.json(
        { error: "This product is not available for purchase. No file has been uploaded." },
        { status: 400 }
      );
    }

    // Validate that the file actually exists by making a HEAD request
    try {
      const fileResponse = await fetch(product.fileUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!fileResponse.ok) {
        // Block the purchase but do NOT mutate the product: a transient
        // provider error must never silently unpublish a live product.
        console.warn(`File not accessible for product ${product.id} - status: ${fileResponse.status}`);
        return NextResponse.json(
          { error: "This product is not available for purchase. The file is no longer accessible." },
          { status: 400 }
        );
      }
    } catch (error) {
      // Network error or timeout — block this attempt only, never mutate.
      console.error(`Error validating file for product ${product.id}:`, error);
      return NextResponse.json(
        { error: "This product is temporarily unavailable. Please try again in a moment." },
        { status: 503 }
      );
    }

    // Create Stripe checkout session
    // Payments unconfigured => same behavior as pre-launch: unavailable.
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: "pre_launch", message: "Payments are not yet available." },
        { status: 503 }
      );
    }

    const session = await getStripe().checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: product.currency.toLowerCase(),
            product_data: {
              name: product.name,
              description: product.description || undefined,
            },
            unit_amount: Math.round(Number(product.price) * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      metadata: {
        productId: product.id,
      },
      success_url: `${process.env.NEXTAUTH_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXTAUTH_URL}/shop/${product.shop.slug}/product/${product.slug}`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}