import { NextResponse } from "next/server";
import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isDeliverableSafe } from "@/lib/file-safety";

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

    // Get the product from database.
    //
    // No `select`, so every scalar column is loaded — which includes the three
    // the safety gate below reads: fileKey, fileScanStatus and fileScanKey.
    // Narrowing this to a select would need all three added explicitly, or the
    // gate silently starts deciding on undefined.
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

    /**
     * THE SALE GATE. Stage C computed a scan verdict; this is where it finally
     * decides something.
     *
     * `isDeliverableSafe` is the single reviewed authority and is called
     * directly — never re-derived, and never reduced to a `fileScanStatus`
     * check. It requires all three of: a non-null current `fileKey`, a SAFE
     * verdict, and that verdict being bound to THAT key. So a file still
     * queued, one whose scan errored, one the scanner rejected, and one whose
     * SAFE verdict belongs to a since-replaced upload all refuse here, as does
     * any status a later migration might add.
     *
     * Nothing a buyer sends reaches this decision: the only input from the
     * request is `productId`, and every field read below comes from the row.
     *
     * REPLACES A HEAD LIVENESS PROBE, which had to go rather than merely being
     * redundant. It fetched `product.fileUrl`, and since Stage B that URL names
     * a PRIVATE object — a HEAD against it answers 403, so the probe refused
     * every modern deliverable with "the file is no longer accessible". Left in
     * place behind this gate it would have blocked exactly the products that
     * pass it.
     *
     * What is genuinely lost with it: proof that the object resolves RIGHT NOW.
     * A SAFE verdict proves the bytes were fetched by key and scanned, not that
     * a seller has not deleted them since. That gap is recorded rather than
     * papered over — re-probing would mean minting a signed URL during
     * checkout, which this route must never do.
     */
    if (!isDeliverableSafe(product)) {
      // Machine-readable code plus an English fallback, matching the
      // `pre_launch` convention already used above. Deliberately says nothing
      // about WHICH state failed: a buyer has no business learning whether a
      // seller's file is unscanned or was rejected as malware.
      return NextResponse.json(
        {
          error: "file_not_ready",
          message:
            "This product is not available for purchase. Its file has not completed safety checks.",
        },
        { status: 400 }
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