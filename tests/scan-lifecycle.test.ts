/**
 * Phase 1 of the scan-pipeline fix: no attached file stays "scanning"
 * forever.
 *
 *   - attaching or replacing a file schedules a scan of that key, after the
 *     response, through Next's `after` — no Cron, no fetch, no secret
 *   - the seller sees uploaded, scanning, passed or failed; failed carries a
 *     safe reason and, where a retry can help, a retry
 *   - the retry route lets an owner or an admin re-open a failed scan only,
 *     resets exactly what another attempt needs, is rate-limited, and
 *     schedules that one key
 *   - SAFE and UNSAFE stay terminal; the gates are untouched
 */

import { test, describe, mock, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const OWNER = "owner@saiflow.test";
const STRANGER = "someone@example.test";
const ADMIN = "founder@saiflow.test";
process.env.ADMIN_EMAILS = ADMIN;
process.env.UPLOADTHING_APP_ID = "testapp";

const KEY = "attachedKeyAAAA1111";
const NEW_KEY = "replacementKeyBBBB2222";
const fileUrl = (key: string) => `https://testapp.ufs.sh/f/${key}`;

const NOW = new Date("2026-09-23T12:00:00Z");
/**
 * The clock fixtures are built from. Pure derivation tests pass NOW into the
 * function under test, so they keep the fixed clock; the route tests cannot
 * inject a clock, so they switch the base to the real one (see useRealClock).
 */
let base = NOW;
const minutes = (n: number) => new Date(base.getTime() - n * 60_000);
const useRealClock = () => {
  beforeEach(() => {
    base = new Date();
  });
  afterEach(() => {
    base = NOW;
  });
};

const state = {
  session: null as unknown,
  afterTasks: [] as (() => Promise<void>)[],
  afterThrows: false,
  asset: null as Record<string, unknown> | null,
  product: null as Record<string, unknown> | null,
  assetResets: [] as unknown[],
  productResets: [] as unknown[],
  reconciled: [] as string[],
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  existing: null as Record<string, unknown> | null,
};

function reset() {
  state.session = { user: { email: OWNER, id: "user_owner" } };
  state.afterTasks = [];
  state.afterThrows = false;
  state.asset = null;
  state.product = null;
  state.assetResets = [];
  state.productResets = [];
  state.reconciled = [];
  state.created = [];
  state.updated = [];
  state.existing = null;
}
reset();

let scheduleScan: (key: string) => boolean;
let sellerFileState: typeof import("../lib/seller-file-state.ts").sellerFileState;
let failureCategory: typeof import("../lib/seller-file-state.ts").failureCategory;
let SCAN_WINDOW_MS: number;
let rescanDecision: typeof import("../lib/scan/rescan.ts").rescanDecision;
let RESCAN: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
let CREATE: (req: Request) => Promise<Response>;
let REPLACE: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function mockTx() {
  return {
    product: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "prod_new", ...data };
        state.created.push(row);
        return row;
      },
    },
    moderationEvent: { create: async () => ({}) },
  };
}

