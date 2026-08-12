/**
 * The scan pipeline.
 *
 * Order matters and is deliberate:
 *
 *   1. claim the attempt (persisted BEFORE any work, so a crash still counts)
 *   2. read the private bytes by key
 *   3. hash exactly those bytes
 *   4. establish the format from those bytes
 *   5. apply SaiFlow's structural policy — a rejection here costs no scan
 *   6. ask the provider
 *   7. persist the verdict, bound to the key that was scanned
 *
 * Every failure between steps 2 and 6 becomes SCAN_ERROR. There is no path to
 * SAFE that skips a successful provider verdict, and no path at all from an
 * exception to SAFE.
 */

import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_SCANNABLE_BYTES, readPrivateObject } from "@/lib/storage/provider";
import { cloudmersiveProvider } from "./cloudmersive";
import {
  resolveContentPolicy,
  structuralVerdict,
  verdictFromFindings,
} from "./policy";
import { isRetryableFailure, type ScanProvider } from "./provider";

/** Total attempts across invocations before a file is left terminally errored. */
export const MAX_SCAN_ATTEMPTS = 3;

/**
 * How long a worker may hold a claim before another may take it over.
 *
 * Comfortably longer than the worker's own 300s budget, so a live worker is
 * never overtaken mid-scan, while one that died still frees its asset.
 */
export const SCAN_LEASE_MS = 10 * 60_000;

export type ScanRunOutcome =
  | "SAFE"
  | "UNSAFE"
  | "SCAN_ERROR"
  | "SKIPPED_SETTLED"
  | "SKIPPED_ATTEMPTS_EXHAUSTED"
  | "SKIPPED_BACKOFF"
  | "SKIPPED_WRONG_ROUTE"
  | "SKIPPED_NOT_ATTACHED"
  | "SKIPPED_NOT_CLAIMED"
  | "STALE_CLAIM"
  | "NOT_FOUND"
  | "PROVIDER_UNCONFIGURED";

export interface ScanRunReport {
  key: string;
  outcome: ScanRunOutcome;
  /** Short category, never a provider payload and never file contents. */
  reason?: string;
}

interface RetryState {
  scanStatus: string;
  scanAttempts: number;
  scanAt: Date | null;
}

/**
 * Backoff between invocations rather than inside one.
 *
 * Sleeping inside a serverless function burns the duration budget the scan
 * itself needs, so a failed attempt simply becomes ineligible until enough
 * time has passed: 1, 2 then 4 minutes.
 */
export function isEligibleNow(asset: RetryState, now: Date = new Date()): boolean {
  if (asset.scanStatus === "SAFE" || asset.scanStatus === "UNSAFE") return false;
  if (asset.scanAttempts >= MAX_SCAN_ATTEMPTS) return false;
  if (!asset.scanAt) return true;
  const backoffMs = 2 ** asset.scanAttempts * 60_000;
  return now.getTime() - asset.scanAt.getTime() >= backoffMs;
}

export function sha256Hex(bytes: Uint8Array): string {
  // No Buffer.from copy: update() accepts a Uint8Array, and at a 128MB
  // ceiling a redundant copy would add a full-size buffer to peak memory.
  return createHash("sha256").update(bytes).digest("hex");
}


/* ------------------------------------------------------------------ */
/* Atomic claim                                                        */
/* ------------------------------------------------------------------ */

/**
 * Backoff expressed as WHERE clauses so eligibility is decided by the
 * database, not by a value this process read a moment ago.
 *
 * Attempts can only be 0, 1 or 2 while a row is still eligible, so the ladder
 * is enumerable rather than approximate: 1, 2 then 4 minutes.
 */
function backoffClauses(now: Date): Prisma.FileAssetWhereInput[] {
  const clauses: Prisma.FileAssetWhereInput[] = [{ scanAt: null }];
  for (let attempts = 0; attempts < MAX_SCAN_ATTEMPTS; attempts++) {
    clauses.push({
      scanAttempts: attempts,
      scanAt: { lt: new Date(now.getTime() - 2 ** attempts * 60_000) },
    });
  }
  return clauses;
}

/**
 * Take exclusive ownership of one scan attempt.
 *
 * This is a single conditional UPDATE. Postgres serialises it, so of two
 * workers racing for the same asset exactly one sees `count === 1`; the other
 * matches nothing and stops before spending a provider call. Reading
 * eligibility and then writing separately — which is what this replaces —
 * let both pass the read and both scan.
 *
 * The same statement increments the attempt counter, so attempts can never
 * exceed MAX_SCAN_ATTEMPTS regardless of concurrency: the `lt` guard and the
 * increment are the same atomic operation.
 */
