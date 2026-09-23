import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/authOptions";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admin";
import { rateLimit } from "@/lib/rate-limit";
import { reconcileProductScanState } from "@/lib/file-safety";
import { redactId } from "@/lib/redact-id";
import { rescanDecision, resetScanForRetry } from "@/lib/scan/rescan";
import { scheduleScan } from "@/lib/scan/schedule";

/**
 * POST /api/products/[id]/rescan — retry a failed file scan.
 *
 * Who: a member of the product's shop, or an admin. Both are checked before
 * the rate limit is consulted, so a stranger cannot spend an owner's budget.
 *
 * What: exactly this product's current file. The decision comes from the
 * same derivation the seller's badge uses (lib/scan/rescan.ts), so a file
 * that shows FAILED can be retried and nothing else can: SAFE is never
 * re-scanned, UNSAFE is never re-opened, and a scan under way is left alone.
 *
 * The scan itself runs after this response through the same scheduler the
 * product routes use, hence the worker's duration budget on this route.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Three retries per product per hour: enough to recover, too few to burn quota. */
const RETRY_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 3 };

const ASSET_SELECT = {
  key: true,
  shopId: true,
  route: true,
  scanStatus: true,
  scanAttempts: true,
  scanAt: true,
  scanReason: true,
  scanClaimToken: true,
  scanClaimedAt: true,
  createdAt: true,
} as const;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        shopId: true,
        fileKey: true,
        fileScanStatus: true,
        fileScanKey: true,
        updatedAt: true,
        shop: {
          select: {
            shopUsers: { select: { user: { select: { email: true } } } },
          },
        },
      },
    });
    if (!product) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const email = session.user.email.toLowerCase();
    const isMember = product.shop.shopUsers.some(
      (su) => su.user.email.toLowerCase() === email
    );
    const admin = isAdminEmail(session.user.email);
    if (!isMember && !admin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const asset = product.fileKey
      ? await prisma.fileAsset.findUnique({ where: { key: product.fileKey }, select: ASSET_SELECT })
      : null;

    // A verdict already exists for these bytes and only the product copy is
    // behind: settle it instead of scanning again.
    if (asset?.scanStatus === "SAFE" && product.fileKey) {
      await reconcileProductScanState(product.id, product.fileKey);
      return NextResponse.json({ ok: true, state: "passed" });
    }

    const decision = rescanDecision(product, asset);
    if (!decision.ok) {
      return NextResponse.json({ error: decision.refusal }, { status: 409 });
    }

    const limit = rateLimit(`rescan:${product.id}`, RETRY_LIMIT);
    if (!limit.success) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    const key = product.fileKey as string;
    const reset = await resetScanForRetry(key, product.id);
    if (!reset) {
      return NextResponse.json({ error: "not_failed" }, { status: 409 });
    }

    console.log(
      `[scan] rescan requested product=${redactId(product.id)} by=${isMember ? "seller" : "admin"}`
    );
    scheduleScan(key);

    return NextResponse.json({ ok: true, state: "scanning" }, { status: 202 });
  } catch (error) {
    console.error("[scan] rescan failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
