/**
 * Where notifications are fired from, and that nothing else changes.
 *
 * lib/notify is replaced by a recorder; the routes, the scan worker and the
 * reconciliation are the real modules. Next's `after` is replaced by a queue,
 * so "after the response" is observable, and by a throwing variant, so the
 * inline fallback is exercised too. Prisma is a small in-memory stand-in.
 *
 * BEHAVIOURAL for the shop route (creation, its rate limit), the moderation
 * route, the scan worker's SAFE path, the reconciliation path and the
 * after-response helper. STRUCTURAL (source text) for the report email's link
 * and the Geidea webhook call site, whose own suite covers behaviour.
 */

import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ScanFindings, ScanProvider } from "../lib/scan/provider";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const calls = {
  storeCreated: [] as Record<string, unknown>[],
  moderated: [] as Record<string, unknown>[],
  readyForReview: [] as string[][],
};
const logs: string[] = [];
const state = {
  session: null as unknown,
  afterThrows: false,
  afterTasks: [] as Array<() => Promise<void>>,
  notifyThrows: false,
  product: null as Record<string, unknown> | null,
  shopBySlug: null as Record<string, unknown> | null,
  created: [] as Record<string, unknown>[],
  userLookups: 0,
  updates: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  asset: null as Record<string, unknown> | null,
  written: null as Record<string, unknown> | null,
  /** Product rows the worker's verdict transaction finds attached to the file. */
  affected: [] as Array<{ id: string; moderationStatus: string }>,
  /** What a product-bound conditional update matches (1: still PENDING_SCAN; 0: already settled). */
  productUpdateCount: 1,
  moderation: "PENDING",
};

/** A fresh account for every test: the creation limiter is per account and in memory. */
let account = "";
let testNumber = 0;

const PDF_BYTES = (() => {
  const b = new Uint8Array(16);
  b.set([0x25, 0x50, 0x44, 0x46]);
  return b;
})();
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
const provider = (findings: Partial<ScanFindings> | null): ScanProvider => ({
  id: "fake",
  isConfigured: () => true,
  scan: async () => (findings ? { ok: true, findings: { ...CLEAN_FINDINGS, ...findings } } : { ok: false, failure: "network" }),
});

const tx = {
  product: {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      state.updates.push(data);
      return { id: "prod_1", moderationStatus: data.moderationStatus };
    },
    findMany: async () => state.affected,
    findUnique: async () => ({ moderationStatus: state.moderation }),
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      state.updates.push(data);
      return { count: state.productUpdateCount };
    },
  },
  moderationEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      state.events.push(data);
      return {};
    },
    createMany: async () => ({ count: 1 }),
  },
  fileAsset: {
    updateMany: async ({ data }: { data: Record<string, unknown> }) => {
      state.written = data;
      // The verdict lands on the row, as it would in Postgres.
      if (state.asset) Object.assign(state.asset, data);
      return { count: 1 };
    },
  },
};

let shopsPOST: (req: Request) => Promise<Response>;
let moderationPOST: (req: Request, ctx: { params: Promise<{ productId: string }> }) => Promise<Response>;
let scanFileAsset: (key: string, opts?: { provider?: ScanProvider }) => Promise<{ key: string; outcome: string; reason?: string }>;
let reconcileProductScanState: (productId: string, fileKey: string) => Promise<{ reconciled: boolean; scanStatus: string | null; readyForReview: boolean }>;
let runAfterResponse: (task: () => Promise<unknown>) => Promise<"deferred" | "inline">;

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
  mock.module("next-auth", { namedExports: { getServerSession: async () => state.session } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/notify", {
    namedExports: {
      notifyAdminsStoreCreated: async (shop: Record<string, unknown>) => {
        calls.storeCreated.push(shop);
        if (state.notifyThrows) throw new Error("notifier exploded");
        return { ok: true, recipients: 1 };
      },
      notifyProductModerated: async (input: Record<string, unknown>) => {
        calls.moderated.push(input);
        if (state.notifyThrows) throw new Error("notifier exploded");
        return { ok: true, recipients: 1 };
      },
      notifyAdminsProductReadyForReview: async (ids: string[]) => {
        calls.readyForReview.push(ids);
        if (state.notifyThrows) throw new Error("notifier exploded");
        return [{ ok: true, recipients: 1 }];
      },
    },
  });
  const realPolicy = await import("../lib/scan/policy.ts");
  mock.module(pathToFileURL(resolve(ROOT, "lib/scan/policy.ts")).href, {
    namedExports: { ...realPolicy, structuralVerdict: () => ({ outcome: "ALLOW" }) },
  });
  mock.module("@/lib/storage/provider", {
    namedExports: {
      MAX_SCANNABLE_BYTES: 128 * 1024 * 1024,
      readPrivateObject: async () => ({ ok: true, bytes: PDF_BYTES }),
    },
  });
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: {
          findFirst: async () => {
            state.userLookups++;
            return { id: "user_1", email: account };
          },
        },
        shop: {
          findUnique: async () => state.shopBySlug,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const row = { id: "shop_1", name: data.name, slug: data.slug, description: data.description ?? null };
            state.created.push(row);
            return row;
          },
        },
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          findUnique: async () => state.product,
          findFirst: async () => ({ id: "prod_1" }),
        },
        fileAsset: {
          findUnique: async () => state.asset,
          updateMany: async () => ({ count: 1 }),
        },
        $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
      },
    },
  });
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  }
  shopsPOST = (await import("../app/api/shops/route.ts")).POST as typeof shopsPOST;
  moderationPOST = (await import("../app/api/admin/moderation/[productId]/route.ts")).POST as typeof moderationPOST;
  scanFileAsset = (await import("../lib/scan/run.ts")).scanFileAsset as typeof scanFileAsset;
  reconcileProductScanState = (await import("../lib/file-safety.ts")).reconcileProductScanState;
  runAfterResponse = (await import("../lib/after-response.ts")).runAfterResponse;
});

