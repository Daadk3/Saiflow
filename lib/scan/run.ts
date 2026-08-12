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

import { createHash } from "node:crypto";

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

export type ScanRunOutcome =
  | "SAFE"
  | "UNSAFE"
  | "SCAN_ERROR"
  | "SKIPPED_SETTLED"
  | "SKIPPED_ATTEMPTS_EXHAUSTED"
  | "SKIPPED_BACKOFF"
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
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

/**
 * Write the verdict for `key`, and propagate it to any product currently
 * carrying that key.
 *
 * `where: { fileKey: key }` is the whole safety property. A product that has
 * since been pointed at a different upload has a different fileKey, matches
 * nothing, and is left alone — so a verdict for file A can never mark
 * replacement file B safe, however late it arrives.
 */
async function persistVerdict(params: {
  key: string;
  status: "SAFE" | "UNSAFE" | "SCAN_ERROR";
  reason: string | null;
  sha256: string | null;
  providerId: string;
}): Promise<void> {
  const { key, status, reason, sha256, providerId } = params;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.fileAsset.update({
      where: { key },
      data: {
        scanStatus: status,
        scanReason: reason,
        scanSha256: sha256,
        scanAt: now,
      },
    });

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
          reason: reason ? `file-scan:${status.toLowerCase()}:${reason}` : `file-scan:${status.toLowerCase()}`,
          categories: reason ? [reason] : [],
          // A scan never moves the moderation state by itself.
          previousStatus: product.moderationStatus,
          newStatus: product.moderationStatus,
        })),
      });
    }
  });
}

/**
 * Scan one stored object.
 *
 * Idempotent: a settled file is skipped, so re-running the worker cannot
 * re-bill the provider or overwrite a verdict.
 */
export async function scanFileAsset(
  key: string,
  opts: { provider?: ScanProvider; now?: Date } = {}
): Promise<ScanRunReport> {
  const provider = opts.provider ?? cloudmersiveProvider;
  const now = opts.now ?? new Date();

  const asset = await prisma.fileAsset.findUnique({ where: { key } });
  if (!asset) return { key, outcome: "NOT_FOUND" };

  if (asset.scanStatus === "SAFE" || asset.scanStatus === "UNSAFE") {
    return { key, outcome: "SKIPPED_SETTLED" };
  }
  if (asset.scanAttempts >= MAX_SCAN_ATTEMPTS) {
    return { key, outcome: "SKIPPED_ATTEMPTS_EXHAUSTED" };
  }
  if (!isEligibleNow(asset, now)) {
    return { key, outcome: "SKIPPED_BACKOFF" };
  }

  // Refuse before spending anything if the provider cannot answer. Returning
  // early — rather than recording SCAN_ERROR — keeps an unconfigured
  // environment from manufacturing failures it never actually attempted.
  if (!provider.isConfigured()) {
    return { key, outcome: "PROVIDER_UNCONFIGURED" };
  }

  // Claim the attempt first. If this invocation dies anywhere below, the
  // counter has already moved, so a crash loop cannot retry without bound.
  await prisma.fileAsset.update({
    where: { key },
    data: { scanAttempts: { increment: 1 }, scanAt: now },
  });

  const read = await readPrivateObject(key, { maxBytes: MAX_SCANNABLE_BYTES });
  if (!read.ok) {
    await persistVerdict({
      key,
      status: "SCAN_ERROR",
      reason: `storage_${read.reason}`,
      sha256: null,
      providerId: provider.id,
    });
    return { key, outcome: "SCAN_ERROR", reason: `storage_${read.reason}` };
  }

  const bytes = read.bytes;

  // Hashed before anything else touches the buffer, so the digest provably
  // describes the same bytes the provider is about to receive.
  let digest: string;
  try {
    digest = sha256Hex(bytes);
  } catch {
    await persistVerdict({
      key,
      status: "SCAN_ERROR",
      reason: "hash_failed",
      sha256: null,
      providerId: provider.id,
    });
    return { key, outcome: "SCAN_ERROR", reason: "hash_failed" };
  }

  const policy = resolveContentPolicy(bytes);
  if (!policy) {
    // The bytes are not one of the families SaiFlow sells. This is the check
    // that catches an executable uploaded as "application/pdf".
    await persistVerdict({
      key,
      status: "UNSAFE",
      reason: "unrecognised_format",
      sha256: digest,
      providerId: provider.id,
    });
    return { key, outcome: "UNSAFE", reason: "unrecognised_format" };
  }

  const structural = structuralVerdict(bytes, policy);
  if (structural.outcome === "REJECT") {
    await persistVerdict({
      key,
      status: "UNSAFE",
      reason: structural.reason,
      sha256: digest,
      providerId: provider.id,
    });
    return { key, outcome: "UNSAFE", reason: structural.reason };
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
    await persistVerdict({
      key,
      status: "SCAN_ERROR",
      reason: "provider_threw",
      sha256: digest,
      providerId: provider.id,
    });
    return { key, outcome: "SCAN_ERROR", reason: "provider_threw" };
  }

  if (!result.ok) {
    const reason = isRetryableFailure(result.failure)
      ? `provider_${result.failure}`
      : `provider_${result.failure}_terminal`;
    await persistVerdict({
      key,
      status: "SCAN_ERROR",
      reason,
      sha256: digest,
      providerId: provider.id,
    });
    return { key, outcome: "SCAN_ERROR", reason };
  }

  const verdict = verdictFromFindings(result.findings, policy);
  if (verdict.outcome === "REJECT") {
    await persistVerdict({
      key,
      status: "UNSAFE",
      reason: verdict.reason,
      sha256: digest,
      providerId: provider.id,
    });
    return { key, outcome: "UNSAFE", reason: verdict.reason };
  }

  // The only path to SAFE: bytes read, hashed, format recognised, structural
  // policy passed, and an explicit clean verdict from the provider.
  await persistVerdict({
    key,
    status: "SAFE",
    reason: null,
    sha256: digest,
    providerId: provider.id,
  });
  return { key, outcome: "SAFE" };
}

/** Keys awaiting a verdict, oldest first, respecting attempts and backoff. */
export async function findScannableKeys(limit = 5, now: Date = new Date()): Promise<string[]> {
  const candidates = await prisma.fileAsset.findMany({
    where: {
      scanStatus: { in: ["PENDING_SCAN", "SCAN_ERROR"] },
      scanAttempts: { lt: MAX_SCAN_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: limit * 4,
    select: { key: true, scanStatus: true, scanAttempts: true, scanAt: true },
  });

  return candidates
    .filter((c) => isEligibleNow(c, now))
    .slice(0, limit)
    .map((c) => c.key);
}
