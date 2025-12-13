import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export async function POST(req: Request) {
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
        // File doesn't exist (404, 403, etc.) - clear the fileUrl and block purchase
        console.warn(`File not accessible for product ${product.id}: ${product.fileUrl} - Status: ${fileResponse.status}`);
        
        // Clear the broken fileUrl
        await prisma.product.update({
          where: { id: product.id },
          data: { fileUrl: null },
        });

        return NextResponse.json(
          { error: "This product is not available for purchase. The file is no longer accessible." },
          { status: 400 }
        );
      }
    } catch (error) {
      // Network error, timeout, or other issue - treat as file not available
      console.error(`Error validating file for product ${product.id}:`, error);
      
      // Clear the broken fileUrl
      await prisma.product.update({
        where: { id: product.id },
        data: { fileUrl: null },
      });

      return NextResponse.json(
        { error: "This product is not available for purchase. The file could not be verified." },
        { status: 400 }
      );
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
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