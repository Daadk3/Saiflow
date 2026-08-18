/**
 * Stage E2 — the storefront may not offer what checkout would refuse.
 *
 * Every buyer-facing surface previously filtered on publication alone, so a
 * product could be listed, linked and indexed while its deliverable would be
 * rejected at checkout. The eight legacy products are exactly that: APPROVED
 * and active, with no fileKey at all.
 *
 * The gate reuses SAFE_DELIVERABLE_WHERE rather than restating it. That is the
 * property most worth pinning here — a second, subtly weaker definition of
 * "sellable" is the way this stage would fail, so these tests check the
 * clause's own shape, its equivalence to isDeliverableSafe across every state,
 * and that each surface actually spreads it.
 *
 * No database and no network: the clause is inspected as data, the surfaces as
 * source, and the equivalence is computed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isDeliverableSafe, SAFE_DELIVERABLE_WHERE } from "../lib/file-safety";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every buyer-facing surface that lists or exposes a product. */
const SURFACES: [string, string][] = [
  ["homepage", "app/page.tsx"],
  ["browse", "app/browse/page.tsx"],
  ["shop storefront", "app/shop/[slug]/page.tsx"],
  ["product page", "app/shop/[slug]/product/[productSlug]/page.tsx"],
  ["sitemap", "app/sitemap.ts"],
];

const KEY = "abc123XYZ_key-one";
const OTHER = "zzz999QQQ_key-two";
const STATUSES = ["PENDING_SCAN", "SAFE", "UNSAFE", "SCAN_ERROR"] as const;

/* ------------------------------------------------------------------ */
/* One definition, reused                                              */
/* ------------------------------------------------------------------ */

describe("the canonical clause is reused, not restated", () => {
  test("every surface spreads SAFE_DELIVERABLE_WHERE", () => {
    for (const [label, file] of SURFACES) {
      const code = strip(read(file));
      assert.ok(
        code.includes("...SAFE_DELIVERABLE_WHERE"),
        `${label} must spread the canonical clause`
      );
      assert.ok(
        /from "@\/lib\/file-safety"/.test(code),
        `${label} must import it from the canonical module`
      );
    }
  });

  test("no surface hand-rolls its own safety condition", () => {
    // A second definition is how the storefront and checkout drift apart.
    for (const [label, file] of SURFACES) {
      const code = strip(read(file));
      assert.ok(!/fileScanStatus:\s*"SAFE"/.test(code), `${label} restates the status`);
      assert.ok(!/fileScanKey:\s*\{/.test(code), `${label} restates the key binding`);
      assert.ok(!/fileKey:\s*\{\s*not:/.test(code), `${label} restates the key check`);
    }
  });

  test("the clause itself is the three-part rule", () => {
    const w = SAFE_DELIVERABLE_WHERE as Record<string, unknown>;
    assert.deepEqual(Object.keys(w).sort(), [
      "fileKey",
      "fileScanKey",
      "fileScanStatus",
    ]);
    assert.equal(w.fileScanStatus, "SAFE");
    assert.deepEqual(w.fileKey, { not: null });
    assert.ok(w.fileScanKey && typeof w.fileScanKey === "object");
    assert.ok("equals" in (w.fileScanKey as object));
  });

  test("the key binding points at Product.fileKey specifically", () => {
    // Asserting only that `equals` exists proves the comparison is a field
    // reference rather than a caller-supplied value — which is necessary, and
    // nowhere near sufficient. A reference repointed at ANY other Product
    // column would still be a field reference, still type-check, and still
    // pass that check, while silently comparing fileScanKey against something
    // that is not the attached file. `thumbnailUrl` would be the same shape
    // and a completely different rule.
    //
    // So inspect the reference itself. This is the one assertion standing
    // between "the storefront checks the key binding" and "the storefront
    // checks something".
    const ref = (SAFE_DELIVERABLE_WHERE.fileScanKey as { equals: unknown })
      .equals as {
      name: string;
      modelName: string;
      typeName: string;
      isList: boolean;
    };

    assert.equal(ref.name, "fileKey", "must compare against fileKey");
    assert.equal(ref.modelName, "Product", "must be Product.fileKey, not another model");

    // Same column, wrong shape, would also be wrong: the comparison is a
    // scalar string equality, not a list membership.
    assert.equal(ref.typeName, "String");
    assert.equal(ref.isList, false);
  });

  test("the clause therefore expresses fileScanKey = fileKey on the same row", () => {
    // Stated as the rule a reader cares about, so the intent survives even if
    // Prisma's internal reference shape changes underneath it.
    const ref = (SAFE_DELIVERABLE_WHERE.fileScanKey as { equals: unknown })
      .equals as { name: string; modelName: string };
    assert.equal(
      `${ref.modelName}.${ref.name}`,
      "Product.fileKey",
      "the verdict must be bound to the file currently attached"
    );
  });

  test("publication and safety stay separate conditions", () => {
    for (const [label, file] of SURFACES) {
      const code = strip(read(file));
      assert.ok(/moderationStatus: "APPROVED"/.test(code), `${label} lost moderation`);
      assert.ok(/isActive: true/.test(code), `${label} lost isActive`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Equivalence with the enforced predicate                             */
/* ------------------------------------------------------------------ */

describe("the listing rule admits exactly what checkout admits", () => {
  /** The clause, evaluated in TypeScript the way Postgres would. */
  function clauseAdmits(row: {
    fileKey: string | null;
    fileScanStatus: string;
    fileScanKey: string | null;
  }): boolean {
    return (
      row.fileKey !== null &&
      row.fileScanStatus === "SAFE" &&
      row.fileScanKey === row.fileKey
    );
  }

  test("across every key and status combination", () => {
    let checked = 0;
    for (const fileKey of [null, KEY]) {
      for (const fileScanKey of [null, KEY, OTHER]) {
        for (const fileScanStatus of STATUSES) {
          const row = { fileKey, fileScanKey, fileScanStatus };
          assert.equal(
            clauseAdmits(row),
            isDeliverableSafe(row),
            `divergence at ${JSON.stringify(row)}`
          );
          checked++;
        }
      }
    }
    assert.equal(checked, 24);
  });

  test("SCAN_ERROR is never admitted", () => {
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: KEY, fileScanStatus: "SCAN_ERROR" }),
      false
    );
  });

  test("PENDING_SCAN is never admitted", () => {
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: KEY, fileScanStatus: "PENDING_SCAN" }),
      false
    );
  });

  test("UNSAFE is never admitted", () => {
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: KEY, fileScanStatus: "UNSAFE" }),
      false
    );
  });

  test("a stale SAFE verdict for a replaced file is never admitted", () => {
    // The trap fileScanKey exists to catch: SAFE, but for different bytes.
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: OTHER, fileScanStatus: "SAFE" }),
      false
    );
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: null, fileScanStatus: "SAFE" }),
      false
    );
  });

  test("a legacy product with no fileKey is never admitted", () => {
    // All eight live legacy products are exactly this shape.
    for (const fileScanStatus of STATUSES) {
      assert.equal(
        clauseAdmits({ fileKey: null, fileScanKey: null, fileScanStatus }),
        false
      );
    }
  });

  test("only SAFE with a matching key is admitted", () => {
    assert.equal(
      clauseAdmits({ fileKey: KEY, fileScanKey: KEY, fileScanStatus: "SAFE" }),
      true
    );
  });
});

