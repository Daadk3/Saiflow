/**
 * Rejection reasons, everywhere they are needed (17 Oct 2026, part 2 item 1).
 *
 * The reason for every rejection was stored and emailed, but shown nowhere
 * in the app, and it was typed into a one-line browser prompt.
 *
 * What must hold:
 * - The founder's review page shows the latest rejection's reason, who
 *   decided and when, and the decision history; an older rejection without
 *   a reason says so.
 * - The seller sees the reason on their dashboard and on the edit page.
 * - Rejecting uses an in-page dialog with quick picks from the listing
 *   standards and a preview of the seller's email; no window.prompt is left.
 * - A product whose file is replaced after approval goes back to review.
 */
import { test, describe, before, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LISTING_STANDARDS } from "../lib/listing-standards.ts";
import { QUICK_REJECTION_REASONS, quickReasonText } from "../lib/rejection-reasons.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const events = [
  { action: "REJECTED", newStatus: "REJECTED", reason: "  The file is empty.  ", actor: "admin:adm_1", createdAt: new Date("2026-10-15T10:00:00Z") },
  { action: "RESUBMITTED", newStatus: "PENDING", reason: null, actor: "seller:usr_1", createdAt: new Date("2026-10-14T10:00:00Z") },
  { action: "REJECTED", newStatus: "REJECTED", reason: null, actor: "admin:adm_gone", createdAt: new Date("2026-10-13T10:00:00Z") },
  { action: "SUBMITTED", newStatus: "PENDING", reason: null, actor: "scanner:cloudmersive", createdAt: new Date("2026-10-12T10:00:00Z") },
];
const queried: Record<string, unknown>[] = [];
let history: typeof import("../lib/moderation-history.ts");

before(async () => {
  mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        moderationEvent: {
          findMany: async (args: Record<string, unknown>) => {
            queried.push(args);
            return events;
          },
        },
        user: { findMany: async () => [{ id: "adm_1", name: "Daad", email: "founder@example.test" }] },
      },
    },
  });
  history = await import("../lib/moderation-history.ts");
});

describe("the decision history", () => {
  test("decisions only, newest first, with who and why", async () => {
    const entries = await history.getDecisionHistory("prod_1");
    const args = queried[0] as { where: { action: { in: string[] } }; orderBy: unknown };
    assert.deepEqual(args.where.action.in.sort(), ["APPROVED", "REJECTED", "RESUBMITTED", "SUBMITTED"]);
    assert.deepEqual(args.orderBy, { createdAt: "desc" });
    assert.deepEqual(
      entries.map((e) => [e.action, e.by, e.byName, e.reason]),
      [
        ["REJECTED", "admin", "Daad", "The file is empty."],
        ["RESUBMITTED", "seller", null, null],
        ["REJECTED", "admin", null, null],
        ["SUBMITTED", "system", null, null],
      ]
    );
  });

  test("the latest rejection is the newest one; an older one may have no reason", async () => {
    const entries = await history.getDecisionHistory("prod_1");
    assert.equal(history.latestRejection(entries)?.reason, "The file is empty.");
    assert.equal(history.latestRejection(entries.slice(1))?.reason, null);
    assert.equal(history.latestRejection([]), null);
  });
});

describe("the reject dialog", () => {
  test("one quick reason per listing standard, plus the JavaScript one, each in both languages", () => {
    assert.equal(QUICK_REJECTION_REASONS.length, LISTING_STANDARDS.length + 1);
    assert.ok(QUICK_REJECTION_REASONS.some((r) => r.id === "pdf_javascript"));
    for (const reason of QUICK_REJECTION_REASONS) {
      assert.ok(/[؀-ۿ]/.test(reason.ar) && /[a-z]/i.test(reason.en), reason.id);
      assert.equal(quickReasonText(reason), `${reason.ar}\n${reason.en}`);
    }
    for (const locale of ["en", "ar"]) {
      const quick = JSON.parse(read(`messages/${locale}.json`)).admin.rejectDialog.quick;
      for (const reason of QUICK_REJECTION_REASONS) assert.ok(quick[reason.id], `${locale}: ${reason.id}`);
    }
  });

  test("the dialog requires a reason and previews the seller's email; no prompt box is left", () => {
    const dialog = read("components/admin/RejectDialog.tsx");
    assert.ok(dialog.includes("<dialog") && dialog.includes("showModal()"));
    assert.ok(dialog.includes("disabled={busy || !trimmed}"));
    assert.ok(dialog.includes('t("previewTitle")') && dialog.includes('t("previewNext")'));
    for (const file of ["components/admin/DecisionButtons.tsx", "components/admin/ReviewButton.tsx"]) {
      const src = read(file);
      assert.ok(!src.includes("window.prompt"), file);
      assert.ok(src.includes("<RejectDialog"), file);
    }
  });
});

describe("where the reason is shown", () => {
  test("on the founder's review page, with 'no reason recorded' for older rejections", () => {
    const page = read("app/dashboard/admin/products/[id]/preview/page.tsx");
    assert.ok(page.includes('{rejection?.reason ?? t("preview.noReasonRecorded")}'));
    assert.ok(page.includes("getDecisionHistory(product.id)"));
    assert.ok(page.includes('t("preview.history")'));
  });

  test("to the seller, from their own product data, on the dashboard and the edit page", () => {
    assert.ok(read("app/api/shops/[slug]/route.ts").includes("rejectionReason:"));
    assert.ok(read("app/api/products/[id]/route.ts").includes("rejectionReason: rejection?.reason?.trim() || null"));
    for (const file of ["app/dashboard/shop/[slug]/page.tsx", "app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx"]) {
      const src = read(file);
      assert.ok(src.includes('tModeration("rejectionReasonLabel")'), file);
      assert.ok(src.includes('tModeration("noReasonRecorded")'), file);
    }
  });
});

describe("a new file on an approved product goes back to review", () => {
  test("the edit route reopens APPROVED on a file change, and tells the seller beforehand", () => {
    const route = read("app/api/products/[id]/route.ts");
    assert.ok(route.includes('product.moderationStatus === "APPROVED" && (fileChanged || listingChanged)'));
    assert.match(route, /reopenFrom === "APPROVED"\s*\?\s*fileUrlChanged\s*\?\s*"File replaced after approval"\s*:\s*"Listing edited after approval"\s*:\s*null/);
    assert.ok(read("app/dashboard/shop/[slug]/product/[productSlug]/edit/page.tsx").includes('t("dashboard.product.replaceFileReview")'));
  });
});