beforeEach(() => {
  testNumber++;
  account = `owner-${testNumber}@example.test`;
  calls.storeCreated.length = 0;
  calls.moderated.length = 0;
  calls.readyForReview.length = 0;
  logs.length = 0;
  state.session = { user: { email: account } };
  state.afterThrows = false;
  state.afterTasks = [];
  state.notifyThrows = false;
  state.product = { id: "prod_1", moderationStatus: "PENDING" };
  state.shopBySlug = null;
  state.created = [];
  state.userLookups = 0;
  state.updates = [];
  state.events = [];
  state.asset = {
    key: "key_1",
    shopId: "shop_1",
    route: "PRODUCT_FILE",
    name: "sample.pdf",
    scanStatus: "PENDING_SCAN",
    scanAttempts: 0,
    scanAt: null,
    scanReason: null,
    scanSha256: null,
    scanClaimToken: null,
    scanClaimedAt: null,
  };
  state.written = null;
  state.affected = [{ id: "prod_1", moderationStatus: "PENDING" }];
  state.productUpdateCount = 1;
  state.moderation = "PENDING";
  process.env.ADMIN_EMAILS = account;
});

const drain = async () => {
  const tasks = state.afterTasks.splice(0);
  for (const task of tasks) await task();
};

const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const createShop = (name: string) => shopsPOST(json("http://test/api/shops", { name }));

/* ------------------------------------------------------------------ */
/* 1. A creator opens a store                                          */
/* ------------------------------------------------------------------ */

