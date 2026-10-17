/**
 * Approval needs a deliverable that passed its safety check
 * (app/api/admin/moderation/[productId], 17 Oct 2026, part 3 item 1).
 *
 * Seen live: products approved with no file, and one approved with a failed
 * scan. They were never sold (every public page, checkout and download carry
 * the safety gate), but "approved" should mean "fit to sell".
 *
 * What must hold:
 * - Approving a product whose file is missing, still being checked, failed,
 *   errored or replaced is refused with the reason, and nothing is written.
 * - The same condition is the approval write's own WHERE, so a file that
 *   changes after the check rolls the whole decision back.
 * - Rejecting needs no file. A safe file approves as before.
 * - The review buttons say why Approve is unavailable.
 */
import { test, describe, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type Product = { id: string; moderationStatus: string; fileKey: string | null; fileScanStatus: string; fileScanKey: string | null };
const state = {
  product: null as Product | null,
  /** What the approval write's WHERE matches, decided by the test (Postgres's job in production). */
  approveMatches: 1,
  updates: [] as Array<{ kind: string; where: Record<string, unknown>; data: Record<string, unknown> }>,
  events: [] as Record<string, unknown>[],
  notified: [] as unknown[],
};

let POST: (req: Request, ctx: { params: Promise<{ productId: string }> }) => Promise<Response>;

before(async () => {
  process.env.ADMIN_EMAILS = "founder@example.test";
  mock.module("next-auth", { namedExports: { getServerSession: async () => ({ user: { id: "admin_1", email: "founder@example.test" } }) } });
  mock.module(pathToFileURL(resolve(ROOT, "app/api/auth/authOptions.ts")).href, { namedExports: { authOptions: {} } });
  mock.module("@/lib/rate-limit", { namedExports: { rateLimiters: { api: () => ({ success: true }) }, getClientIp: () => "test" } });
  mock.module("@/lib/notify", {
    namedExports: {
      notifyProductModerated: async (x: unknown) => {
        state.notified.push(x);
        return { ok: true };
      },
      // Imported by lib/file-safety's scan path; never called here.
      notifyAdminsProductReadyForReview: async () => [],
    },
  });
  mock.module("@/lib/after-response", { namedExports: { runAfterResponse: async (task: () => Promise<unknown>) => { await task(); return "inline"; } } });
  const tx = {
    product: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push({ kind: "updateMany", where, data });
        return { count: state.approveMatches };
      },
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.updates.push({ kind: "update", where, data });
        return { id: state.product!.id, moderationStatus: data.moderationStatus };
      },
    },
    moderationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.events.push(data);
        return {};
      },
    },
  };
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        user: { findFirst: async () => ({ id: "admin_1" }) },
        product: {
          fields: { fileKey: { _toFieldRef: "Product.fileKey" } },
          findUnique: async () => (state.product ? { ...state.product } : null),
        },
        // Committed only if the callback returns: a throw discards the staged writes.
        $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => {
          const before = { updates: state.updates.length, events: state.events.length };
          try {
            return await fn(tx);
          } catch (error) {
            state.updates.length = before.updates;
            state.events.length = before.events;
            throw error;
          }
        },
      },
    },
  });
  console.error = () => undefined;
  POST = (await import("../app/api/admin/moderation/[productId]/route.ts")).POST as typeof POST;
});

const SAFE: Product = { id: "prod_1", moderationStatus: "PENDING", fileKey: "key_1", fileScanStatus: "SAFE", fileScanKey: "key_1" };

beforeEach(() => {
  state.product = { ...SAFE };
  state.approveMatches = 1;
  state.updates = [];
  state.events = [];
  state.notified = [];
});

const decide = (body: Record<string, unknown>) =>
  POST(new Request("https://saiflow.test/api/admin/moderation/prod_1", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ productId: "prod_1" }),
  });