/* ------------------------------------------------------------------ */
/* The product page and its CTA                                        */
/* ------------------------------------------------------------------ */

describe("a non-sellable product page is not rendered at all", () => {
  const pageSrc = read("app/shop/[slug]/product/[productSlug]/page.tsx");

  test("the query is gated and a miss becomes notFound()", () => {
    const code = strip(pageSrc);
    assert.ok(code.includes("...SAFE_DELIVERABLE_WHERE"));
    assert.ok(/notFound\(\)/.test(code), "a filtered-out product must 404");
  });

  test("the legacy fileUrl column is gone from the public page", () => {
    // It was the CTA's proof of sellability, which is exactly what it is not.
    const code = strip(pageSrc);
    assert.ok(!/fileUrl/.test(code), "fileUrl must not be selected or read here");
  });

  test("the CTA is not driven by any file column", () => {
    const code = strip(pageSrc);
    assert.ok(!/hasFile=/.test(code));
    assert.ok(/<BuyButton[^>]*sellable/.test(code));
  });
});

describe("BuyButton fails closed", () => {
  const btnSrc = read("app/shop/[slug]/product/[productSlug]/BuyButton.tsx");
  const code = strip(btnSrc);

  test("sellable defaults to false, not true", () => {
    assert.ok(/sellable = false/.test(code), "omission must disable the button");
    assert.ok(!/sellable = true/.test(code));
    assert.ok(!/hasFile/.test(code), "the old fail-open prop is gone");
  });

  test("a non-sellable product renders the disabled state", () => {
    assert.ok(/if \(!sellable\)/.test(code));
    assert.ok(/disabled/.test(code));
  });

  test("pre-launch still takes precedence", () => {
    assert.ok(/preLaunchMode/.test(code));
    assert.ok(/loading \|\| preLaunchMode \|\| !sellable/.test(code));
  });
});

/* ------------------------------------------------------------------ */
/* Nothing else moved                                                  */
/* ------------------------------------------------------------------ */

describe("the enforced gates and the flag are untouched", () => {
  test("checkout still refuses on isDeliverableSafe", () => {
    const code = strip(read("app/api/checkout/route.ts"));
    assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(code));
    assert.ok(/env\.PRE_LAUNCH_MODE/.test(code));
  });

  test("download still refuses on isDeliverableSafe", () => {
    const code = strip(read("app/api/download/[productId]/route.ts"));
    assert.ok(/if \(!isDeliverableSafe\(product\)\)/.test(code));
  });

  test("PRE_LAUNCH_MODE still defaults closed", () => {
    const code = strip(read("lib/env.ts"));
    assert.ok(/\.default\("true"\)/.test(code));
    assert.ok(/v !== "false"/.test(code));
  });

  test("the predicate itself was not edited", () => {
    const code = strip(read("lib/file-safety.ts"));
    assert.ok(/product\.fileKey !== null/.test(code));
    assert.ok(/product\.fileScanStatus === "SAFE"/.test(code));
    assert.ok(/product\.fileScanKey === product\.fileKey/.test(code));
  });

  test("moderation is not inferred from safety, nor safety from moderation", () => {
    for (const [label, file] of SURFACES) {
      const code = strip(read(file));
      // Both conditions present, neither expressed in terms of the other.
      assert.ok(/moderationStatus: "APPROVED"/.test(code), label);
      assert.ok(code.includes("...SAFE_DELIVERABLE_WHERE"), label);
      assert.ok(!/moderationStatus:\s*\{/.test(code), `${label} conditionalises moderation`);
    }
  });
});