before(async () => {
  mock.module("next/server", {
    namedExports: {
      after: (task: () => Promise<void>) => {
        if (state.afterThrows) throw new Error("`after` was called outside a request scope");
        state.afterTasks.push(task);
      },
      NextResponse: {
        json: (body: unknown, init?: ResponseInit) =>
          new Response(JSON.stringify(body), {
            ...init,
            headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
          }),
      },
    },
  });
  mock.module("next-auth", {
    namedExports: { getServerSession: async () => state.session },
  });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, {
    namedExports: { authOptions: {} },
  });
  mock.module("@/lib/scan/cloudmersive", {
    namedExports: {
      cloudmersiveProvider: {
        id: "cloudmersive-test",
        isConfigured: () => true,
        scan: async () => ({ ok: false, failure: "network" }),
      },
    },
  });
  mock.module("@/lib/storage/provider", {
    namedExports: {
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      readPrivateObject: async () => ({ ok: false, reason: "fetch_failed" }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          findUnique: async () => state.product ?? state.existing,
          // The worker scans only files a product actually uses: answer "attached".
          findFirst: async () => ({ id: "prod_1" }),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: "prod_new", ...data };
            state.created.push(row);
            return row;
          },
          update: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { ...(state.existing ?? {}), ...data };
            state.updated.push(row);
            return row;
          },
          updateMany: async (args: unknown) => {
            state.productResets.push(args);
            return { count: 1 };
          },
        },
        fileAsset: {
          findUnique: async () => state.asset,
          findMany: async () => (state.asset ? [state.asset] : []),
          updateMany: async (args: { where: Record<string, unknown> }) => {
            state.assetResets.push(args);
            const row = state.asset;
            if (!row) return { count: 0 };
            const settled = row.scanStatus === "SAFE" || row.scanStatus === "UNSAFE";
            if (settled) return { count: 0 };
            // Honour the lease guard the way Postgres would. The row matches
            // only when `scanClaimToken IS NULL OR scanClaimedAt < cutoff`;
            // a null timestamp compares as unknown, so a token with no
            // timestamp satisfies neither side and the row is held.
            const guard = (args.where.AND as { OR: [{ scanClaimToken: null }, { scanClaimedAt: { lt: Date } }] }[] | undefined)?.[0];
            if (guard) {
              const cutoff = guard.OR[1].scanClaimedAt.lt;
              const token = row.scanClaimToken as string | null;
              const at = row.scanClaimedAt as Date | null;
              const free = token === null;
              const stale = at !== null && at < cutoff;
              if (!free && !stale) return { count: 0 };
            }
            return { count: 1 };
          },
        },
        user: { findFirst: async () => ({ id: "user_owner", email: OWNER }) },
        shopUser: { findFirst: async () => ({ userId: "user_owner", shopId: "shop_1" }) },
        moderationEvent: { create: async () => ({}), createMany: async () => ({}) },
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx()),
      },
    },
  });
  mock.module("@/lib/file-safety", {
    namedExports: {
      verifyDeliverableProvenance: async (key: string) => ({
        ok: true,
        asset: { key, scanStatus: "PENDING_SCAN", scanSha256: null, scanAt: null },
      }),
      attachedScanFields: () => ({
        fileScanStatus: "PENDING_SCAN",
        fileScanKey: null,
        fileScanSha256: null,
        fileScanAt: null,
        fileScanAttempts: 0,
      }),
      reconcileProductScanState: async (productId: string) => {
        state.reconciled.push(productId);
      },
      deliverableGateReason: (p: { fileKey: string | null; fileScanStatus: string; fileScanKey: string | null }) => {
        if (p.fileKey === null) return "missing_file_key";
        if (p.fileScanStatus === "UNSAFE") return "unsafe";
        if (p.fileScanStatus === "SCAN_ERROR") return "scan_error";
        if (p.fileScanStatus === "PENDING_SCAN") return "pending_scan";
        return p.fileScanKey === p.fileKey ? "safe" : "scan_key_mismatch";
      },
      SAFE_DELIVERABLE_WHERE: {},
      isDeliverableSafe: () => false,
    },
  });

  const schedule = await import("../lib/scan/schedule.ts");
  scheduleScan = schedule.scheduleScan;
  const seller = await import("../lib/seller-file-state.ts");
  sellerFileState = seller.sellerFileState;
  failureCategory = seller.failureCategory;
  SCAN_WINDOW_MS = seller.SCAN_WINDOW_MS;
  rescanDecision = (await import("../lib/scan/rescan.ts")).rescanDecision;
  RESCAN = (await import("../app/api/products/[id]/rescan/route.ts")).POST as typeof RESCAN;
  CREATE = (await import("../app/api/products/route.ts")).POST as typeof CREATE;
  REPLACE = (await import("../app/api/products/[id]/route.ts")).PUT as typeof REPLACE;
});

beforeEach(reset);

/** Run everything `after` collected, the way the platform would post-response. */
async function drainAfter() {
  const tasks = state.afterTasks.splice(0);
  for (const task of tasks) await task();
}

