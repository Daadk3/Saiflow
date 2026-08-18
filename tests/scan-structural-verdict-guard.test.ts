/**
 * The structural consumer is explicit-ALLOW-only.
 *
 * `PolicyVerdict` is shared by `structuralVerdict` and `verdictFromFindings`,
 * so widening it to carry UNVERIFIABLE widened what BOTH call sites can
 * receive. The provider site was given an explicit-ALLOW guard; this file
 * exists because the structural site needs the same one, and because a source
 * assertion cannot prove a guard actually fires.
 *
 * Falling through at the structural site would not settle SAFE by itself — but
 * it would discard the structural result and let a provider ALLOW carry the
 * file to SAFE, which is an unverifiable structural pass silently upgraded to
 * a passing one. That is the failure mode pinned below.
 *
 * `structuralVerdict` itself is NOT modified. It is replaced for the duration
 * of these tests so the guard can be driven with outcomes the real function
 * does not currently produce, which is the only way to exercise a branch whose
 * whole purpose is to catch a future change.
 *
 * No provider, no network, no database: prisma and storage are mocked, and the
 * scanner is a local fake that records whether it was reached.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ScanFindings, ScanProvider } from "../lib/scan/provider";
import type { PolicyVerdict } from "../lib/scan/policy";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 16 bytes of "%PDF" + padding: enough for the real format sniffer. */
const PDF_BYTES = (() => {
  const b = new Uint8Array(16);
  b.set([0x25, 0x50, 0x44, 0x46]);
  return b;
})();

/** A clean, complete set of findings. The provider's happy path. */
const CLEAN_FINDINGS: ScanFindings = {
  clean: true,
  verifiedFileFormat: ".pdf",
  containsExecutable: false,
  containsInvalidFile: false,
  containsScript: false,
  containsPasswordProtectedFile: false,
  containsRestrictedFileFormat: false,
  containsMacros: false,
  containsXmlExternalEntities: false,
  containsInsecureDeserialization: false,
  containsHtml: false,
  containsUnsafeArchive: false,
  containsOleEmbeddedObject: false,
  virusNames: [],
};

const state = {
  /** What the replaced structuralVerdict hands back. */
  structural: { outcome: "ALLOW" } as PolicyVerdict,
  /** Whether the provider was reached at all. */
  providerCalled: false,
  /** The row data finalizeVerdict actually wrote. */
  written: null as Record<string, unknown> | null,
};

function reset() {
  state.structural = { outcome: "ALLOW" };
  state.providerCalled = false;
  state.written = null;
}

const fakeProvider: ScanProvider = {
  id: "fake",
  isConfigured: () => true,
  scan: async () => {
    state.providerCalled = true;
    return { ok: true, findings: CLEAN_FINDINGS };
  },
};

let scanFileAsset: (
  key: string,
  opts?: { provider?: ScanProvider; now?: Date }
) => Promise<{ key: string; outcome: string; reason?: string }>;

before(async () => {
  // The real policy module, captured BEFORE the mock is installed, so the
  // replacement can delegate everything except structuralVerdict.
  const realPolicy = await import("../lib/scan/policy.ts");

  mock.module(pathToFileURL(resolve(ROOT, "lib/scan/policy.ts")).href, {
    namedExports: {
      ...realPolicy,
      structuralVerdict: () => state.structural,
    },
  });

  const tx = {
    fileAsset: {
      updateMany: async (args: { data: Record<string, unknown> }) => {
        state.written = args.data;
        return { count: 1 };
      },
    },
    // No product rows, so no moderation event is written and the audit path
    // stays out of these assertions.
    product: {
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
    moderationEvent: { createMany: async () => ({ count: 0 }) },
  };

  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        fileAsset: {
          findUnique: async () => ({
            key: "k",
            shopId: "shop1",
            route: "PRODUCT_FILE",
            name: "sample.pdf",
            scanStatus: "PENDING_SCAN",
            scanAttempts: 0,
            scanAt: null,
          }),
          // The claim.
          updateMany: async () => ({ count: 1 }),
        },
        product: {
          findFirst: async () => ({ id: "p1" }),
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
        },
        $transaction: async (cb: (t: typeof tx) => Promise<boolean>) => cb(tx),
      },
    },
  });

  mock.module("@/lib/storage/provider", {
    namedExports: {
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      readPrivateObject: async () => ({ ok: true, bytes: PDF_BYTES }),
    },
  });

  scanFileAsset = (await import("../lib/scan/run.ts"))
    .scanFileAsset as typeof scanFileAsset;
});

