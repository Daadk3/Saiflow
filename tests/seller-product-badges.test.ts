/**
 * Seller-facing product status: one clear set of badges per row.
 *
 * lib/seller-product-badges is pure and is tested BEHAVIOURALLY across the
 * whole moderation × file-state × file-presence matrix. The copy is checked
 * against both locales. The dashboard row and the file badge component are
 * checked STRUCTURALLY, as source text: Node's runner cannot render them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { sellerProductBadges, type SellerBadge } from "../lib/seller-product-badges";
import { productLinkStatus } from "../lib/product-link-status";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const ar = JSON.parse(read("messages/ar.json"));
const en = JSON.parse(read("messages/en.json"));

type Moderation = "PENDING" | "APPROVED" | "REJECTED" | undefined;
type FileState = "uploaded" | "scanning" | "passed" | "failed";
const MODERATION: Moderation[] = ["PENDING", "APPROVED", "REJECTED", undefined];
const FILE_STATES: FileState[] = ["uploaded", "scanning", "passed", "failed"];
const fs = (state: FileState) => ({ state, failure: null, canRetry: false });
const badges = (moderationStatus: Moderation, state: FileState | null, hasFile = state !== null): SellerBadge[] =>
  sellerProductBadges({ moderationStatus, hasFile, fileState: state ? fs(state) : null });

/** Every combination the row can be asked to render. */
function* matrix() {
  for (const m of MODERATION) {
    for (const s of FILE_STATES) yield { m, s, hasFile: true };
    for (const s of [...FILE_STATES, null]) yield { m, s, hasFile: false };
  }
}

/* ------------------------------------------------------------------ */
/* 1. What the row shows                                               */
/* ------------------------------------------------------------------ */

describe("what the row shows", () => {
  test("while the file is being checked: the file badge, and nothing about approval yet", () => {
    for (const s of ["uploaded", "scanning"] as const) {
      assert.deepEqual(badges("PENDING", s), ["file_state"]);
      assert.deepEqual(badges("APPROVED", s), ["file_state"]);
      assert.deepEqual(badges(undefined, s), ["file_state"]);
      assert.deepEqual(badges("REJECTED", s), ["rejected", "file_state"]);
    }
  });

  test("file passed, product awaiting approval: file checked + awaiting approval, in that order", () => {
    assert.deepEqual(badges("PENDING", "passed"), ["file_state", "awaiting_approval"]);
    assert.deepEqual(badges(undefined, "passed"), ["file_state", "awaiting_approval"]);
  });

  test("file passed and product approved: ready to sell, on its own", () => {
    assert.deepEqual(badges("APPROVED", "passed"), ["ready"]);
  });

  test("rejected: the rejection, and the file only if it still needs attention", () => {
    assert.deepEqual(badges("REJECTED", "passed"), ["rejected"], "a passed file adds nothing to a rejection");
    assert.deepEqual(badges("REJECTED", "failed"), ["rejected", "file_state"]);
    assert.deepEqual(badges("REJECTED", "scanning"), ["rejected", "file_state"]);
    assert.deepEqual(badges("REJECTED", null), ["rejected", "no_file"]);
  });

  test("file check failed: the failure (with its retry), and nothing that sounds like progress", () => {
    for (const m of ["PENDING", "APPROVED", undefined] as const) {
      assert.deepEqual(badges(m, "failed"), ["file_state"]);
    }
  });

  test("no file: the missing-file warning, whatever the scan columns once said", () => {
    for (const m of ["PENDING", "APPROVED", undefined] as const) {
      for (const s of [...FILE_STATES, null]) {
        assert.deepEqual(badges(m, s, false), ["no_file"], `${m} / ${s}`);
      }
    }
  });

  test("'ready' is exactly the public link's 'live' condition, never wider", () => {
    for (const { m, s, hasFile } of matrix()) {
      const shown = sellerProductBadges({ moderationStatus: m, hasFile, fileState: s ? fs(s) : null });
      const live =
        hasFile &&
        productLinkStatus({ moderationStatus: m, fileSafety: s === "passed" ? "ready" : "checking" }) === "live";
      assert.equal(shown.includes("ready"), live, `${m} / ${s} / hasFile=${hasFile}`);
    }
  });

  test("ready never appears beside file checked or awaiting approval, and a row never gets more than two badges", () => {
    for (const { m, s, hasFile } of matrix()) {
      const shown = sellerProductBadges({ moderationStatus: m, hasFile, fileState: s ? fs(s) : null });
      if (shown.includes("ready")) assert.deepEqual(shown, ["ready"]);
      assert.ok(shown.length <= 2, `${m} / ${s}: ${shown.join(",")}`);
      assert.equal(new Set(shown).size, shown.length, "no duplicate badge");
    }
  });

  test("the input is not mutated and the output is a fresh array each time", () => {
    const input = { moderationStatus: "PENDING" as const, hasFile: true, fileState: fs("passed") };
    const a = sellerProductBadges(input);
    const b = sellerProductBadges(input);
    assert.notEqual(a, b);
    assert.deepEqual(input, { moderationStatus: "PENDING", hasFile: true, fileState: fs("passed") });
  });
});

