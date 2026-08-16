import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { inspectProduct, INSPECT_TTL_SECONDS } from "@/lib/inspect";
import { createDeliveryUrl } from "@/lib/storage/provider";

/**
 * Founder inspection of a seller's deliverable.
 *
 * Stage B made deliverables private, which silently broke the "Inspect file"
 * links in the moderation queue and the products directory: they pointed at
 * `product.fileUrl`, and a private object refuses that URL. Approving a
 * product without opening its file is guesswork, so this restores the ability
 * — through an authorised, short-lived signed URL rather than a stored one.
 *
 * The order of operations is the security property:
 *
 *   1. authenticate
 *   2. authorise as marketplace admin
 *   3. resolve the product AND its storage key server-side
 *   4. apply the inspection policy to the file's scan state
 *   5. only then mint a signed URL
 *
 * A client never supplies a storage key, and never supplies a URL. It names a
 * product; everything else is looked up. That is what stops an admin session
 * from being turned into a read primitive over arbitrary storage objects.
 *
 * The signed URL is redirected to and never serialised: not into JSON, not
 * into HTML, not into a log line.
 *
 * NO UNSAFE PATH. A file the scanner rejected cannot be opened here by any
 * means: no override parameter, no override at all. An earlier draft let a
 * query string on this GET act as consent, which was wrong twice over — a GET
 * is the one method that gets prefetched, link-previewed and pasted into chat,
 * and a query string is not a confirmation. Should SaiFlow later need the
 * founder to open a rejected file, that is a POST with CSRF protection and a
 * durable audit record, designed on its own terms rather than bolted on here.
 */
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    if (!rateLimiters.api(getClientIp(req)).success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const session = await getServerSession(authOptions);
    // Anonymous and non-admin are answered identically, so this endpoint
    // cannot be used to discover who holds moderation authority.
    if (!session?.user?.email || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { productId } = await params;
    if (!productId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // The key comes from the row, never from the request. `fileUrl` is
    // deliberately not selected: nothing here needs it, and not selecting it
    // is the cheapest guarantee it cannot be returned by accident.
    const product = await prisma.product.findUnique({
      where: { id: productId },
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
    const { decision, reason } = inspectProduct(product, "admin");

    if (!decision.allow) {
      // The scan reason is returned so the founder is told WHY. It is a short
      // category, never a provider payload and never file contents.
      return NextResponse.json(
        { error: decision.code, scan: reason },
        { status: decision.status }
      );
    }

    // Non-null by construction: `missing_file_key` was refused above, and it
    // is the only reason a null key can produce.
    const fileKey = product.fileKey as string;

    const delivery = await createDeliveryUrl(fileKey, {
      ttlSeconds: INSPECT_TTL_SECONDS,
    });

    if (!delivery.ok) {
      // Fail closed, and surface only the failure category.
      return NextResponse.json(
        { error: "delivery_unavailable", reason: delivery.reason },
        { status: 503 }
      );
    }

    // Identifiers only. The URL that was just minted appears nowhere here.
    // `verification` is recorded because opening an UNVERIFIED file is the
    // event worth being able to find later — it is never a claim of safety.
    const adminId = (session.user as { id?: string }).id ?? "unknown";
    console.log(
      `[inspect] admin=${adminId} product=${product.id} ` +
        `scan=${reason} verification=${decision.verification}`
    );

    return redirectToDelivery(delivery.url);
  } catch (error) {
    // Never echo the cause: it can carry a signed URL.
    console.error("[inspect] admin inspection failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * Hand the browser the URL without letting anything keep it.
 *
 * `no-store` stops the redirect being cached and replayed after the credential
 * has expired, and `no-referrer` stops the URL travelling onward in a Referer
 * header. vercel.json already sets no-store across /api/*; this repeats it so
 * the guarantee does not depend on platform configuration.
 */
function redirectToDelivery(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