describe("a creator opens a store", () => {
  test("the founder is told after the response, with the created row's name and slug", async () => {
    const res = await createShop("متجر داد");
    assert.equal(res.status, 201);
    assert.equal(calls.storeCreated.length, 0, "nothing is sent before the response");
    assert.equal(state.afterTasks.length, 1, "one task waits for the response");
    await drain();
    assert.deepEqual(calls.storeCreated, [{ id: "shop_1", name: "متجر داد", slug: state.created[0].slug }]);
  });

  test("a notifier failure changes nothing: the shop exists and the reply is still 201", async () => {
    state.notifyThrows = true;
    const res = await createShop("متجر داد");
    assert.equal(res.status, 201);
    await drain();
    assert.equal(calls.storeCreated.length, 1);
    assert.equal(state.created.length, 1);
    assert.ok(logs.some((l) => l.includes("[after-response] task failed")));
  });

  test("outside a request scope the task runs inline, and the reply is still 201", async () => {
    state.afterThrows = true;
    state.notifyThrows = true;
    const res = await createShop("متجر داد");
    assert.equal(res.status, 201);
    assert.equal(calls.storeCreated.length, 1, "already called, no queue");
    assert.equal(state.afterTasks.length, 0);
  });

  test("a refused request sends nothing", async () => {
    const res = await createShop("x");
    assert.equal(res.status, 400);
    await drain();
    assert.equal(calls.storeCreated.length, 0);
    state.session = null;
    const anon = await createShop("متجر داد");
    assert.equal(anon.status, 401);
    assert.equal(calls.storeCreated.length, 0);
  });

  test("one account opens at most 3 stores an hour; the 4th is refused before any lookup, write or email", async () => {
    for (let i = 0; i < 3; i++) assert.equal((await createShop(`متجر ${i}`)).status, 201);
    const lookups = state.userLookups;
    const refused = await createShop("متجر رابع");
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "Too many requests" });
    assert.ok(Number(refused.headers.get("retry-after")) >= 1, "a Retry-After header, in seconds");
    assert.equal(state.userLookups, lookups, "refused before the account lookup");
    assert.equal(state.created.length, 3, "nothing written");
    await drain();
    assert.equal(calls.storeCreated.length, 3, "nothing sent for the refused one");
    // Another account is not affected by this one's window.
    state.session = { user: { email: `other-${testNumber}@example.test` } };
    assert.equal((await createShop("متجر آخر")).status, 201);
  });

  test("the session check still comes first: anonymous requests are 401, never 429", async () => {
    state.session = null;
    for (let i = 0; i < 6; i++) assert.equal((await createShop("متجر داد")).status, 401);
    assert.equal(state.userLookups, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. A moderation decision                                            */
/* ------------------------------------------------------------------ */

describe("a moderation decision", () => {
  const decide = (body: unknown) =>
    moderationPOST(json("http://test/api/admin/moderation/prod_1", body), { params: Promise.resolve({ productId: "prod_1" }) });

  test("rejected: the seller is told after the response, with the trimmed stored reason", async () => {
    const res = await decide({ action: "REJECTED", reason: "  نص غير مناسب  " });
    assert.equal(res.status, 200);
    assert.equal(calls.moderated.length, 0, "nothing is sent before the response");
    await drain();
    assert.deepEqual(calls.moderated, [{ productId: "prod_1", action: "REJECTED", reason: "نص غير مناسب" }]);
    assert.equal(state.updates[0].moderationStatus, "REJECTED", "the decision was committed first");
    assert.equal(state.events[0].reason, "نص غير مناسب", "the same reason is in the audit row");
  });

  test("approved: the seller is told, with no reason", async () => {
    const res = await decide({ action: "APPROVED" });
    assert.equal(res.status, 200);
    await drain();
    assert.deepEqual(calls.moderated, [{ productId: "prod_1", action: "APPROVED", reason: null }]);
  });

  test("a refused decision sends nothing and writes nothing", async () => {
    assert.equal((await decide({ action: "REJECTED" })).status, 400, "a rejection needs a reason");
    assert.equal((await decide({ action: "DELETE" })).status, 400);
    process.env.ADMIN_EMAILS = "someone-else@example.test";
    assert.equal((await decide({ action: "APPROVED" })).status, 403);
    await drain();
    assert.equal(calls.moderated.length, 0);
    assert.equal(state.updates.length, 0);
  });

  test("a notifier failure changes nothing: the decision stands and the reply is still 200", async () => {
    state.notifyThrows = true;
    const res = await decide({ action: "APPROVED" });
    assert.equal(res.status, 200);
    await drain();
    assert.equal(calls.moderated.length, 1);
    assert.equal(state.updates[0].moderationStatus, "APPROVED");
  });
});

/* ------------------------------------------------------------------ */
/* 3. A file passes its check — worker path                            */
/* ------------------------------------------------------------------ */

describe("a file passes its check (worker path)", () => {
  test("the founder is told about the products the verdict transaction bound, once it is written", async () => {
    const report = await scanFileAsset("key_1", { provider: provider({}) });
    assert.deepEqual(report, { key: "key_1", outcome: "SAFE" });
    assert.deepEqual(calls.readyForReview, [["prod_1"]]);
    assert.equal(state.written?.scanStatus, "SAFE", "the verdict was committed before the notice");
  });

  test("a notifier failure cannot touch the verdict", async () => {
    state.notifyThrows = true;
    const report = await scanFileAsset("key_1", { provider: provider({}) });
    assert.deepEqual(report, { key: "key_1", outcome: "SAFE" });
    assert.equal(state.written?.scanStatus, "SAFE");
  });

  test("nothing is sent for anything but SAFE", async () => {
    const error = await scanFileAsset("key_1", { provider: provider(null) });
    assert.equal(error.outcome, "SCAN_ERROR");
    state.asset!.scanStatus = "PENDING_SCAN";
    const unsafe = await scanFileAsset("key_1", { provider: provider({ containsExecutable: true }) });
    assert.equal(unsafe.outcome, "UNSAFE");
    const settled = await scanFileAsset("key_1", { provider: provider({}) });
    assert.equal(settled.outcome, "SKIPPED_SETTLED", "a settled file is never rescanned");
    assert.equal(calls.readyForReview.length, 0);
  });

  test("a product already decided is not announced, and a file nobody has attached names nobody", async () => {
    state.affected = [{ id: "prod_1", moderationStatus: "APPROVED" }, { id: "prod_2", moderationStatus: "REJECTED" }];
    assert.equal((await scanFileAsset("key_1", { provider: provider({}) })).outcome, "SAFE");
    assert.equal(calls.readyForReview.length, 0);
    state.asset!.scanStatus = "PENDING_SCAN";
    state.affected = [];
    assert.equal((await scanFileAsset("key_1", { provider: provider({}) })).outcome, "SAFE");
    assert.equal(calls.readyForReview.length, 0);
  });

  test("only the waiting products among several attached are named", async () => {
    state.affected = [
      { id: "prod_1", moderationStatus: "PENDING" },
      { id: "prod_2", moderationStatus: "APPROVED" },
      { id: "prod_3", moderationStatus: "PENDING" },
    ];
    await scanFileAsset("key_1", { provider: provider({}) });
    assert.deepEqual(calls.readyForReview, [["prod_1", "prod_3"]]);
  });
});

/* ------------------------------------------------------------------ */
/* 4. A file passes its check — attach-time reconciliation             */
/* ------------------------------------------------------------------ */

describe("a product attaches to a file with a verdict (reconciliation path)", () => {
  test("an already-SAFE file attached to a PENDING product: one notification, after the commit and the response", async () => {
    state.asset!.scanStatus = "SAFE";
    const result = await reconcileProductScanState("prod_1", "key_1");
    assert.deepEqual(result, { reconciled: true, scanStatus: "SAFE", readyForReview: true });
    assert.equal(state.updates[0].fileScanStatus, "SAFE", "the verdict was copied first");
    assert.equal(state.events[0].action, "SCANNED", "and audited");
    assert.equal(calls.readyForReview.length, 0, "nothing before the response");
    await drain();
    assert.deepEqual(calls.readyForReview, [["prod_1"]]);
  });

  test("the attach/scan race: the worker settles first with no product attached, the attach reconciles — one notification", async () => {
    state.affected = [];
    assert.equal((await scanFileAsset("key_1", { provider: provider({}) })).outcome, "SAFE");
    assert.equal(calls.readyForReview.length, 0, "the worker named nobody");
    assert.equal(state.asset!.scanStatus, "SAFE");
    const result = await reconcileProductScanState("prod_1", "key_1");
    assert.equal(result.readyForReview, true);
    await drain();
    assert.deepEqual(calls.readyForReview, [["prod_1"]]);
  });

  test("an APPROVED or REJECTED product is reconciled but never announced", async () => {
    state.asset!.scanStatus = "SAFE";
    for (const moderation of ["APPROVED", "REJECTED"]) {
      state.moderation = moderation;
      const result = await reconcileProductScanState("prod_1", "key_1");
      assert.deepEqual(result, { reconciled: true, scanStatus: "SAFE", readyForReview: false });
    }
    await drain();
    assert.equal(calls.readyForReview.length, 0);
  });

  test("UNSAFE and SCAN_ERROR verdicts are copied, audited and never announced", async () => {
    for (const status of ["UNSAFE", "SCAN_ERROR"]) {
      state.asset!.scanStatus = status;
      const result = await reconcileProductScanState("prod_1", "key_1");
      assert.deepEqual(result, { reconciled: true, scanStatus: status, readyForReview: false });
    }
    assert.equal(state.events.length, 2);
    await drain();
    assert.equal(calls.readyForReview.length, 0);
  });

  test("an unscanned file is a no-op", async () => {
    const result = await reconcileProductScanState("prod_1", "key_1");
    assert.deepEqual(result, { reconciled: false, scanStatus: null, readyForReview: false });
    assert.equal(state.updates.length, 0);
    await drain();
    assert.equal(calls.readyForReview.length, 0);
  });

  test("no duplicate: the worker bound the product, so a later reconciliation matches nothing and stays quiet", async () => {
    assert.equal((await scanFileAsset("key_1", { provider: provider({}) })).outcome, "SAFE");
    assert.deepEqual(calls.readyForReview, [["prod_1"]]);
    // The row is no longer PENDING_SCAN, so the key-bound conditional update matches nothing.
    state.productUpdateCount = 0;
    const result = await reconcileProductScanState("prod_1", "key_1");
    assert.deepEqual(result, { reconciled: false, scanStatus: null, readyForReview: false });
    await drain();
    assert.equal(calls.readyForReview.length, 1, "still exactly one");
  });

  test("no duplicate the other way round: reconciliation bound the product, so the worker skips the settled file", async () => {
    state.asset!.scanStatus = "SAFE";
    assert.equal((await reconcileProductScanState("prod_1", "key_1")).readyForReview, true);
    await drain();
    assert.equal((await scanFileAsset("key_1", { provider: provider({}) })).outcome, "SKIPPED_SETTLED");
    assert.equal(calls.readyForReview.length, 1, "still exactly one");
  });

  test("a notifier failure cannot fail the reconciliation", async () => {
    state.asset!.scanStatus = "SAFE";
    state.notifyThrows = true;
    state.afterThrows = true;
    const result = await reconcileProductScanState("prod_1", "key_1");
    assert.equal(result.readyForReview, true);
    assert.equal(calls.readyForReview.length, 1);
    assert.ok(logs.some((l) => l.includes("[after-response] task failed")));
  });
});

/* ------------------------------------------------------------------ */
/* 5. After the response                                               */
/* ------------------------------------------------------------------ */

describe("runAfterResponse", () => {
  test("defers to the platform when it can, and the task does not run early", async () => {
    let ran = false;
    const mode = await runAfterResponse(async () => {
      ran = true;
    });
    assert.equal(mode, "deferred");
    assert.equal(ran, false);
    await drain();
    assert.equal(ran, true);
  });

  test("runs inline outside a request scope, and swallows a failure either way", async () => {
    state.afterThrows = true;
    let ran = false;
    const mode = await runAfterResponse(async () => {
      ran = true;
      throw new Error("boom");
    });
    assert.equal(mode, "inline");
    assert.equal(ran, true);
    assert.ok(logs.some((l) => l.includes("[after-response] task failed") && l.includes("Error")));
    assert.ok(!logs.some((l) => l.includes("boom")), "the failure message is not echoed");
  });
});

/* ------------------------------------------------------------------ */
/* 6. Structural                                                       */
/* ------------------------------------------------------------------ */

describe("the remaining call sites (structural)", () => {
  test("the report email links straight to the product's review page, absolutely", () => {
    const src = read("app/api/products/[id]/report/route.ts");
    assert.match(src, /import \{ adminProductReviewUrl, moderationQueueUrl \} from "@\/lib\/notification-links";/);
    assert.match(src, /Review this product: \$\{adminProductReviewUrl\(product\.id\)\}/);
    assert.match(src, /Review queue: \$\{moderationQueueUrl\(\)\}/);
    assert.ok(!src.includes("Review queue: /dashboard/moderation"), "the relative path is gone");
  });

  test("the Geidea webhook notifies after the receipt and before the reply, with no buyer data", () => {
    const src = read("app/api/webhooks/geidea/route.ts");
    const receipt = src.indexOf("await sendReceipt(session, result.orderId, result.productName);");
    const notify = src.indexOf("notifySaleFulfilled({");
    const reply = src.indexOf('return reply(200, { received: true, result: "fulfilled" });');
    assert.ok(receipt > 0 && notify > receipt && reply > notify, "order: receipt, notify, reply");
    const block = src.slice(notify, reply);
    for (const forbidden of ["buyerEmail", "customerEmail", "merchantReferenceId", "providerOrderId", "payload", "signature"]) {
      assert.ok(!block.includes(forbidden), `${forbidden} handed to the notifier`);
    }
    assert.match(block, /environment: mode/);
    assert.match(src, /await runAfterResponse\(\(\) =>\s*notifySaleFulfilled\(/);
  });

  test("the scan worker notifies only after a SAFE settle, only for products its transaction bound, inside its own guard", () => {
    const src = read("lib/scan/run.ts");
    const settle = src.indexOf('const report = await settle("SAFE", null, digest);');
    const guard = src.indexOf('if (report.outcome === "SAFE" && readyForReview.length > 0) {');
    const call = src.indexOf("await notifyAdminsProductReadyForReview(readyForReview, key);");
    assert.ok(settle > 0 && guard > settle && call > guard);
    assert.equal(src.match(/notifyAdminsProductReadyForReview\(/g)?.length, 1, "one call site");
    assert.match(src.slice(guard, call + 80), /try \{\s*await notifyAdminsProductReadyForReview\(readyForReview, key\);\s*\} catch/);
    // The set is decided inside the verdict transaction, from the rows it found attached.
    const finalize = src.slice(src.indexOf("async function finalizeVerdict"), src.indexOf("export async function scanFileAsset"));
    assert.match(finalize, /affected\.filter\(\(product\) => product\.moderationStatus === "PENDING"\)\.map\(\(product\) => product\.id\)/);
    assert.match(finalize, /status === "SAFE"/);
  });

  test("the reconciliation announces only a SAFE copy onto a PENDING product, after its transaction", () => {
    const src = read("lib/file-safety.ts");
    const fn = src.slice(src.indexOf("export async function reconcileProductScanState"));
    const txEnd = fn.indexOf("return product.moderationStatus;");
    const decision = fn.indexOf('const readyForReview = asset.scanStatus === "SAFE" && moderationStatus === "PENDING";');
    const call = fn.indexOf("await runAfterResponse(() => notifyAdminsProductReadyForReview([productId], fileKey));");
    assert.ok(txEnd > 0 && decision > txEnd && call > decision, "decided and sent after the transaction");
    assert.ok(fn.includes("if (updated.count !== 1) return null;"), "a stale reconciliation names nobody");
  });

  test("a product written already SAFE is announced from the route, after the write and before reconcile", () => {
    for (const [file, row] of [
      ["app/api/products/route.ts", "product"],
      ["app/api/products/[id]/route.ts", "updatedProduct"],
    ] as const) {
      const src = read(file);
      const write = src.indexOf(row === "product" ? "const product = await prisma.$transaction(" : "const updatedProduct = await prisma.product.update(");
      const announce = src.indexOf(`await announceReadyAtAttach(${row});`);
      const reconcile = src.indexOf(`await reconcileProductScanState(${row}.id`);
      const schedule = src.indexOf("scheduleScan(");
      assert.ok(write > 0 && announce > write && reconcile > announce && schedule > reconcile, `${file}: write, announce, reconcile, schedule`);
      assert.match(src.slice(announce - 60, announce + 200), /try \{\s*await announceReadyAtAttach\(\w+\);\s*\} catch/, "wrapped");
    }
    const announce = read("lib/scan/announce.ts");
    assert.match(announce, /product\.fileScanStatus === "SAFE"/);
    assert.match(announce, /product\.fileScanKey === product\.fileKey/);
    assert.match(announce, /product\.moderationStatus === "PENDING"/);
    assert.match(announce, /notifyAdminsProductReadyForReview\(\[product\.id\], key\)/, "bound to the file it was written with");
  });

  test("the seller-facing hooks all run after their transaction and after the response", () => {
    for (const [file, marker] of [
      ["app/api/shops/route.ts", "await runAfterResponse(() =>\n      notifyAdminsStoreCreated("],
      ["app/api/admin/moderation/[productId]/route.ts", "await runAfterResponse(() =>\n      notifyProductModerated("],
    ] as const) {
      const src = read(file);
      assert.ok(src.includes(marker), `${file} lacks the hook`);
    }
    const moderation = read("app/api/admin/moderation/[productId]/route.ts");
    assert.ok(moderation.indexOf("await prisma.$transaction(") < moderation.indexOf("notifyProductModerated("));
  });

  test("creation limits sit right after the session check, keyed by account, never by address", () => {
    for (const file of ["app/api/shops/route.ts", "app/api/products/route.ts"]) {
      const src = read(file);
      const session = src.indexOf("const session = await getServerSession(authOptions);");
      const limit = src.indexOf("rateLimiters.create");
      const body = src.indexOf("await req.json()");
      assert.ok(session > 0 && limit > session && body > limit, `${file}: session, then limit, then body`);
      assert.match(src, /accountKey\(session\.user\.email\)/);
      assert.ok(!src.includes("getClientIp"), `${file}: the creation limit is not per IP`);
    }
    const limiter = read("lib/rate-limit.ts");
    assert.match(limiter, /createShop: \(account: string\) =>\s*rateLimit\(`create-shop:\$\{account\}`, \{ windowMs: 60 \* 60 \* 1000, maxRequests: 3 \}\)/);
    assert.match(limiter, /createProduct: \(account: string\) =>\s*rateLimit\(`create-product:\$\{account\}`, \{ windowMs: 60 \* 60 \* 1000, maxRequests: 20 \}\)/);
    assert.match(limiter, /createHash\("sha256"\)\.update\(email\.trim\(\)\.toLowerCase\(\)\)/);
  });
});
