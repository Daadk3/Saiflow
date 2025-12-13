import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { sendPurchaseConfirmationEmail } from "@/lib/email";

// Initialize Stripe with API version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

// Webhook secret for signature verification
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Disable body parsing - we need the raw body for signature verification
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe Webhook Handler
 * 
 * Handles incoming webhook events from Stripe.
 * Currently processes:
 * - checkout.session.completed: Creates order record after successful payment
 * - checkout.session.async_payment_succeeded: Handles async payment methods
 * - payment_intent.payment_failed: Logs failed payments
 */
export async function POST(req: Request) {
  // Validate webhook secret is configured
  if (!webhookSecret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // Get the raw body for signature verification
  let body: string;
  try {
    body = await req.text();
  } catch (err) {
    console.error("[Stripe Webhook] Failed to read request body:", err);
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 }
    );
  }

  // Get the signature header
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    console.error("[Stripe Webhook] Missing stripe-signature header");
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  // Verify the webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Stripe Webhook] Signature verification failed: ${errorMessage}`);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${errorMessage}` },
      { status: 400 }
    );
  }

  // Log the event type for debugging
  console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

  // Handle different event types
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "checkout.session.async_payment_succeeded":
        // Handle async payment methods (bank transfers, etc.)
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case "checkout.session.async_payment_failed":
        await handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case "charge.succeeded":
        // Handle successful charges - find the checkout session and process
        await handleChargeSucceeded(event.data.object as Stripe.Charge);
        break;

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }

    // Return 200 to acknowledge receipt
    return NextResponse.json({ received: true, type: event.type });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Stripe Webhook] Error processing ${event.type}: ${errorMessage}`);
    
    // Return 500 so Stripe will retry the webhook
    return NextResponse.json(
      { error: `Webhook handler failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

/**
 * Handle successful checkout session
 * Creates an order record in the database
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log(`[Stripe Webhook] Processing checkout session: ${session.id}`);

  // Only process paid sessions
  if (session.payment_status !== "paid") {
    console.log(`[Stripe Webhook] Session ${session.id} not paid yet (status: ${session.payment_status})`);
    return;
  }

  // Get productId from metadata
  const productId = session.metadata?.productId;
  if (!productId) {
    console.error(`[Stripe Webhook] No productId in session metadata for session: ${session.id}`);
    throw new Error("No productId in session metadata");
  }

  // Check for existing order (idempotency)
  const existingOrder = await prisma.order.findUnique({
    where: { stripeSessionId: session.id },
  });

  if (existingOrder) {
    console.log(`[Stripe Webhook] Order already exists for session: ${session.id}`);
    return;
  }

  // Get the product details
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      shop: {
        select: { name: true, slug: true },
      },
    },
  });

  if (!product) {
    console.error(`[Stripe Webhook] Product not found: ${productId}`);
    throw new Error(`Product not found: ${productId}`);
  }

  // Get customer email
  const customerEmail = session.customer_details?.email || session.customer_email || "unknown@example.com";

  // Create the order
  const order = await prisma.order.create({
    data: {
      productId: product.id,
      productName: product.name,
      price: product.price,
      customerEmail,
      stripeSessionId: session.id,
    },
  });

  console.log(`[Stripe Webhook] Order created successfully:`, {
    orderId: order.id,
    productName: product.name,
    shopName: product.shop.name,
    customerEmail,
    price: product.price.toString(),
    stripeSessionId: session.id,
  });

  // Send purchase confirmation email
  const baseUrl = process.env.NEXTAUTH_URL || 'https://saiflow.io';
  const downloadUrl = `${baseUrl}/success?session_id=${session.id}`;
  
  try {
    await sendPurchaseConfirmationEmail({
      customerEmail,
      productName: product.name,
      productPrice: Number(product.price),
      downloadUrl,
      shopName: product.shop.name,
    });
    console.log(`[Stripe Webhook] Purchase confirmation email sent to: ${customerEmail}`);
  } catch (emailError) {
    // Log but don't throw - email failure shouldn't break the order flow
    console.error(`[Stripe Webhook] Failed to send email to ${customerEmail}:`, emailError);
  }
}

/**
 * Handle successful charge
 * Looks up the checkout session and processes the order
 */
async function handleChargeSucceeded(charge: Stripe.Charge) {
  console.log(`[Stripe Webhook] Processing charge: ${charge.id}`);

  // Get the payment intent ID from the charge
  const paymentIntentId = typeof charge.payment_intent === 'string' 
    ? charge.payment_intent 
    : charge.payment_intent?.id;

  if (!paymentIntentId) {
    console.log(`[Stripe Webhook] No payment intent for charge: ${charge.id}`);
    return;
  }

  // Find the checkout session associated with this payment intent
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntentId,
    limit: 1,
  });

  if (sessions.data.length === 0) {
    console.log(`[Stripe Webhook] No checkout session found for payment intent: ${paymentIntentId}`);
    return;
  }

  const session = sessions.data[0];
  
  // Process the session (this handles idempotency internally)
  await handleCheckoutSessionCompleted(session);
}

/**
 * Handle failed async payment
 * Logs the failure for monitoring
 */
async function handleAsyncPaymentFailed(session: Stripe.Checkout.Session) {
  console.error(`[Stripe Webhook] Async payment failed for session: ${session.id}`, {
    customerEmail: session.customer_details?.email,
    productId: session.metadata?.productId,
  });
  
  // You could send an email notification here
  // await sendPaymentFailedEmail(session.customer_details?.email);
}

/**
 * Handle failed payment intent
 * Logs the failure for monitoring
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const lastError = paymentIntent.last_payment_error;
  
  console.error(`[Stripe Webhook] Payment failed:`, {
    paymentIntentId: paymentIntent.id,
    errorCode: lastError?.code,
    errorMessage: lastError?.message,
    errorType: lastError?.type,
  });
  
  // You could track failed payments in the database
  // or send notifications here
}
