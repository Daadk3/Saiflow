/**
 * Admin "Inspect file" control.
 *
 * The founder cannot judge whether a deliverable matches its listing without
 * opening it. This exposes the seller's file from the products-directory
 * review control, where the decision is actually made.
 *
 * Two properties matter and are asserted here: a non-allowlisted URL must
 * never reach the browser, and the link must not render when there is no
 * file. Both are checked against source text — asserting real behaviour would
 * need a database and a DOM, and this suite deliberately has neither.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isAllowedAssetUrl } from "../lib/validations.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const stats = read("../lib/admin-stats.ts");
const button = read("../components/admin/ReviewButton.tsx");
const page = read("../app/dashboard/admin/products/page.tsx");

describe("inspect-file: no deliverable URL reaches the browser", () => {
  test("the directory row emits a boolean, not a URL", () => {
    // Supersedes the allowlist filter that used to stand here. Stage D2 made
    // this stronger rather than weaker: there is no longer a URL to filter,
    // because none is emitted at all. The row carries only whether the
    // inspection route would have a key to sign.
    assert.ok(
      /canInspect: p\.fileKey != null/.test(stats),
      "admin-stats must expose canInspect, keyed on fileKey"
    );
    const emitted = stats.slice(stats.indexOf("rows: page.map"));
    assert.ok(
      !/\bfileUrl:/.test(emitted),
      "no deliverable URL may be emitted in a directory row"
    );
  });

  test("hasFile is keyed on the storage key, not the legacy URL", () => {
    // This test used to assert `hasFile: p.fileUrl != null` and was named
    // "hasFile is left untouched" — Stage D2 deliberately changed nothing
    // about it. Stage E3 changed it on purpose: `fileUrl` is the pre-Stage-B
    // column, and it is populated on exactly the legacy products that carry
    // no storage key, so the "no file" badge was being suppressed on the only
    // rows it existed for. The guarantee this test carries is unchanged in
    // spirit — the directory answers "is there a deliverable?" from the same
    // column every downstream gate keys on.
    assert.ok(/hasFile: p\.fileKey != null/.test(stats));
    assert.ok(!/hasFile: p\.fileUrl/.test(stats));
  });

  test("the allowlist rejects everything except the storage hosts", () => {
    for (const ok of [
      "https://utfs.io/f/abc",
      "https://z09wl7xuez.ufs.sh/f/abc",
      "https://x.uploadthing.com/f/abc",
    ]) {
      assert.equal(isAllowedAssetUrl(ok), true, `should allow ${ok}`);
    }
    for (const bad of [
      "http://utfs.io/f/abc", // plaintext
      "https://evil.example.com/f/abc", // arbitrary host
      "https://utfs.io.evil.com/f/abc", // suffix-spoof
      "javascript:alert(1)",
      "data:text/html,<script>",
      "",
      null,
      undefined,
    ]) {
      assert.equal(isAllowedAssetUrl(bad), false, `should reject ${String(bad)}`);
    }
  });
});

describe("inspect-file: the control renders only when there is a file", () => {
  test("the link is conditional on fileHref", () => {
    assert.ok(
      /\{fileHref && \(/.test(button),
      "a product without a file must render no inspect link"
    );
  });

  test("it opens in a new tab with noopener", () => {
    // Same treatment the moderation queue already gives this link.
    const block = button.slice(button.indexOf("{fileHref && ("));
    assert.ok(block.includes('target="_blank"'));
    assert.ok(block.includes('rel="noopener noreferrer"'));
  });

  test("inspecting never changes product state", () => {
    // It is an anchor, not a button — no handler, no fetch, no decision.
    // Bounded at the anchor's own closing tag: a wider window would run into
    // the Approve button and fail on its onClick.
    const start = button.indexOf("{fileHref && (");
    const block = button.slice(start, button.indexOf("</a>", start));
    assert.ok(block.length > 0, "inspect link block not found");
    assert.ok(!/onClick|decide\(|fetch\(/.test(block), "must be a plain link");
  });

  test("the existing Open / Approve / Reject / Cancel actions survive", () => {
    for (const key of ["open", "approve", "reject", "cancel"]) {
      assert.ok(button.includes(`t("${key}")`), `missing action: ${key}`);
    }
    assert.ok(button.includes('decide("APPROVED")'));
    assert.ok(button.includes('decide("REJECTED")'));
  });

  test("both table layouts pass the inspection route through", () => {
    // Desktop table and mobile card list each render a ReviewButton, and each
    // must point at SaiFlow's route rather than at the file.
    const uses = page.match(/<ReviewButton/g) ?? [];
    const passes =
      page.match(
        /fileHref=\{p\.canInspect \? `\/api\/admin\/inspect\/\$\{p\.id\}` : null\}/g
      ) ?? [];
    assert.equal(uses.length, 2, "expected desktop and mobile usages");
    assert.equal(passes.length, uses.length, "every usage must pass fileHref");
    assert.ok(!page.includes("p.fileUrl"), "no raw deliverable URL in the page");
  });
});

describe("inspect-file: the deliverable stays off public surfaces", () => {
  test("no public page reads the admin directory", () => {
    for (const f of [
      "../app/page.tsx",
      "../app/browse/page.tsx",
      "../app/shop/[slug]/page.tsx",
      "../app/shop/[slug]/product/[productSlug]/page.tsx",
    ]) {
      assert.ok(
        !read(f).includes("getProductsDirectory"),
        `${f} must not consume the admin directory`
      );
    }
  });

  test("the public product page still never renders fileUrl", () => {
    const pub = read("../app/shop/[slug]/product/[productSlug]/page.tsx");
    // It may test for a file's existence; it must never emit the URL.
    assert.ok(!/href=\{product\.fileUrl\}/.test(pub));
    assert.ok(!/\{product\.fileUrl\}/.test(pub.replace(/product\.fileUrl \&\&/g, "")));
  });

  test("buyer download authorisation is untouched", () => {
    const dl = read("../app/api/download/[productId]/route.ts");
    assert.ok(dl.includes("Not authorized to download this product"));
    assert.ok(/order/i.test(dl), "download must still require an order");
  });
});
