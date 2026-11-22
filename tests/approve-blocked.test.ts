/**
 * Approve on a hosted-access product follows the moderation route, not the
 * file-safety gate. A hosted product has no file key, so the old
 * `publishable ? null : reason` expression always disabled the button.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { approveBlockedReason } from "../lib/approve-blocked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const READY = {
  accessUrl: "https://agent.example.com/start",
  instructions: "Sign in with the email you bought with.",
};
const file = (publishable: boolean, reason: string) => ({ publishable, reason });
const missingFile = file(false, "missing_file_key");

describe("approveBlockedReason", () => {
  test("a ready hosted product is approvable even though it has no file", () => {
    assert.equal(
      approveBlockedReason({
        deliveryType: "HOSTED_ACCESS",
        fileSafety: missingFile,
        hostedAccess: READY,
        deliverables: [],
      }),
      null
    );
  });

  test("invalid or missing access is hosted_access_missing, ahead of stray files", () => {
    for (const hostedAccess of [
      null,
      undefined,
      { accessUrl: "http://10.0.0.1/", instructions: null },
      { accessUrl: "https://agent.example.com/start", instructions: "Password: x" },
    ]) {
      assert.equal(
        approveBlockedReason({
          deliveryType: "HOSTED_ACCESS",
          fileSafety: missingFile,
          hostedAccess,
          deliverables: [{ fileKey: "extra" }],
        }),
        "hosted_access_missing",
        JSON.stringify(hostedAccess)
      );
    }
  });

  test("a ready hosted product that still has deliverable rows is hosted_has_files", () => {
    assert.equal(
      approveBlockedReason({
        deliveryType: "HOSTED_ACCESS",
        fileSafety: missingFile,
        hostedAccess: READY,
        deliverables: [{}],
      }),
      "hosted_has_files"
    );
    assert.equal(
      approveBlockedReason({
        deliveryType: "HOSTED_ACCESS",
        fileSafety: file(true, "safe"),
        hostedAccess: READY,
        deliverables: null,
      }),
      "hosted_has_files",
      "a relation that was not loaded is not treated as no files"
    );
  });

  test("FILE products keep the file-safety result", () => {
    assert.equal(
      approveBlockedReason({ deliveryType: "FILE", fileSafety: file(true, "safe"), hostedAccess: READY, deliverables: [{}] }),
      null
    );
    for (const reason of ["missing_file_key", "pending_scan", "scan_error", "unsafe", "scan_key_mismatch"]) {
      assert.equal(
        approveBlockedReason({ deliveryType: "FILE", fileSafety: file(false, reason), hostedAccess: READY, deliverables: [] }),
        reason
      );
    }
    assert.equal(approveBlockedReason({ fileSafety: missingFile }), "missing_file_key");
  });
});

describe("both admin pages ask the helper, and the link stays off the client buttons", () => {
  const directory = read("app/dashboard/admin/products/page.tsx");
  const preview = read("app/dashboard/admin/products/[id]/preview/page.tsx");

  test("the directory's two Approve buttons and the preview's decision use the helper", () => {
    assert.match(directory, /import \{ approveBlockedReason \} from "@\/lib\/approve-blocked";/);
    assert.match(directory, /return approveBlockedReason\(\{/);
    assert.equal((directory.match(/approveBlocked=\{approveBlockedFor\(p\)\}/g) ?? []).length, 2);
    assert.ok(!directory.includes("fileSafety.publishable ? null"));

    assert.match(preview, /import \{ approveBlockedReason \} from "@\/lib\/approve-blocked";/);
    assert.match(preview, /approveBlocked=\{approveBlockedReason\(\{/);
    assert.ok(!preview.includes("fileSafety.publishable ? null"));
  });

  test("neither page hands the access link to a client component", () => {
    const buttons = directory.match(/<ReviewButton[\s\S]*?\/>/g) ?? [];
    assert.equal(buttons.length, 2);
    for (const button of buttons) {
      assert.ok(!/accessUrl|instructions|hostedAccess/.test(button), button);
    }
    assert.ok(!directory.includes("accessUrl"));
    const decision = preview.match(/<DecisionButtons[\s\S]*?\/>/)?.[0] ?? "";
    assert.match(decision, /approveBlocked=\{approveBlockedReason\(/);
    assert.ok(!decision.includes("accessUrl"));
    assert.ok(!decision.includes("instructions"));
  });

  test("the directory selects the link for the gate and the preview still selects only the id", () => {
    const stats = read("lib/admin-stats.ts");
    assert.ok(stats.includes("hostedAccess: { select: { accessUrl: true, instructions: true } }"));
    assert.ok(!stats.slice(stats.indexOf("rows: page.map")).includes("accessUrl"));
    const previewLib = read("lib/admin-product-preview.ts");
    assert.ok(previewLib.includes("hostedAccess: { select: { productId: true } }"));
    assert.ok(!previewLib.includes("accessUrl"));
  });

  test("English and Arabic already name both hosted refusals", () => {
    for (const locale of ["en", "ar"]) {
      const blocked = JSON.parse(read(`messages/${locale}.json`)).admin.directory.approveBlocked;
      assert.equal(typeof blocked.hosted_access_missing, "string");
      assert.equal(typeof blocked.hosted_has_files, "string");
      assert.ok(blocked.hosted_access_missing.length > 0);
      assert.ok(blocked.hosted_has_files.length > 0);
    }
  });

  test("the review queue's 409 copy names the hosted reasons", () => {
    const src = read("app/dashboard/moderation/page.tsx");
    assert.ok(src.includes('reason === "hosted_access_missing"'));
    assert.ok(src.includes('reason === "hosted_has_files"'));
    assert.ok(src.includes("Can't approve: the hosted access link is missing or fails the link rules."));
    assert.ok(src.includes("Can't approve: this hosted product still has files attached. Remove them first."));
    assert.ok(src.includes("لا يمكن الاعتماد: رابط الوصول المستضاف مفقود أو لا يجتاز قواعد الروابط."));
    assert.ok(src.includes("لا يمكن الاعتماد: هذا المنتج المستضاف ما زالت عليه ملفات. أزلها أولًا."));
    assert.ok(src.includes("A product can't be approved until its file passes the safety check."));
  });
});