/* ------------------------------------------------------------------ */
/* 2. The words                                                        */
/* ------------------------------------------------------------------ */

describe("the words, in both locales", () => {
  test("Arabic says exactly what was asked for", () => {
    assert.equal(ar.fileSafety.stateScanning, "جاري فحص الملف");
    assert.equal(ar.fileSafety.stateUploaded, "جاري فحص الملف", "uploaded reads as in progress too");
    assert.equal(ar.fileSafety.statePassed, "تم فحص الملف");
    assert.equal(ar.fileSafety.stateFailed, "فشل فحص الملف");
    assert.equal(ar.dashboard.shop.awaitingApproval, "بانتظار اعتماد المنتج");
    assert.equal(ar.dashboard.shop.readyToSell, "جاهز للبيع");
    assert.equal(ar.moderation.rejectedBadge, "مرفوض");
    assert.equal(ar.dashboard.shop.noFile, "لا يوجد ملف");
    assert.equal(ar.fileSafety.noticeTitle, "منتجك بانتظار الاعتماد", "the blue notice above the list agrees with the badges");
  });

  test("English matches it", () => {
    assert.equal(en.fileSafety.stateScanning, "Checking file");
    assert.equal(en.fileSafety.stateUploaded, "Checking file");
    assert.equal(en.fileSafety.statePassed, "File checked");
    assert.equal(en.fileSafety.stateFailed, "File check failed");
    assert.equal(en.dashboard.shop.awaitingApproval, "Awaiting product approval");
    assert.equal(en.dashboard.shop.readyToSell, "Ready to sell");
    assert.equal(en.moderation.rejectedBadge, "Rejected");
    assert.equal(en.dashboard.shop.noFile, "No file");
    assert.equal(en.fileSafety.noticeTitle, "Your product is awaiting approval");
  });

  test("the vague wording is gone from the seller's row", () => {
    const page = read("app/dashboard/shop/[slug]/page.tsx");
    assert.ok(!page.includes('tModeration("pendingBadge")'), "the row still renders the vague pending badge");
    assert.ok(!page.includes('moderationStatus === "PENDING"'));
    assert.notEqual(ar.fileSafety.statePassed, "اجتاز الملف الفحص");
    for (const v of [ar.dashboard.shop.readyToSell, ar.dashboard.shop.awaitingApproval, ar.fileSafety.noticeTitle, ...["stateUploaded", "stateScanning", "statePassed", "stateFailed"].map((k) => ar.fileSafety[k])]) {
      assert.ok(!String(v).includes("قيد المراجعة"), `vague: ${v}`);
    }
  });

  test("the new copy obeys the creator-copy rules", () => {
    const fresh = [
      ar.fileSafety.stateUploaded, ar.fileSafety.stateScanning, ar.fileSafety.statePassed, ar.fileSafety.stateFailed,
      ar.dashboard.shop.readyToSell, ar.dashboard.shop.awaitingApproval, ar.fileSafety.noticeTitle,
      en.fileSafety.stateUploaded, en.fileSafety.stateScanning, en.fileSafety.statePassed, en.fileSafety.stateFailed,
      en.dashboard.shop.readyToSell, en.dashboard.shop.awaitingApproval, en.fileSafety.noticeTitle,
    ] as string[];
    const words = ["cloudmersive", "virus", "malware", "scanner", "antivirus", "hash", "sha256", "فيروس", "برمجيات ضارة"];
    for (const s of fresh) {
      assert.ok(s.trim().length > 0, "empty string");
      for (const w of words) assert.ok(!s.toLowerCase().includes(w), `${w} in: ${s}`);
      assert.ok(!/automatic/i.test(s) && !/تلقائي/.test(s), `automatic in: ${s}`);
      assert.ok(!/within \d/i.test(s) && !/خلال \d/.test(s) && !/guarantee/i.test(s), `promise in: ${s}`);
      for (const t of ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"]) assert.ok(!new RegExp(`\\b${t}\\b`).test(s), `${t} in: ${s}`);
    }
  });

  test("both locales define the same dashboard.shop and fileSafety keys", () => {
    assert.deepEqual(Object.keys(ar.dashboard.shop).sort(), Object.keys(en.dashboard.shop).sort());
    assert.deepEqual(Object.keys(ar.fileSafety).sort(), Object.keys(en.fileSafety).sort());
  });
});

/* ------------------------------------------------------------------ */
/* 3. Wiring (STRUCTURAL)                                              */
/* ------------------------------------------------------------------ */

describe("wiring (structural: the row and the component are read as source, not rendered)", () => {
  const page = read("app/dashboard/shop/[slug]/page.tsx");
  const component = read("components/FileScanState.tsx");
  const lib = read("lib/seller-product-badges.ts");

  test("the row derives its badges once per product and renders each from that", () => {
    assert.match(page, /import \{ sellerProductBadges \} from "@\/lib\/seller-product-badges";/);
    assert.match(page, /const badges = sellerProductBadges\(product\);/);
    assert.match(page, /\{badges\.includes\("rejected"\) && \([\s\S]*?tModeration\("rejectedBadge"\)/);
    assert.match(page, /\{badges\.includes\("ready"\) && \([\s\S]*?bg-teal-500\/10 text-teal-400[\s\S]*?t\("readyToSell"\)/, "ready is green");
    assert.match(page, /\{badges\.includes\("file_state"\) && \([\s\S]*?<FileScanState[\s\S]*?value=\{product\.fileState\}[\s\S]*?onRetried=\{fetchShop\}/);
    assert.match(page, /\{badges\.includes\("awaiting_approval"\) && \([\s\S]*?bg-amber-500\/10 text-amber-400[\s\S]*?t\("awaitingApproval"\)/, "awaiting approval is amber");
    assert.match(page, /\{!product\.hasFile && \([\s\S]*?t\("noFile"\)/, "the missing-file warning is unchanged");
    // Order on the row: rejection, ready, file, approval.
    const at = (s: string) => page.indexOf(s);
    assert.ok(at('badges.includes("rejected")') < at('badges.includes("ready")'));
    assert.ok(at('badges.includes("ready")') < at('badges.includes("file_state")'));
    assert.ok(at('badges.includes("file_state")') < at('badges.includes("awaiting_approval")'));
    assert.ok(at('badges.includes("awaiting_approval")') < at("!product.hasFile && ("));
  });

  test("the file badge treats uploaded like scanning: same colour, same spinner; passed stays green, failed red", () => {
    const badge = (k: string) => new RegExp(`${k}: "([^"]+)"`).exec(component)?.[1];
    assert.equal(badge("uploaded"), badge("scanning"));
    assert.match(badge("scanning") ?? "", /blue/);
    assert.match(badge("passed") ?? "", /teal/);
    assert.match(badge("failed") ?? "", /red/);
    assert.match(component, /\(value\.state === "scanning" \|\| value\.state === "uploaded"\) && \(\s*<svg className="h-3 w-3 animate-spin"/);
    assert.match(component, /value\.state === "failed" && value\.canRetry && \(/, "retry still offered on a retryable failure");
  });

  test("presentation only: the derivation imports nothing but a type, and only the row imports it", () => {
    const imports = lib.match(/^\s*import[^;]*;/gm) ?? [];
    assert.equal(imports.length, 1);
    assert.match(imports[0], /^\s*import type /);
    assert.ok(!/prisma|fetch\(|SAFE_DELIVERABLE_WHERE|isDeliverableSafe/.test(lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no gate, query or request in the code");

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, "utf8").includes('from "@/lib/seller-product-badges"')) {
          importers.push(relative(ROOT, full));
        }
      }
    };
    for (const d of ["app", "components", "lib"]) walk(resolve(ROOT, d));
    assert.deepEqual(importers.sort(), ["app/dashboard/shop/[slug]/page.tsx"]);
  });

  test("the link-status sentence and its precedence are untouched", () => {
    const link = read("lib/product-link-status.ts");
    assert.match(link, /if \(moderationStatus === "REJECTED"\) return "rejected";/);
    assert.match(link, /if \(moderationStatus === "APPROVED" && fileSafety === "ready"\) return "live";/);
    assert.match(page, /productLinkStatusKey\(productLinkStatus\(product\)\)/);
  });
});
