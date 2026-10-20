import { NextResponse } from "next/server";

/**
 * RETIRED: the Stripe webhook.
 *
 * Stripe was SaiFlow's first payment rail and was never launched; Geidea is
 * the rail (app/api/webhooks/geidea). This handler used to create an Order,
 * which authorises a download, from any paid Stripe Checkout Session carrying
 * a `productId` in its metadata, with no check of the amount, the currency,
 * the product's moderation or pre-launch, and it echoed internal error text
 * to its caller. Reachable only if STRIPE_WEBHOOK_SECRET were ever set, but
 * nothing should depend on that never happening (security review,
 * 2026-10-19).
 *
 * It now answers 410 Gone and does nothing. Orders made through it in the
 * past keep their downloads: the download route's own Stripe channel is
 * unchanged. Restoring Stripe means a new, reviewed integration, not this.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({ error: "gone" }, { status: 410 });
}