async function claimScan(
  key: string,
  now: Date
): Promise<{ claimed: true; token: string } | { claimed: false }> {
  const token = randomUUID();
  const leaseCutoff = new Date(now.getTime() - SCAN_LEASE_MS);

  const result = await prisma.fileAsset.updateMany({
    where: {
      key,
      // Quota: only real deliverables are ever scanned.
      route: "PRODUCT_FILE",
      // Settled verdicts are never reclaimed, so UNSAFE cannot be revisited.
      scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] },
      scanAttempts: { lt: MAX_SCAN_ATTEMPTS },
      AND: [
        // Free, or held by a worker that has plainly died.
        { OR: [{ scanClaimToken: null }, { scanClaimedAt: { lt: leaseCutoff } }] },
        { OR: backoffClauses(now) },
      ],
    },
    data: {
      scanAttempts: { increment: 1 },
      scanAt: now,
      scanClaimToken: token,
      scanClaimedAt: now,
    },
  });

  return result.count === 1 ? { claimed: true, token } : { claimed: false };
}

/**
 * Write the verdict, but only if this worker still holds the claim.
 *
 * Two guards, each closing a different race:
 *
 *   scanClaimToken: token   — a worker whose lease expired and was taken over
 *                             cannot write a verdict for bytes someone else
 *                             has since re-scanned.
 *   scanStatus: unsettled   — once SAFE or UNSAFE is recorded it is terminal,
 *                             so a slow worker cannot overwrite UNSAFE with a
 *                             later SAFE.
 *
 * Product propagation happens only when that conditional update actually
 * matched, inside the same transaction. A stale worker changes nothing at all.
 */
async function finalizeVerdict(params: {
  key: string;
  token: string;
  status: "SAFE" | "UNSAFE" | "SCAN_ERROR";
  reason: string | null;
  sha256: string | null;
  providerId: string;
}): Promise<boolean> {
  const { key, token, status, reason, sha256, providerId } = params;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const finalized = await tx.fileAsset.updateMany({
      where: {
        key,
        scanClaimToken: token,
        scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] },
      },
      data: {
        scanStatus: status,
        scanReason: reason,
        scanSha256: sha256,
        scanAt: now,
        scanClaimToken: null,
        scanClaimedAt: null,
      },
    });

    if (finalized.count !== 1) return false;

    // `where: { fileKey: key }` is the other half of the safety property. A
    // product pointed at a different upload has a different fileKey, matches
    // nothing, and keeps its own state — so a late verdict for file A can
    // never mark replacement file B safe.
    const affected = await tx.product.findMany({
      where: { fileKey: key },
      select: { id: true, moderationStatus: true },
    });

    await tx.product.updateMany({
      where: { fileKey: key },
      data: {
        fileScanStatus: status,
        fileScanKey: key,
        fileScanSha256: sha256,
        fileScanAt: now,
      },
    });

    if (affected.length > 0) {
      await tx.moderationEvent.createMany({
        data: affected.map((product) => ({
          productId: product.id,
          action: "SCANNED" as const,
          actor: `scanner:${providerId}`,
          // Category only. No signature detail, no provider payload, no bytes.
          reason: reason
            ? `file-scan:${status.toLowerCase()}:${reason}`
            : `file-scan:${status.toLowerCase()}`,
          categories: reason ? [reason] : [],
          // A scan never moves the moderation state by itself.
          previousStatus: product.moderationStatus,
          newStatus: product.moderationStatus,
        })),
      });
    }

    return true;
  });
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scan one stored object.
 *
 * Idempotent and quota-bounded: a settled file is skipped, a non-deliverable
 * is refused, and an object no product actually uses is never sent to the
 * provider.
 */