const asset = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  shopId: "shop_1",
  route: "PRODUCT_FILE",
  scanStatus: "PENDING_SCAN",
  scanAttempts: 0,
  scanAt: null,
  scanReason: null,
  scanClaimToken: null,
  scanClaimedAt: null,
  createdAt: minutes(1),
  ...over,
});
/** A claim a worker took `ageMinutes` ago. */
const claimedBy = (ageMinutes: number) => ({
  scanClaimToken: "live-lease-token",
  scanClaimedAt: minutes(ageMinutes),
});
const product = (over: Record<string, unknown> = {}) => ({
  id: "prod_1",
  shopId: "shop_1",
  fileKey: KEY,
  fileScanStatus: "PENDING_SCAN",
  fileScanKey: null,
  updatedAt: minutes(1),
  shop: { shopUsers: [{ user: { email: OWNER } }] },
  ...over,
});

/* ------------------------------------------------------------------ */
/* 1. The scheduler                                                    */
/* ------------------------------------------------------------------ */

describe("scheduleScan runs the worker after the response, for one key", () => {
  test("it hands `after` a task that scans exactly the given key", async () => {
    // The worker is real here; its storage read is faked to fail, so the run
    // settles without a provider call. What matters is which key it touched.
    state.asset = asset();
    assert.equal(scheduleScan(KEY), true);
    assert.equal(state.afterTasks.length, 1);
    await drainAfter();
    for (const call of state.assetResets as { where: { key: string } }[]) {
      assert.equal(call.where.key, KEY);
    }
    assert.ok(state.assetResets.length >= 1, "the worker claimed the key");
  });

  test("outside a request scope it degrades to the sweeper instead of throwing", () => {
    state.afterThrows = true;
    assert.equal(scheduleScan(KEY), false);
    assert.equal(state.afterTasks.length, 0);
  });

  test("the scheduler needs no Cron secret and makes no HTTP call", () => {
    const code = strip(read("lib/scan/schedule.ts"));
    assert.ok(/import \{ after \} from "next\/server"/.test(code));
    assert.ok(!/CRON_SECRET|fetch\(|Authorization/.test(code));
    assert.ok(/scanFileAsset\(key\)/.test(code));
  });

  test("every route that schedules a scan carries the worker's duration budget", () => {
    for (const f of ["app/api/products/route.ts", "app/api/products/[id]/route.ts", "app/api/products/[id]/rescan/route.ts"]) {
      assert.ok(/export const maxDuration = 300;/.test(read(f)), f);
    }
    const vercel = JSON.parse(read("vercel.json")) as { functions: Record<string, { maxDuration: number }> };
    for (const key of ["app/api/products/route.ts", "app/api/products/\\[id\\]/route.ts", "app/api/products/\\[id\\]/rescan/route.ts"]) {
      assert.equal(vercel.functions[key]?.maxDuration, 300, key);
    }
  });

  test("the Cron sweeper is untouched", () => {
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(vercel.crons, [{ path: "/api/internal/scan", schedule: "*/5 * * * *" }]);
    assert.ok(/export async function GET/.test(read("app/api/internal/scan/route.ts")));
  });
});

/* ------------------------------------------------------------------ */
/* 2. Attaching and replacing a file                                   */
/* ------------------------------------------------------------------ */

const createReq = (body: Record<string, unknown>) =>
  new Request("https://saiflow.test/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Habits check", price: 1, shopId: "shop_1", certified: true, ...body }),
  });

describe("a newly attached file is scanned without waiting for Cron", () => {
  useRealClock();

  test("creating a product with a file schedules that file's scan", async () => {
    const res = await CREATE(createReq({ fileUrl: fileUrl(KEY) }));
    assert.equal(res.status, 201, await res.text());
    assert.deepEqual(state.reconciled, ["prod_new"]);
    assert.equal(state.afterTasks.length, 1, "one scan scheduled");
    state.asset = asset();
    await drainAfter();
    const keysTouched = new Set((state.assetResets as { where: { key: string } }[]).map((c) => c.where.key));
    assert.deepEqual([...keysTouched], [KEY], "only the attached key is scanned");
  });

  test("creating a product without a file schedules nothing", async () => {
    const res = await CREATE(createReq({}));
    assert.equal(res.status, 201, await res.text());
    assert.equal(state.afterTasks.length, 0);
  });

  test("the scheduling call sits after reconciliation, on the attached key", () => {
    const code = strip(read("app/api/products/route.ts"));
    const reconcile = code.indexOf("await reconcileProductScanState(product.id, fileKey)");
    const schedule = code.indexOf("scheduleScan(fileKey);");
    assert.ok(reconcile !== -1 && schedule !== -1 && reconcile < schedule);
  });
});

