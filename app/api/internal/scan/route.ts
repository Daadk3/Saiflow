import { timingSafeEqual } from "node:crypto";

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
 *
 * TWO METHODS, DELIBERATELY UNEQUAL (Stage E1):
 *
 *   GET  — Vercel Cron only. Vercel issues a GET, so without this handler the
 *          schedule would 405 forever and silently. Authenticated by bearer
 *          token ALONE.
 *   POST — operators. Admin session or bearer, and the only method that
 *          accepts an explicit key.
 *
 * GET refuses the admin session on purpose; see `authorizeCronOnly`.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Small batches: a long invocation that dies loses less work. */
const MAX_BATCH = 5;

/**
 * Constant-time string comparison.
 *
 * `===` on a secret returns as soon as two bytes differ, so how long it takes
 * to say "no" depends on how much of the token was right. Over enough samples
 * that difference is a channel for recovering the token one byte at a time.
 * `timingSafeEqual` always reads both buffers to the end.
 *
 * THE LENGTH GUARD IS REQUIRED, NOT DEFENSIVE. `timingSafeEqual` THROWS a
 * RangeError when the two buffers differ in length. Without this check a token
 * of the wrong length would raise inside the authoriser, be swallowed by the
 * route's catch, and return 500 instead of 403 — turning a refusal into an
 * error, and leaking through the status code exactly what the comparison is
 * meant to hide. `tests/stage-e1-cron.test.ts` pins that behaviour.
 *
 * What this deliberately does NOT hide: the guard reveals whether the supplied
 * value had the expected length. That is inherent to comparing raw bytes, and
 * acceptable for a bearer token of known format — the alternative, comparing
 * SHA-256 digests of both inputs, hides length but hashes on every request.
 * Length is not the secret; the bytes are.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = Buffer.from(a, "utf8");
  const bBytes = Buffer.from(b, "utf8");

  if (aBytes.length !== bBytes.length) return false;

  return timingSafeEqual(aBytes, bBytes);
}

/**
 * Does this request carry the cron bearer token?
 *
 * Vercel Cron authenticates by sending `Authorization: Bearer $CRON_SECRET`.
 * When CRON_SECRET is unset the bearer path is refused outright rather than
 * waved through — an unauthenticated trigger would let anyone burn the
 * scanner quota. An empty-after-trim value is treated as unset for the same
 * reason, so `CRON_SECRET=" "` cannot become an accepted credential.
 *
 * The whole header is compared against the whole expected value, so a correct
 * token behind a wrong scheme still fails: the scheme is part of the secret
 * material as far as this comparison is concerned.
 */
function hasCronBearer(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const header = req.headers.get("authorization");
  if (header === null) return false;

  return timingSafeEqualStrings(header, `Bearer ${cronSecret}`);
}

/**
 * GET: bearer ONLY. The admin session is deliberately not accepted here.
 *
 * A GET that honours a cookie is CSRF-triggerable. Any page an admin loads
 * while signed in could embed `<img src=".../api/internal/scan">` and fire a
 * scan batch — no data would leak, but it would spend provider quota on
 * someone else's say-so. A bearer token is never attached ambiently by a
 * browser, so requiring it removes the vector entirely rather than mitigating
 * it. Admins who want to trigger a scan by hand still have POST.
 */
function authorizeCronOnly(req: Request): boolean {
  return hasCronBearer(req);
}

/**
 * POST: a signed-in admin, or the cron bearer. Unchanged from Stage C.
 */
async function authorizeAdminOrCron(req: Request): Promise<boolean> {
  if (hasCronBearer(req)) return true;

  const session = await getServerSession(authOptions);
  return Boolean(session?.user?.email && isAdminEmail(session.user.email));
}

/**
 * Scan a batch, or one named key.
 *
 * Shared by both methods so the two entry points cannot drift apart in what
 * they actually do — they differ only in who may reach them.
 */
async function runScan(requestedKey: string | null) {
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

  const keys = requestedKey ? [requestedKey] : await findScannableKeys(MAX_BATCH);

  const results = [];
  for (const key of keys) {
    results.push(await scanFileAsset(key));
  }

  return NextResponse.json({ scanned: results.length, results });
}

/** Never echo the cause: it can carry a signed URL or a provider payload. */
function failed(error: unknown) {
  console.error("[scan] worker failed", (error as Error)?.name);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * The scheduled entry point. Batch only — there is no key to name, and no
 * request body is read, so a scheduled run can never be steered at a
 * particular file by whatever reaches this URL.
 */
export async function GET(req: Request) {
  try {
    if (!authorizeCronOnly(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return await runScan(null);
  } catch (error) {
    return failed(error);
  }
}

export async function POST(req: Request) {
  try {
    if (!(await authorizeAdminOrCron(req))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // An explicit key scans one file; otherwise take the oldest eligible batch.
    //
    // Trimmed before use. An untrimmed key silently misses the row it was
    // meant to name — a copy-pasted key that picks up a trailing newline
    // matches nothing and reports NOT_FOUND, which reads like "the file is
    // gone" rather than "your input had whitespace". Trimming to empty is
    // treated as no key at all, i.e. a normal batch.
    const body = await req.json().catch(() => ({}));
    const rawKey = typeof body?.key === "string" ? body.key.trim() : "";
    const requestedKey = rawKey.length > 0 ? rawKey : null;

    return await runScan(requestedKey);
  } catch (error) {
    return failed(error);
  }
}
