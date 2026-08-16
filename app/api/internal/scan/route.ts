import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { cloudmersiveProvider } from "@/lib/scan/cloudmersive";
import { findScannableKeys, scanFileAsset } from "@/lib/scan/run";

/**
 * The scan worker.
 *
 * Separate from the upload callback on purpose. Scanning moves every byte
 * twice — storage to here, here to the provider — and `app/api/**` is capped
 * at 30s, which the largest accepted deliverable cannot fit. Running it here,
 * with its own duration budget, is what keeps the upload path fast and the
 * scan path able to finish.
 *
 * Nothing in the response identifies a seller, names a file, or echoes a
 * provider payload: it reports keys and outcomes only.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Small batches: a long invocation that dies loses less work. */
const MAX_BATCH = 5;

/**
 * Two callers are legitimate: a signed-in admin, and Vercel Cron.
 *
 * Vercel Cron authenticates by sending `Authorization: Bearer $CRON_SECRET`.
 * When CRON_SECRET is unset the bearer path is refused outright rather than
 * waved through — an unauthenticated trigger would let anyone burn the
 * scanner quota.
 */
async function authorize(req: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const header = req.headers.get("authorization");
    if (header === `Bearer ${cronSecret}`) return true;
  }

  const session = await getServerSession(authOptions);
  return Boolean(session?.user?.email && isAdminEmail(session.user.email));
}

export async function POST(req: Request) {
  try {
    if (!(await authorize(req))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Refuse before touching anything when the scanner cannot answer.
    // Returning early rather than recording SCAN_ERROR matters: an
    // unconfigured environment must not manufacture failures for scans it
    // never attempted, because those failures are persisted and count against
    // the retry budget.
    if (!cloudmersiveProvider.isConfigured()) {
      return NextResponse.json(
        { error: "scanner_unconfigured", scanned: 0, results: [] },
        { status: 503 }
      );
    }

    // An explicit key scans one file; otherwise take the oldest eligible batch.
    const body = await req.json().catch(() => ({}));
    const requestedKey =
      typeof body?.key === "string" && body.key.length > 0 ? body.key : null;

    const keys = requestedKey
      ? [requestedKey]
      : await findScannableKeys(MAX_BATCH);

    const results = [];
    for (const key of keys) {
      results.push(await scanFileAsset(key));
    }

    return NextResponse.json({ scanned: results.length, results });
  } catch (error) {
    // Never echo the cause: it can carry a signed URL or a provider payload.
    console.error("[scan] worker failed", (error as Error)?.name);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