export async function scanFileAsset(
  key: string,
  opts: { provider?: ScanProvider; now?: Date } = {}
): Promise<ScanRunReport> {
  const provider = opts.provider ?? cloudmersiveProvider;
  const now = opts.now ?? new Date();

  const asset = await prisma.fileAsset.findUnique({ where: { key } });
  if (!asset) return { key, outcome: "NOT_FOUND" };

  // Quota: thumbnails, logos and covers are never scanned, even when a key is
  // requested explicitly. They are public raster images under different size
  // rules and are not sold to anyone.
  if (asset.route !== "PRODUCT_FILE") {
    return { key, outcome: "SKIPPED_WRONG_ROUTE" };
  }

  if (asset.scanStatus === "SAFE" || asset.scanStatus === "UNSAFE") {
    return { key, outcome: "SKIPPED_SETTLED" };
  }
  if (asset.scanAttempts >= MAX_SCAN_ATTEMPTS) {
    return { key, outcome: "SKIPPED_ATTEMPTS_EXHAUSTED" };
  }

  /**
   * Quota: only files a product actually uses are worth scanning.
   *
   * Without this, any seller could upload repeatedly and abandon the uploads,
   * spending a Cloudmersive call each time and starving the queue for
   * everyone else. Requiring an attachment in the SAME shop as the upload's
   * provenance also means a key cannot be queued on someone else's behalf.
   */
  const attached = await prisma.product.findFirst({
    where: { fileKey: key, shopId: asset.shopId },
    select: { id: true },
  });
  if (!attached) return { key, outcome: "SKIPPED_NOT_ATTACHED" };

  // Refuse before spending anything if the provider cannot answer. Returning
  // early — rather than recording SCAN_ERROR — keeps an unconfigured
  // environment from manufacturing failures it never actually attempted, and
  // from burning the retry budget for them.
  if (!provider.isConfigured()) {
    return { key, outcome: "PROVIDER_UNCONFIGURED" };
  }

  // Everything above is advisory; THIS is the authoritative gate. The claim
  // re-evaluates eligibility inside a single atomic statement, so a decision
  // made from the stale read above cannot let a second worker through.
  const claim = await claimScan(key, now);
  if (!claim.claimed) return { key, outcome: "SKIPPED_NOT_CLAIMED" };
  const { token } = claim;

  const settle = async (
    status: "SAFE" | "UNSAFE" | "SCAN_ERROR",
    reason: string | null,
    sha256: string | null
  ): Promise<ScanRunReport> => {
    const written = await finalizeVerdict({
      key,
      token,
      status,
      reason,
      sha256,
      providerId: provider.id,
    });
    if (!written) return { key, outcome: "STALE_CLAIM" };
    return reason
      ? { key, outcome: status, reason }
      : { key, outcome: status };
  };

  const read = await readPrivateObject(key, { maxBytes: MAX_SCANNABLE_BYTES });
  if (!read.ok) return settle("SCAN_ERROR", `storage_${read.reason}`, null);

  const bytes = read.bytes;

  // Hashed before anything else touches the buffer, so the digest provably
  // describes the same bytes the provider is about to receive.
  let digest: string;
  try {
    digest = sha256Hex(bytes);
  } catch {
    return settle("SCAN_ERROR", "hash_failed", null);
  }

  const policy = resolveContentPolicy(bytes);
  if (!policy) {
    // The bytes are not one of the families SaiFlow sells. This is the check
    // that catches an executable uploaded as "application/pdf".
    return settle("UNSAFE", "unrecognised_format", digest);
  }

  const structural = structuralVerdict(bytes, policy);
  if (structural.outcome === "REJECT") {
    return settle("UNSAFE", structural.reason, digest);
  }

  let result;
  try {
    result = await provider.scan({
      bytes,
      fileName: asset.name,
      restrictToExtensions: policy.restrictToExtensions,
      allowHtml: policy.allowHtml,
    });
  } catch {
    // A provider that throws is a provider that did not answer.
    return settle("SCAN_ERROR", "provider_threw", digest);
  }

  if (!result.ok) {
    const reason = isRetryableFailure(result.failure)
      ? `provider_${result.failure}`
      : `provider_${result.failure}_terminal`;
    return settle("SCAN_ERROR", reason, digest);
  }

  const verdict = verdictFromFindings(result.findings, policy);
  if (verdict.outcome === "REJECT") {
    return settle("UNSAFE", verdict.reason, digest);
  }

  // The only path to SAFE: claimed, bytes read, hashed, format recognised,
  // structural policy passed, and an explicit parseable clean verdict whose
  // content-verified format agrees with ours.
  return settle("SAFE", null, digest);
}

/**
 * Keys awaiting a verdict: deliverables only, attached to a product in the
 * same shop, within attempts and backoff. Oldest first.
 */
export async function findScannableKeys(
  limit = 5,
  now: Date = new Date()
): Promise<string[]> {
  const candidates = await prisma.fileAsset.findMany({
    where: {
      route: "PRODUCT_FILE",
      scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] },
      scanAttempts: { lt: MAX_SCAN_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: limit * 8,
    select: { key: true, shopId: true, scanStatus: true, scanAttempts: true, scanAt: true },
  });

  const eligible = candidates.filter((c) => isEligibleNow(c, now));
  if (eligible.length === 0) return [];

  // Attached to a product in the SAME shop that uploaded it. Abandoned uploads
  // never reach the provider.
  const shopByKey = new Map(eligible.map((c) => [c.key, c.shopId]));
  const attachments = await prisma.product.findMany({
    where: { fileKey: { in: eligible.map((c) => c.key) } },
    select: { fileKey: true, shopId: true },
  });
  const attachedKeys = new Set(
    attachments
      .filter((p) => p.fileKey && shopByKey.get(p.fileKey) === p.shopId)
      .map((p) => p.fileKey as string)
  );

  return eligible
    .filter((c) => attachedKeys.has(c.key))
    .slice(0, limit)
    .map((c) => c.key);
}