describe("approving", () => {
  test("a product whose file passed its check is approved, through a write that re-checks it", async () => {
    const res = await decide({ action: "APPROVED" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: "prod_1", moderationStatus: "APPROVED" });
    assert.equal(state.updates[0].kind, "updateMany");
    const where = state.updates[0].where;
    assert.equal(where.id, "prod_1");
    assert.equal(where.fileScanStatus, "SAFE");
    assert.deepEqual(where.fileKey, { not: null });
    assert.ok(where.fileScanKey, "the key binding is part of the write's condition");
    assert.equal(state.events.length, 1);
  });

  test("no file, still checking, failed, errored or replaced: refused with the reason, nothing written or sent", async () => {
    const cases: Array<[Partial<Product>, string]> = [
      [{ fileKey: null, fileScanKey: null, fileScanStatus: "PENDING_SCAN" }, "missing_file_key"],
      [{ fileScanStatus: "PENDING_SCAN", fileScanKey: null }, "pending_scan"],
      [{ fileScanStatus: "UNSAFE" }, "unsafe"],
      [{ fileScanStatus: "SCAN_ERROR" }, "scan_error"],
      [{ fileScanKey: "an_older_key" }, "scan_key_mismatch"],
    ];
    for (const [over, reason] of cases) {
      state.product = { ...SAFE, ...over };
      const res = await decide({ action: "APPROVED" });
      assert.equal(res.status, 409, reason);
      assert.deepEqual(await res.json(), { error: "not_approvable", reason });
    }
    assert.equal(state.updates.length, 0);
    assert.equal(state.events.length, 0);
    assert.equal(state.notified.length, 0);
  });

  test("a file that changes after the check: the write matches nothing and the decision rolls back", async () => {
    state.approveMatches = 0;
    const res = await decide({ action: "APPROVED" });
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: "not_approvable", reason: "file_changed" });
    assert.equal(state.events.length, 0, "no audit row for a decision that did not happen");
    assert.equal(state.notified.length, 0);
  });
});

describe("rejecting", () => {
  test("needs no file: a product without one can still be rejected, with its reason", async () => {
    state.product = { ...SAFE, fileKey: null, fileScanKey: null };
    const res = await decide({ action: "REJECTED", reason: "No product file" });
    assert.equal(res.status, 200);
    assert.equal(state.updates[0].kind, "update");
    assert.equal(state.events[0].reason, "No product file");
  });
});

describe("the review buttons say why Approve is unavailable", () => {
  test("both buttons disable Approve and show the reason; both pages pass it", () => {
    for (const file of ["components/admin/DecisionButtons.tsx", "components/admin/ReviewButton.tsx"]) {
      const src = read(file);
      assert.ok(src.includes("disabled={busy || approveBlocked !== null}"), file);
      assert.ok(src.includes("t(`approveBlocked.${approveBlocked}`)"), file);
      assert.ok(src.includes('data.error === "not_approvable"'), file);
    }
    assert.equal((read("app/dashboard/admin/products/page.tsx").match(/approveBlocked=\{p\.fileSafety\.publishable \? null : p\.fileSafety\.reason\}/g) ?? []).length, 2);
    assert.ok(read("app/dashboard/admin/products/[id]/preview/page.tsx").includes("approveBlocked={product.fileSafety.publishable ? null : product.fileSafety.reason}"));
    for (const locale of ["en", "ar"]) {
      const blocked = JSON.parse(read(`messages/${locale}.json`)).admin.directory.approveBlocked;
      for (const reason of ["missing_file_key", "pending_scan", "scan_error", "unsafe", "scan_key_mismatch", "file_changed"]) {
        assert.ok(blocked[reason], `${locale}: ${reason}`);
      }
    }
  });
});

describe("an approved product without a safe file still reaches no buyer", () => {
  test("every public listing, checkout and download carry the safety gate", () => {
    for (const file of ["app/page.tsx", "app/browse/page.tsx", "app/shop/[slug]/page.tsx", "app/shop/[slug]/product/[productSlug]/page.tsx"]) {
      assert.ok(read(file).includes("SELLABLE_PRODUCT_WHERE"), file);
    }
    // The shared storefront rule carries the safety clause itself (lib/sellable).
    assert.ok(read("lib/sellable.ts").includes("...SAFE_DELIVERABLE_WHERE,"));
    for (const file of ["app/api/checkout/route.ts", "app/api/download/[productId]/route.ts"]) {
      assert.ok(read(file).includes("if (!isDeliverableSafe(product))"), file);
    }
  });
});
