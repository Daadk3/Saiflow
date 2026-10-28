/**
 * The founder's 8-point product review checklist.
 *
 *   - points 3, 6 and 7 are checked automatically and shown as ✅ / ⚠️ with
 *     a short reason; 1, 2, 4, 5 and 8 are "مراجعة يدوية"
 *   - the checks only flag: nothing they write can approve or reject
 *   - a rejection is built from the ticked points, in Arabic, signed
 *     "فريق SaiFlow" and never with a person's name
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import {
  AUTO_CHECKED_POINTS,
  MANUAL_REVIEW_LABEL,
  REVIEW_CHECKLIST,
  TEAM_SIGNATURE,
  buildRejectionMessage,
  checklistRows,
  computeReviewChecks,
  findBannedTypes,
  findContactInfo,
  type FileContentFacts,
} from "@/lib/review-checklist";
import { extractFileFacts } from "@/lib/file-facts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const CLEAN_FACTS: FileContentFacts = { kind: "pdf", opens: true, pageCount: 12, textChecked: true, contact: [], banned: [] };
const base = {
  name: "دفتر تخطيط أسبوعي",
  description: "ملف PDF من 12 صفحة للتخطيط الأسبوعي، جاهز للطباعة.",
  fileKey: "key_a",
  fileScanStatus: "SAFE",
  fileScanKey: "key_a",
  facts: CLEAN_FACTS,
};

describe("the checklist itself", () => {
  test("has the eight points in order, with the Arabic labels", () => {
    assert.deepEqual(
      REVIEW_CHECKLIST.map((p) => p.label),
      [
        "يطابق الوصف",
        "محتوى كافٍ",
        "الملف آمن ويفتح والعربي سليم",
        "عمل البائع نفسه",
        "محتوى لائق (لا ديني/سياسي/غير لائق)",
        "لا إعلانات أو تواصل خارجي",
        "نوع مسموح (لا حل واجبات أو بحوث جاهزة أو شهادات مزيفة)",
        "وصف وغلاف صادقان",
      ]
    );
    assert.deepEqual([...AUTO_CHECKED_POINTS], [3, 6, 7]);
  });

  test("points 1, 2, 4, 5 and 8 are manual review", () => {
    const rows = checklistRows(computeReviewChecks(base), "key_a");
    for (const id of [1, 2, 4, 5, 8]) {
      const row = rows.find((r) => r.id === id)!;
      assert.equal(row.state, "manual");
      assert.equal(row.reason, MANUAL_REVIEW_LABEL);
    }
  });
});

describe("point 6: contact and ads", () => {
  for (const [text, flag] of [
    ["للطلب 0551234567", "phone"],
    ["للطلب ٠٥٥١٢٣٤٥٦٧", "phone"],
    ["+966 55 123 4567", "phone"],
    ["seller@example.com", "email"],
    ["زوروا https://example.com", "url"],
    ["www.mystore.sa", "url"],
    ["تابعني @my_store", "handle"],
    ["على الواتساب", "social"],
    ["Snapchat: me", "social"],
    ["انستقرام المتجر", "social"],
    ["تيليجرام", "social"],
    ["تَواصَل معنا للمزيد", "phrase"],
    ["اطلب عبر الخاص", "phrase"],
    ["راسلنا", "phrase"],
  ] as const) {
    test(`finds ${flag} in "${text}"`, () => {
      assert.ok(findContactInfo(text).includes(flag), JSON.stringify(findContactInfo(text)));
    });
  }

  test("an email is not also a link or a handle; a price is not a phone", () => {
    assert.deepEqual(findContactInfo("seller@example.com"), ["email"]);
    assert.deepEqual(findContactInfo("السعر 49 ريال، 12 صفحة"), []);
  });

  test("a hit in the title shows ⚠️ with where it was found", () => {
    const checks = computeReviewChecks({ ...base, name: "دفتر - واتساب 0551234567" });
    assert.equal(checks.points[6].state, "warn");
    assert.match(checks.points[6].reason, /رقم هاتف.*\(العنوان\)/);
  });

  test("a hit in the file text shows ⚠️ (الملف)", () => {
    const checks = computeReviewChecks({ ...base, facts: { ...CLEAN_FACTS, contact: ["url"] } });
    assert.equal(checks.points[6].state, "warn");
    assert.match(checks.points[6].reason, /رابط \(الملف\)/);
  });

  test("clean everywhere is ✅; unread file text is ⚠️, never a pass", () => {
    assert.equal(computeReviewChecks(base).points[6].state, "ok");
    const unread = computeReviewChecks({ ...base, facts: { ...CLEAN_FACTS, textChecked: false } });
    assert.equal(unread.points[6].state, "warn");
    assert.match(unread.points[6].reason, /تعذر استخراج نص الملف/);
    const noFacts = computeReviewChecks({ ...base, facts: null });
    assert.match(noFacts.points[6].reason, /لم يُفحص نص الملف بعد/);
  });
});

describe("point 7: banned product types", () => {
  for (const [text, flag] of [
    ["حل واجبات الرياضيات", "homework"],
    ["حل الواجبات", "homework"],
    ["بحوث جاهزة للطلاب", "ready_research"],
    ["كتابة بحث تخرج", "research_writing"],
    ["حل اختبار نهائي", "exam_solving"],
    ["قالب شهادة شكر", "certificate"],
  ] as const) {
    test(`flags ${flag} in "${text}"`, () => {
      assert.ok(findBannedTypes(text).includes(flag));
    });
  }

  test("an ordinary listing is ✅", () => {
    assert.equal(computeReviewChecks(base).points[7].state, "ok");
    assert.deepEqual(findBannedTypes(base.description), []);
  });
});

describe("point 3: safe, opens, page count", () => {
  test("SAFE + opens + pages is ✅ with the page count", () => {
    const p3 = computeReviewChecks(base).points[3];
    assert.equal(p3.state, "ok");
    assert.match(p3.reason, /12 صفحة/);
  });

  for (const [status, reason] of [
    ["PENDING_SCAN", /بانتظار فحص الأمان/],
    ["UNSAFE", /لم يجتز فحص الأمان/],
    ["SCAN_ERROR", /تعذر إكمال فحص الأمان/],
  ] as const) {
    test(`${status} is ⚠️`, () => {
      const p3 = computeReviewChecks({ ...base, fileScanStatus: status }).points[3];
      assert.equal(p3.state, "warn");
      assert.match(p3.reason, reason);
    });
  }

  test("a SAFE verdict for a different file is not this file's", () => {
    assert.equal(computeReviewChecks({ ...base, fileScanKey: "key_old" }).points[3].state, "warn");
  });

  test("a file that does not open, or a PDF with no pages, is ⚠️", () => {
    assert.equal(computeReviewChecks({ ...base, facts: { ...CLEAN_FACTS, opens: false } }).points[3].state, "warn");
    assert.equal(computeReviewChecks({ ...base, facts: { ...CLEAN_FACTS, pageCount: null } }).points[3].state, "warn");
    assert.equal(computeReviewChecks({ ...base, fileKey: null, fileScanKey: null }).points[3].state, "warn");
  });
});

describe("what the founder sees", () => {
  test("no stored result shows the auto points as not checked, never ✅", () => {
    const rows = checklistRows(null, "key_a");
    for (const id of AUTO_CHECKED_POINTS) assert.equal(rows.find((r) => r.id === id)!.state, "warn");
  });

  test("results stored for another file are shown as stale", () => {
    const rows = checklistRows(computeReviewChecks(base), "key_new");
    for (const id of AUTO_CHECKED_POINTS) {
      const row = rows.find((r) => r.id === id)!;
      assert.equal(row.state, "warn");
      assert.match(row.reason, /الملف تغيّر/);
    }
  });

  test("a malformed stored value is treated as none", () => {
    assert.equal(checklistRows({ version: 1, points: {} }, "key_a")[2].reason, "لم يُفحص بعد");
  });
});

describe("the rejection message", () => {
  test("is built from the ticked points, in order, and signed by the team", () => {
    const message = buildRejectionMessage([6, 1]);
    const lines = message.split("\n");
    assert.match(lines[0], /لم نتمكن من اعتماد منتجك/);
    assert.equal(lines[1], `• ${REVIEW_CHECKLIST[0].rejection}`);
    assert.equal(lines[2], `• ${REVIEW_CHECKLIST[5].rejection}`);
    assert.equal(lines.at(-1), TEAM_SIGNATURE);
    assert.equal(TEAM_SIGNATURE, "فريق SaiFlow");
  });

  test("nothing ticked builds nothing", () => {
    assert.equal(buildRejectionMessage([]), "");
  });

  test("every point has an Arabic reason for the seller", () => {
    for (const point of REVIEW_CHECKLIST) assert.match(point.rejection, /[؀-ۿ]/);
  });

  test("the dialog never reads the admin's name or session", () => {
    const dialog = read("components/admin/RejectDialog.tsx");
    assert.ok(dialog.includes("buildRejectionMessage("));
    assert.ok(!/useSession|session\.user|byName/.test(dialog));
  });
});

describe("auto-checks only flag", () => {
  test("the store writes reviewChecks and never moderationStatus", () => {
    const store = read("lib/review-checks-store.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(store.includes("reviewChecks:"));
    assert.ok(!/moderationStatus\s*:/.test(store));
  });

  test("the checklist module has no database access", () => {
    const src = read("lib/review-checklist.ts");
    assert.ok(!src.includes("@/lib/prisma"));
    assert.ok(!/moderationStatus/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
  });

  test("the moderation route keeps only valid ticked points, as audit categories", () => {
    const route = read("app/api/admin/moderation/[productId]/route.ts");
    assert.ok(route.includes("failedPoints.filter(isChecklistPointId)"));
    assert.ok(route.includes("categories: checklistCategories"));
  });

  test("seller saves and the scan both refresh the checks", () => {
    assert.ok(read("app/api/products/route.ts").includes("await refreshReviewChecks(product.id)"));
    assert.ok(read("app/api/products/[id]/route.ts").includes("await refreshReviewChecks(updatedProduct.id)"));
    assert.ok(read("lib/scan/run.ts").includes("await refreshReviewChecks(productId)"));
  });

  test("the queue cards and the preview page show the checklist", () => {
    assert.ok(read("app/dashboard/moderation/page.tsx").includes("<ReviewChecklist rows={p.checklist ?? []} compact />"));
    assert.ok(read("app/dashboard/admin/products/[id]/preview/page.tsx").includes("<ReviewChecklist rows={product.checklist} />"));
    assert.ok(read("app/api/admin/moderation/route.ts").includes("checklist: checklistRows(reviewChecks, fileKey, {"));
  });
});

/* ------------------------------------------------------------------ */
/* File facts                                                          */
/* ------------------------------------------------------------------ */