const replaceReq = (body: Record<string, unknown>) =>
  new Request("https://saiflow.test/api/products/prod_1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "prod_1" }) };

describe("a replacement file is scanned without waiting for Cron", () => {
  useRealClock();
  beforeEach(() => {
    state.existing = {
      id: "prod_1",
      name: "Habits check",
      description: null,
      price: 1,
      category: null,
      shopId: "shop_1",
      fileUrl: fileUrl(KEY),
      fileKey: KEY,
      thumbnailUrl: null,
      fileScanStatus: "SAFE",
      fileScanKey: KEY,
      shop: { id: "shop_1", shopUsers: [{ userId: "user_owner" }] },
    };
  });

  test("replacing the file schedules a scan of the NEW key only", async () => {
    const res = await REPLACE(replaceReq({ fileUrl: fileUrl(NEW_KEY) }), ctx);
    assert.equal(res.status, 200, await res.text());
    assert.deepEqual(state.reconciled, ["prod_1"]);
    assert.equal(state.afterTasks.length, 1);
    state.asset = asset({ key: NEW_KEY });
    await drainAfter();
    const keysTouched = new Set((state.assetResets as { where: { key: string } }[]).map((c) => c.where.key));
    assert.deepEqual([...keysTouched], [NEW_KEY]);
  });

  test("saving without changing the file schedules nothing", async () => {
    const res = await REPLACE(replaceReq({ name: "Habits check (renamed)", fileUrl: fileUrl(KEY) }), ctx);
    assert.equal(res.status, 200, await res.text());
    assert.equal(state.afterTasks.length, 0);
    assert.deepEqual(state.reconciled, []);
  });

  test("removing the file schedules nothing", async () => {
    const res = await REPLACE(replaceReq({ fileUrl: "" }), ctx);
    assert.equal(res.status, 200, await res.text());
    assert.equal(state.afterTasks.length, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The seller-facing state                                          */
/* ------------------------------------------------------------------ */

describe("the seller sees uploaded, scanning, passed or failed — never scanning forever", () => {
  const p = (over: Record<string, unknown> = {}) => ({
    fileKey: KEY, fileScanStatus: "PENDING_SCAN", fileScanKey: null, shopId: "shop_1", updatedAt: minutes(1), ...over,
  }) as Parameters<typeof sellerFileState>[0];

  test("no file: no state", () => {
    assert.equal(sellerFileState(p({ fileKey: null }), null, NOW), null);
  });

  test("passed only under the gate's own conditions", () => {
    assert.deepEqual(sellerFileState(p({ fileScanStatus: "SAFE", fileScanKey: KEY }), asset({ scanStatus: "SAFE" }) as never, NOW), { state: "passed", failure: null, canRetry: false });
    assert.notEqual(sellerFileState(p({ fileScanStatus: "SAFE", fileScanKey: "other" }), asset() as never, NOW)?.state, "passed");
  });

  test("UNSAFE is failed, without a retry, whatever the attempt count", () => {
    for (const attempts of [1, 3]) {
      const s = sellerFileState(p({ fileScanStatus: "UNSAFE", fileScanKey: KEY }), asset({ scanStatus: "UNSAFE", scanReason: "malware", scanAttempts: attempts }) as never, NOW);
      assert.deepEqual(s, { state: "failed", failure: "unsafe_content", canRetry: false });
    }
    const s = sellerFileState(p(), asset({ scanStatus: "UNSAFE", scanReason: "pdf_javascript" }) as never, NOW);
    assert.deepEqual(s, { state: "failed", failure: "unsafe_content", canRetry: false });
  });

  test("just attached: uploaded, then scanning once an attempt or a claim exists", () => {
    assert.equal(sellerFileState(p(), asset() as never, NOW)?.state, "uploaded");
    assert.equal(sellerFileState(p(), asset({ scanClaimedAt: minutes(1), scanAttempts: 1, scanAt: minutes(1) }) as never, NOW)?.state, "scanning");
    assert.equal(sellerFileState(p(), asset({ scanAttempts: 1, scanAt: minutes(2) }) as never, NOW)?.state, "scanning");
  });

  test("a retryable error inside the window is still scanning (the sweeper will retry)", () => {
    const s = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 1, scanAt: minutes(3), scanReason: "provider_timeout" }) as never, NOW);
    assert.equal(s?.state, "scanning");
  });

  test("exhausted attempts are failed with a retry, never scanning", () => {
    const s = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(1), scanReason: "provider_timeout" }) as never, NOW);
    assert.deepEqual(s, { state: "failed", failure: "check_unavailable", canRetry: true });
    const pending = sellerFileState(p(), asset({ scanStatus: "PENDING_SCAN", scanAttempts: 3, scanAt: minutes(12) }) as never, NOW);
    assert.deepEqual(pending, { state: "failed", failure: "attempts_exhausted", canRetry: true });
  });

  test("H1: a live claim is scanning and not retryable, even with the budget spent", () => {
    const live = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(1), scanReason: "provider_timeout", ...claimedBy(1) }) as never, NOW);
    assert.deepEqual(live, { state: "scanning", failure: null, canRetry: false });
  });

  test("H1: a live claim is scanning and not retryable, even after a terminal reason", () => {
    const live = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 1, scanAt: minutes(1), scanReason: "provider_bad_response_http_401_terminal", ...claimedBy(2) }) as never, NOW);
    assert.deepEqual(live, { state: "scanning", failure: null, canRetry: false });
  });

  test("H1: a stale claim (dead worker) does not block the failed state", () => {
    const stale = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(11), scanReason: "provider_timeout", ...claimedBy(11) }) as never, NOW);
    assert.deepEqual(stale, { state: "failed", failure: "check_unavailable", canRetry: true });
  });

  test("L-a: a token with no timestamp is held, so it is scanning and not retryable", () => {
    // Postgres releases a row only when the token is null or the timestamp is
    // older than the cutoff; a null timestamp is neither. The seller must not
    // be offered a retry the reset would refuse.
    const s = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(1), scanReason: "provider_timeout", scanClaimToken: "orphan", scanClaimedAt: null }) as never, NOW);
    assert.deepEqual(s, { state: "scanning", failure: null, canRetry: false });
    const pending = sellerFileState(p(), asset({ scanClaimToken: "orphan", scanClaimedAt: null }) as never, NOW);
    assert.deepEqual(pending, { state: "scanning", failure: null, canRetry: false });
  });

  test("L-a: no token is free whatever the timestamp says", () => {
    const s = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(1), scanReason: "provider_timeout", scanClaimToken: null, scanClaimedAt: minutes(1) }) as never, NOW);
    assert.equal(s?.canRetry, true);
  });

  test("a terminal provider failure is failed at once, without spending the budget", () => {
    const s = sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 1, scanAt: minutes(1), scanReason: "provider_bad_response_http_401_terminal" }) as never, NOW);
    assert.deepEqual(s, { state: "failed", failure: "check_unavailable", canRetry: true });
  });

  test("past the window with no progress is failed: timed out, or never started", () => {
    const stale = new Date(NOW.getTime() - SCAN_WINDOW_MS - 1000);
    assert.deepEqual(sellerFileState(p(), asset({ scanStatus: "SCAN_ERROR", scanAttempts: 1, scanAt: stale, scanReason: "provider_timeout" }) as never, NOW), { state: "failed", failure: "timed_out", canRetry: true });
    assert.deepEqual(sellerFileState(p(), asset({ scanAttempts: 1, scanAt: stale }) as never, NOW), { state: "failed", failure: "timed_out", canRetry: true });
    assert.deepEqual(sellerFileState(p({ updatedAt: stale }), asset({ createdAt: stale }) as never, NOW), { state: "failed", failure: "not_started", canRetry: true });
    assert.equal(sellerFileState(p({ updatedAt: minutes(1) }), asset({ createdAt: stale }) as never, NOW)?.state, "uploaded");
  });

  test("no provenance row (legacy file) is failed without a retry", () => {
    assert.deepEqual(sellerFileState(p(), null, NOW), { state: "failed", failure: "no_record", canRetry: false });
    assert.equal(sellerFileState(p(), asset({ shopId: "shop_2" }) as never, NOW)?.failure, "no_record");
    assert.equal(sellerFileState(p(), asset({ route: "PRODUCT_THUMBNAIL" }) as never, NOW)?.failure, "no_record");
  });

  test("failure categories are coarse and never echo a provider payload", () => {
    assert.equal(failureCategory("malware"), "unsafe_content");
    assert.equal(failureCategory("pdf_javascript"), "unsafe_content");
    assert.equal(failureCategory("archive_encrypted"), "password_protected");
    assert.equal(failureCategory("archive_malformed"), "archive_problem");
    assert.equal(failureCategory("format_not_verified"), "unsupported_format");
    assert.equal(failureCategory("provider_bad_response_http_402_terminal"), "check_unavailable");
    assert.equal(failureCategory("storage_fetch_failed"), "check_unavailable");
    assert.equal(failureCategory("something_new"), "unknown");
    assert.equal(failureCategory(null), "unknown");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The retry route                                                  */
/* ------------------------------------------------------------------ */

const rescan = (id = "prod_1") =>
  RESCAN(new Request(`https://saiflow.test/api/products/${id}/rescan`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
const failedAsset = () => asset({ scanStatus: "SCAN_ERROR", scanAttempts: 3, scanAt: minutes(1), scanReason: "provider_timeout" });

describe("manual retry: who may, what it resets, what it schedules", () => {
  useRealClock();

  test("the owner can retry a failed file, and exactly that file is scheduled", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY });
    state.asset = failedAsset();
    const res = await rescan();
    const body = await res.json();
    assert.equal(res.status, 202, JSON.stringify(body));
    assert.deepEqual(body, { ok: true, state: "scanning" });
    const reset = state.assetResets[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    assert.equal(reset.where.key, KEY);
    assert.deepEqual(reset.where.scanStatus, { in: ["PENDING_SCAN", "SCAN_ERROR"] }, "never resets a settled verdict");
    assert.deepEqual(Object.keys(reset.data).sort(), ["scanAt", "scanAttempts", "scanClaimToken", "scanClaimedAt", "scanReason"]);
    assert.equal(reset.data.scanAttempts, 0);
    const productReset = state.productResets[0] as { where: Record<string, unknown> };
    assert.deepEqual(productReset.where, { id: "prod_1", fileKey: KEY, fileScanStatus: "SCAN_ERROR" });
    assert.equal(state.afterTasks.length, 1, "one scan scheduled");
  });

  test("an unrelated signed-in user is refused and nothing is touched", async () => {
    state.session = { user: { email: STRANGER } };
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY });
    state.asset = failedAsset();
    const res = await rescan();
    assert.equal(res.status, 403);
    assert.equal(state.assetResets.length, 0);
    assert.equal(state.afterTasks.length, 0);
  });

  test("anonymous is refused", async () => {
    state.session = null;
    state.product = product();
    assert.equal((await rescan()).status, 401);
  });

  test("an admin who is not a member can retry", async () => {
    state.session = { user: { email: ADMIN } };
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_admin" });
    state.asset = failedAsset();
    const res = await rescan("prod_admin");
    assert.equal(res.status, 202, await res.text());
    assert.equal(state.afterTasks.length, 1);
  });

  test("a SAFE file is not re-scanned", async () => {
    state.product = product({ fileScanStatus: "SAFE", fileScanKey: KEY, id: "prod_safe" });
    state.asset = asset({ scanStatus: "SAFE" });
    const res = await rescan("prod_safe");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, state: "passed" });
    assert.equal(state.assetResets.length, 0);
    assert.equal(state.afterTasks.length, 0);
  });

  test("an UNSAFE file can never be retried", async () => {
    state.product = product({ fileScanStatus: "UNSAFE", fileScanKey: KEY, id: "prod_unsafe" });
    state.asset = asset({ scanStatus: "UNSAFE", scanReason: "malware", scanAttempts: 1 });
    const res = await rescan("prod_unsafe");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "unsafe" });
    assert.equal(state.assetResets.length, 0);
  });

  test("a file still being checked is left alone", async () => {
    state.product = product({ id: "prod_busy" });
    state.asset = asset({ ...claimedBy(1), scanAttempts: 1, scanAt: minutes(1) });
    const res = await rescan("prod_busy");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "not_failed" });
  });

  test("a legacy file with no provenance row cannot be retried", async () => {
    state.product = product({ id: "prod_legacy" });
    state.asset = null;
    const res = await rescan("prod_legacy");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "no_scan_record" });
  });

  test("H1: retry is refused while a worker holds a live claim, and nothing is reset", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_live" });
    state.asset = { ...failedAsset(), ...claimedBy(1) };
    const res = await rescan("prod_live");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "not_failed" });
    assert.equal(state.assetResets.length, 0, "no update was even attempted");
    assert.equal(state.afterTasks.length, 0, "no second scan scheduled");
  });

  test("H1: the reset itself refuses a claim taken after the decision (the race)", async () => {
    // The decision sees a free row; by the time the reset runs a worker has
    // claimed it. The conditional update matches nothing, so the lease is
    // kept, the verdict in flight stays valid, and the route answers 409.
    const { resetScanForRetry } = await import("../lib/scan/rescan.ts");
    const now = new Date();
    state.asset = { ...failedAsset(), ...claimedBy(1) };
    assert.equal(await resetScanForRetry(KEY, "prod_race", now), false);
    const attempted = state.assetResets[0] as { where: Record<string, unknown> };
    assert.deepEqual(attempted.where.AND, [{ OR: [{ scanClaimToken: null }, { scanClaimedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }] }], "the guard is in the statement");
    assert.equal(state.productResets.length, 0, "the product copy is untouched when the asset is not reset");
  });

  test("L-a: retry is refused for a token with no timestamp, and the claim is kept", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_orphan" });
    state.asset = { ...failedAsset(), scanClaimToken: "orphan", scanClaimedAt: null };
    const res = await rescan("prod_orphan");
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "not_failed" });
    assert.equal(state.assetResets.length, 0, "no update attempted");
    assert.equal(state.afterTasks.length, 0);
  });

  test("L-a: the reset statement itself refuses a token with no timestamp", async () => {
    const { resetScanForRetry } = await import("../lib/scan/rescan.ts");
    state.asset = { ...failedAsset(), scanClaimToken: "orphan", scanClaimedAt: null };
    assert.equal(await resetScanForRetry(KEY, "prod_orphan_race", new Date()), false);
    assert.equal(state.assetResets.length, 1, "the guarded update ran and matched nothing");
    assert.equal(state.productResets.length, 0);
  });

  test("H1: a stale claim permits the retry", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_stale" });
    state.asset = { ...failedAsset(), scanAt: minutes(11), ...claimedBy(11) };
    const res = await rescan("prod_stale");
    assert.equal(res.status, 202, await res.text());
    assert.equal(state.afterTasks.length, 1);
  });

  test("H1: a free claim permits the retry", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_free" });
    state.asset = failedAsset();
    const res = await rescan("prod_free");
    assert.equal(res.status, 202, await res.text());
  });

  test("H1: a live claim on a SAFE or UNSAFE row changes nothing either", async () => {
    state.product = product({ fileScanStatus: "UNSAFE", fileScanKey: KEY, id: "prod_unsafe_live" });
    state.asset = asset({ scanStatus: "UNSAFE", scanReason: "malware", ...claimedBy(1) });
    assert.equal((await rescan("prod_unsafe_live")).status, 409);
    assert.equal(state.assetResets.length, 0);
    state.product = product({ fileScanStatus: "SAFE", fileScanKey: KEY, id: "prod_safe_live" });
    state.asset = asset({ scanStatus: "SAFE", ...claimedBy(1) });
    assert.equal((await rescan("prod_safe_live")).status, 200);
    assert.equal(state.assetResets.length, 0);
  });

  test("retries are rate-limited per product", async () => {
    state.product = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY, id: "prod_limited" });
    for (let i = 0; i < 3; i++) {
      state.asset = failedAsset();
      assert.equal((await rescan("prod_limited")).status, 202, `attempt ${i + 1}`);
    }
    state.asset = failedAsset();
    const res = await rescan("prod_limited");
    assert.equal(res.status, 429);
    assert.equal(state.afterTasks.length, 3);
  });

  test("the decision helper agrees with the badge", () => {
    const prod = product({ fileScanStatus: "SCAN_ERROR", fileScanKey: KEY }) as never;
    assert.deepEqual(rescanDecision(prod, failedAsset() as never, NOW), { ok: true });
    assert.deepEqual(rescanDecision(prod, asset({ scanStatus: "UNSAFE" }) as never, NOW), { ok: false, refusal: "unsafe" });
    assert.deepEqual(rescanDecision(prod, null, NOW), { ok: false, refusal: "no_scan_record" });
    assert.deepEqual(rescanDecision(product({ fileKey: null }) as never, null, NOW), { ok: false, refusal: "no_file" });
    assert.deepEqual(rescanDecision(product() as never, asset() as never, NOW), { ok: false, refusal: "not_failed" });
  });
});

