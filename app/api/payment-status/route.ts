import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { isMerchantReference, statusFor } from "@/lib/payments/payment-status";

/**
 * Payment status for the success page.
 *
 * GET /api/payment-status?ref=<merchantReferenceId>
 *
 * Read-only, and answered from SaiFlow's own rows: the attempt checkout
 * recorded, the product it names, and whether the verified callback has
 * written an Order for it. Geidea is never contacted here, nothing is
 * written, and nothing in the query but the reference is read. The reference
 * is unguessable, but the answer is deliberately small anyway: a status, the
 * product's public name, whether an Order exists, and, only then, the path
 * the buyer may download from. No ids, no amounts, no email, no provider
 * data. The path unlocks nothing by itself: the download route authorises
 * from the Order again on every request.
 *
 * The success page polls this for a bounded time, so the same per-IP limit
 * the download route uses applies here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

export async function GET(req: Request) {
  if (!rateLimiters.api(getClientIp(req)).success) {
    return reply(429, { error: "too_many_requests" });
  }

  const ref = new URL(req.url).searchParams.get("ref");
  if (!isMerchantReference(ref)) {
    return reply(400, { error: "malformed" });
  }

  const attempt = await prisma.paymentSession.findUnique({
    where: { merchantReferenceId: ref },
    select: {
      status: true,
      expiresAt: true,
      product: { select: { name: true } },
      order: { select: { productId: true } },
    },
  });
  if (!attempt) {
    return reply(404, { error: "unknown_reference" });
  }

  const orderExists = attempt.order !== null;
  const status = statusFor(attempt, orderExists, new Date());
  return reply(200, {
    status,
    productName: attempt.product.name,
    orderExists,
    // Only once an Order exists, and derived from that Order's own product,
    // so the path names exactly what the Order authorises. It carries the
    // reference the buyer already holds and nothing else; the download route
    // re-checks the Order and the file at the moment of the click.
    ...(attempt.order !== null && status === "paid"
      ? {
          downloadUrl: `/api/download/${encodeURIComponent(attempt.order.productId)}?ref=${encodeURIComponent(ref)}`,
        }
      : {}),
  });
}