beforeEach(reset);

/* ------------------------------------------------------------------ */
/* The guard fires                                                     */
/* ------------------------------------------------------------------ */

describe("a non-ALLOW structural verdict cannot fall through", () => {
  test("UNVERIFIABLE settles SCAN_ERROR / unknown_verdict", async () => {
    state.structural = { outcome: "UNVERIFIABLE", reason: "format_not_verified" };

    const report = await scanFileAsset("k", { provider: fakeProvider });

    assert.equal(report.outcome, "SCAN_ERROR");
    assert.equal(report.reason, "unknown_verdict");
    assert.equal(state.written?.scanStatus, "SCAN_ERROR");
    assert.equal(state.written?.scanReason, "unknown_verdict");
  });

  test("the provider is never reached once the guard fires", async () => {
    // The point of stopping here: an unverifiable structural pass must not be
    // handed to the scanner, whose ALLOW would then carry the file to SAFE.
    state.structural = { outcome: "UNVERIFIABLE", reason: "whatever" };

    await scanFileAsset("k", { provider: fakeProvider });

    assert.equal(state.providerCalled, false, "no provider call may be spent");
  });

  test("an unknown future outcome also fails closed", async () => {
    // Not reachable through the current type. That is exactly why the guard is
    // `!== "ALLOW"` rather than a list of known outcomes.
    for (const outcome of ["MAYBE", "PENDING", "allow", "Allow", ""]) {
      reset();
      state.structural = { outcome } as unknown as PolicyVerdict;

      const report = await scanFileAsset("k", { provider: fakeProvider });

      assert.equal(report.outcome, "SCAN_ERROR", outcome);
      assert.equal(report.reason, "unknown_verdict", outcome);
      assert.equal(state.providerCalled, false, outcome);
    }
  });

  test("the structural reason is NOT copied into the reason on this path", async () => {
    // A structural reason is a policy label today, but this branch exists for
    // outcomes we have not designed yet. It records a fixed token rather than
    // whatever the unknown verdict happened to carry.
    state.structural = {
      outcome: "SOMETHING_NEW",
      reason: "attacker-controlled-looking-value",
    } as unknown as PolicyVerdict;

    const report = await scanFileAsset("k", { provider: fakeProvider });

    assert.equal(report.reason, "unknown_verdict");
    assert.equal(state.written?.scanReason, "unknown_verdict");
  });
});

/* ------------------------------------------------------------------ */
/* The guard does not break the two real outcomes                      */
/* ------------------------------------------------------------------ */

describe("ALLOW and REJECT are unaffected", () => {
  test("ALLOW still proceeds to the provider and can reach SAFE", async () => {
    state.structural = { outcome: "ALLOW" };

    const report = await scanFileAsset("k", { provider: fakeProvider });

    assert.equal(state.providerCalled, true, "ALLOW must continue to the scan");
    assert.equal(report.outcome, "SAFE");
    assert.equal(state.written?.scanStatus, "SAFE");
    assert.equal(state.written?.scanReason, null, "SAFE records no reason");
  });

  test("REJECT still settles UNSAFE with its own reason, before the guard", async () => {
    state.structural = { outcome: "REJECT", reason: "archive_symlink" };

    const report = await scanFileAsset("k", { provider: fakeProvider });

    assert.equal(report.outcome, "UNSAFE");
    assert.equal(report.reason, "archive_symlink");
    assert.equal(state.written?.scanStatus, "UNSAFE");
    assert.equal(state.providerCalled, false, "a rejection costs no scan");
  });

  test("REJECT is matched before the ALLOW guard, not swallowed by it", async () => {
    // If the guard had been placed above the REJECT branch, every structural
    // rejection would have become SCAN_ERROR / unknown_verdict and lost its
    // reason — a real regression this pins against.
    state.structural = { outcome: "REJECT", reason: "archive_path_traversal" };

    const report = await scanFileAsset("k", { provider: fakeProvider });

    assert.notEqual(report.reason, "unknown_verdict");
    assert.equal(report.reason, "archive_path_traversal");
  });
});