function pdf(pages: number, content: string, extra = ""): Uint8Array {
  const stream = deflateSync(Buffer.from(content, "latin1"));
  const parts: Buffer[] = [Buffer.from("%PDF-1.7\n")];
  for (let i = 0; i < pages; i++) parts.push(Buffer.from(`${10 + i} 0 obj << /Type /Page /Parent 2 0 R >> endobj\n`));
  parts.push(Buffer.from(`2 0 obj << /Type /Pages /Count ${pages} >> endobj\n`));
  parts.push(Buffer.from(`5 0 obj << /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from("\nendstream\nendobj\n"));
  parts.push(Buffer.from(`${extra}\ntrailer << /Root 1 0 R >>\n%%EOF\n`));
  return new Uint8Array(Buffer.concat(parts));
}

describe("file facts from the bytes", () => {
  test("a PDF: opens, pages counted, compressed text searched", () => {
    const facts = extractFileFacts(pdf(3, "BT /F1 12 Tf (Weekly planner with many pages of content. Call 0551234567) Tj ET"));
    assert.equal(facts.kind, "pdf");
    assert.equal(facts.opens, true);
    assert.equal(facts.pageCount, 3);
    assert.equal(facts.textChecked, true);
    assert.deepEqual(facts.contact, ["phone"]);
  });

  test("link annotations count as file text", () => {
    const facts = extractFileFacts(
      pdf(1, "BT (A long enough line of ordinary text for the planner pages here.) Tj ET", "7 0 obj << /S /URI /URI (https://wa.me/123) >> endobj")
    );
    assert.ok(facts.contact.includes("url"));
  });

  test("a clean PDF has no flags", () => {
    const facts = extractFileFacts(pdf(2, "BT (A clean weekly planner, printable, with daily sections and notes.) Tj ET"));
    assert.deepEqual([facts.contact, facts.banned], [[], []]);
    assert.equal(facts.textChecked, true);
  });

  test("a PDF with no readable text is not text-checked", () => {
    const facts = extractFileFacts(pdf(2, "q 1 0 0 1 0 0 cm Q"));
    assert.equal(facts.textChecked, false);
    assert.equal(facts.opens, true);
  });

  test("a truncated PDF does not open", () => {
    const bytes = pdf(2, "BT (x) Tj ET");
    assert.equal(extractFileFacts(bytes.subarray(0, bytes.length - 8)).opens, false);
  });

  test("unrecognised bytes do not open and are not text-checked", () => {
    const facts = extractFileFacts(new TextEncoder().encode("MZ this is not a deliverable at all"));
    assert.deepEqual([facts.opens, facts.textChecked, facts.kind], [false, false, null]);
  });

  test("facts are codes and counts only, never the file's text", () => {
    const facts = extractFileFacts(pdf(1, "BT (Secret sentence that must never be stored 0551234567) Tj ET"));
    assert.ok(!JSON.stringify(facts).includes("Secret"));
    assert.ok(!JSON.stringify(facts).includes("0551234567"));
  });
});

describe("sellers never see the review flags", () => {
  test("withoutReviewChecks drops both columns and keeps the rest", async () => {
    const { withoutReviewChecks } = await import("@/lib/review-checklist");
    const row = { id: "p1", name: "x", fileUrl: "u", reviewChecks: { version: 1 }, reviewChecksAt: new Date() };
    assert.deepEqual(Object.keys(withoutReviewChecks(row)).sort(), ["fileUrl", "id", "name"]);
  });

  test("every seller-facing product response strips them", () => {
    const one = read("app/api/products/[id]/route.ts");
    assert.ok(one.includes("...withoutReviewChecks(product), shop"), "GET");
    assert.ok(one.includes("const sellerProduct = withoutReviewChecks(updatedProduct);"), "PUT");
    assert.ok(!/NextResponse\.json\(updatedProduct\)/.test(one));
    assert.ok(read("app/api/products/route.ts").includes("NextResponse.json(withoutReviewChecks(product), { status: 201 })"), "POST");
  });
});

describe("the old Before-approving facts live inside the checklist", () => {
  test("point 2 shows the description length, point 8 the cover image, both still manual", () => {
    const rows = checklistRows(computeReviewChecks(base), "key_a", { description: "x".repeat(80), hasCover: true });
    const two = rows.find((r) => r.id === 2)!;
    const eight = rows.find((r) => r.id === 8)!;
    assert.equal(two.state, "manual");
    assert.equal(eight.state, "manual");
    assert.equal(two.hint?.state, "ok");
    assert.equal(eight.hint?.state, "ok");
  });

  test("a short description or no cover is ⚠️", () => {
    const rows = checklistRows(null, "key_a", { description: "  قصير  ", hasCover: false });
    assert.equal(rows.find((r) => r.id === 2)!.hint?.state, "warn");
    assert.match(rows.find((r) => r.id === 2)!.hint!.text, /\(4\)/);
    assert.equal(rows.find((r) => r.id === 8)!.hint?.state, "warn");
  });

  test("the cover counts only from allowed hosts", async () => {
    const { hasCoverImage } = await import("@/lib/review-checklist");
    const allowed = (u: string | null | undefined) => typeof u === "string" && u.startsWith("https://ok/");
    assert.equal(hasCoverImage({ thumbnailUrl: "https://evil/x", images: [] }, allowed), false);
    assert.equal(hasCoverImage({ thumbnailUrl: null, images: ["https://ok/1"] }, allowed), true);
  });

  test("the queue and the preview pass the basics", () => {
    assert.ok(read("app/api/admin/moderation/route.ts").includes("hasCover: hasCoverImage("));
    assert.ok(read("lib/admin-product-preview.ts").includes("hasCover: hasCoverImage(product, isAllowedAssetUrl)"));
  });
});