/* ------------------------------------------------------------------ */
/* 5. Nothing else moved                                               */
/* ------------------------------------------------------------------ */

describe("gates, verdict finality and the worker are unchanged", () => {
  test("SAFE and UNSAFE are still never reclaimed by the worker", () => {
    const run = strip(read("lib/scan/run.ts"));
    assert.ok(/scanStatus: \{ in: \["PENDING_SCAN", "SCAN_ERROR"\] \}/.test(run));
    assert.ok(/export const MAX_SCAN_ATTEMPTS = 3;/.test(run));
  });

  test("the reset never touches a settled row, never a live lease, and never invents a verdict", () => {
    const code = strip(read("lib/scan/rescan.ts"));
    assert.ok(/scanStatus: \{ in: \["PENDING_SCAN", "SCAN_ERROR"\] \}/.test(code));
    assert.ok(/OR: \[\{ scanClaimToken: null \}, \{ scanClaimedAt: \{ lt: leaseCutoff \} \}\]/.test(code), "lease guard in the same statement");
    assert.ok(/SCAN_LEASE_MS/.test(code), "the worker's own lease length");
    assert.ok(!/scanStatus: "SAFE"|fileScanStatus: "SAFE"/.test(code));
    const seller = strip(read("lib/seller-file-state.ts"));
    const claimCheck = seller.indexOf("if (hasLiveClaim(usable, now)) return SCANNING;");
    const errorBranch = seller.indexOf('if (usable.scanStatus === "SCAN_ERROR")');
    assert.ok(claimCheck !== -1 && errorBranch !== -1 && claimCheck < errorBranch, "the live-claim check precedes every retryable branch");
  });

  test("checkout, download and the storefront gate are untouched", () => {
    for (const f of ["app/api/checkout/route.ts", "app/api/download/[productId]/route.ts"]) {
      assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(strip(read(f))), f);
    }
    for (const f of ["app/page.tsx", "app/browse/page.tsx", "app/shop/[slug]/page.tsx", "app/shop/[slug]/product/[productSlug]/page.tsx", "app/sitemap.ts"]) {
      assert.ok(strip(read(f)).includes("...SAFE_DELIVERABLE_WHERE"), f);
    }
  });

  test("the seller payload names states, not columns", () => {
    const api = strip(read("app/api/shops/[slug]/route.ts"));
    assert.ok(/fileState: sellerFileState\(/.test(api));
    const component = read("components/FileScanState.tsx");
    for (const leak of ["fileKey", "fileScanKey", "sha256", "scanReason", "cloudmersive"]) {
      assert.ok(!component.includes(leak), `component reads ${leak}`);
    }
  });
});
