import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { sendPurchaseConfirmationEmail } from "@/lib/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

// This endpoint manually processes a checkout session for debugging
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  
  if (!sessionId) {
    return NextResponse.json({ 
      error: "Provide ?session_id=cs_test_..." 
    }, { status: 400 });
  }

  try {
    // Fetch the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log("Session data:", JSON.stringify(session, null, 2));

    if (session.payment_status !== "paid") {
      return NextResponse.json({ 
        error: "Session not paid",
        payment_status: session.payment_status 
      }, { status: 400 });
    }

    const productId = session.metadata?.productId;
    if (!productId) {
      return NextResponse.json({ 
        error: "No productId in metadata",
        metadata: session.metadata 
      }, { status: 400 });
    }

    // Get product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { shop: { select: { name: true, slug: true } } },
    });

    if (!product) {
      return NextResponse.json({ 
        error: "Product not found",
        productId 
      }, { status: 404 });
    }

    const customerEmail = session.customer_details?.email || session.customer_email;
    if (!customerEmail) {
      return NextResponse.json({ 
        error: "No customer email found",
        customer_details: session.customer_details 
      }, { status: 400 });
    }

    // Send email
    const downloadUrl = `https://saiflow.io/success?session_id=${session.id}`;
    
    const emailResult = await sendPurchaseConfirmationEmail({
      customerEmail,
      productName: product.name,
      productPrice: Number(product.price),
      downloadUrl,
      shopName: product.shop.name,
    });

    return NextResponse.json({
      success: true,
      message: "Debug process completed",
      session: {
        id: session.id,
        payment_status: session.payment_status,
        customer_email: customerEmail,
      },
      product: {
        id: product.id,
        name: product.name,
        price: Number(product.price),
      },
      emailResult,
    });

  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}

