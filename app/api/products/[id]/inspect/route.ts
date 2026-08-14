import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../auth/authOptions";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { inspectProduct, INSPECT_TTL_SECONDS } from "@/lib/inspect";
import { createDeliveryUrl } from "@/lib/storage/provider";

/**
 * A seller checking their own deliverable.
 *
 * The edit page has always offered a "test download" so a seller can confirm
 * what a buyer would actually receive. It linked straight at `product.fileUrl`,
 * which stopped working the moment Stage B made deliverables private.
 *
 * Same shape as the founder route, one authority swapped: membership of the
 * owning shop instead of marketplace admin. The key is still resolved from the
 * row, a client still never supplies one, and the signed URL is still only
 * minted after both checks pass.
 *
 * STRICTER THAN THE FOUNDER ROUTE, on purpose. A seller may retrieve a file
 * only once it has a SAFE verdict bound to the key currently attached.
 * PENDING_SCAN, SCAN_ERROR and a stale binding are all refused: a signed URL
 * is a transferable bearer credential, and minting one over bytes that have
 * not passed scanning would let the upload path double as a distribution path
 * for unverified content. The seller already holds the original, so nothing
 * legitimate is lost. There is no override.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    /**
     * Membership is expressed as part of the lookup rather than checked after
     * it, so a non-member's query simply finds nothing.
     *
     * That also makes "no such product" and "not your product" a single 404.
     * The sibling routes on this resource answer 404 and 403 separately, which
     * lets any signed-in account probe which product ids exist; a new endpoint
     * should not inherit that, and nothing legitimate needs the distinction.
     */
    const product = await prisma.product.findFirst({
      where: {
        id,
        shop: {
          shopUsers: {
            some: {
              user: { email: { equals: session.user.email, mode: "insensitive" } },
            },
          },
        },
      },
      select: {
        id: true,
        fileKey: true,
        fileScanStatus: true,
        fileScanKey: true,
      },
    });

    if (!product) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // One call: the raw status is validated and the policy applied together,
    // so neither route can do one without the other.
    const { decision, reason } = inspectProduct(product, "shop_member");

    if (!decision.allow) {
      return NextResponse.json(
        { error: decision.code, scan: reason },
        { status: decision.status }
      );
    }

    const fileKey = product.fileKey as string;

    const delivery = await createDeliveryUrl(fileKey, {
      ttlSeconds: INSPECT_TTL_SECONDS,
    });

    if (!delivery.ok) {
      return NextResponse.json(
        { error: "delivery_unavailable", reason: delivery.reason },
        { status: 503 }
      );
    }

    // Identifiers only, and no URL. `verification` is always "verified" on
    // this route — the policy permits nothing else — and is logged so that
    // stops being an assumption anyone has to hold in their head.
    console.log(
      `[inspect] shop-member product=${product.id} ` +
        `scan=${reason} verification=${decision.verification}`
    );

    return redirectToDelivery(delivery.url);
  } catch (error) {
    console.error("[inspect] seller inspection failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * See the identical helper on the admin route. Deliberately duplicated rather
 * than shared: it is four lines of header hygiene, and importing `next/server`
 * into lib/ to host it would drag the request runtime into a module the unit
 * tests import directly. A test asserts BOTH routes set both headers, which is
 * the drift this would otherwise risk.
 */
function redirectToDelivery(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
