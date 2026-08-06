import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { Resend } from "resend";

// Public product reporting (Trust & Safety Tier 0).
// Creates an audit record and notifies the admin inbox.
// NEVER changes moderation status — removal is always a human decision.

const REPORT_CATEGORIES = [
  "copyright",
  "illegal",
  "explicit",
  "child_safety",
  "political",
  "religious",
  "hate_harassment",
  "fraud_scam",
  "malware",
  "other",
] as const;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = getClientIp(req);
    if (!rateLimiters.report(ip).success) {
      return NextResponse.json(
        { error: "Too many reports. Please try again later." },
        { status: 429 }
      );
    }

    const { id } = await params;
    const { category, details } = await req.json();

    if (!REPORT_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: "Invalid report category" }, { status: 400 });
    }
    if (details !== undefined && details !== null && (typeof details !== "string" || details.length > 1000)) {
      return NextResponse.json(
        { error: "Details must be less than 1,000 characters" },
        { status: 400 }
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      select: { id: true, name: true, moderationStatus: true, shop: { select: { slug: true, name: true } } },
    });
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Audit record. Status is untouched by design: previous == new.
    await prisma.moderationEvent.create({
      data: {
        productId: product.id,
        action: "REPORTED",
        actor: "public",
        reason: details?.trim() ? `[${category}] ${details.trim()}` : `[${category}]`,
        categories: [category],
        previousStatus: product.moderationStatus,
        newStatus: product.moderationStatus,
      },
    });

    // Notify admin. Best-effort: a failed email must never lose the report
    // (the audit record above is already committed).
    try {
      await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: "Saiflow <noreply@saiflow.io>",
        to: "support@saiflow.io",
        subject: `[Report] ${category} — ${product.name}`,
        text:
          `Product reported.\n\n` +
          `Product: ${product.name} (${product.id})\n` +
          `Shop: ${product.shop.name} (${product.shop.slug})\n` +
          `Category: ${category}\n` +
          `Details: ${details?.trim() || "—"}\n\n` +
          `Review queue: /dashboard/moderation`,
      });
    } catch (emailError) {
      console.error("Report notification email failed:", emailError);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error submitting report:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
