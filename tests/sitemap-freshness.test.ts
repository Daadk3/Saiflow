/**
 * The sitemap must reflect the database, not the deployment.
 *
 * A sitemap.ts that uses no dynamic API is statically prerendered by Next, so
 * the file freezes whatever the database said when the build ran. That is not
 * a hypothetical: a product approved after a Production deploy was listed by
 * /browse immediately and stayed absent from /sitemap.xml, because the two
 * surfaces share an eligibility rule but not a render mode.
 *
 * The config is one line and easy to drop in a refactor, and nothing would
 * fail loudly if it were — the sitemap would simply go quietly stale again.
 * Hence this file.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(resolve(ROOT, "app/sitemap.ts"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("the sitemap is rendered per request", () => {
  test("it declares force-dynamic", () => {
    assert.ok(
      /export const dynamic\s*=\s*["']force-dynamic["']/.test(code),
      "app/sitemap.ts must opt out of static prerendering, or it will serve a build-time snapshot"
    );
  });

  test("it does not also declare a revalidate window", () => {
    // Belt and braces: a revalidate alongside force-dynamic is a contradiction
    // in intent and a sign someone reintroduced caching without noticing.
    assert.ok(!/export const revalidate/.test(code));
  });

  test("it is not marked static or forced into a cache", () => {
    assert.ok(!/["']force-static["']/.test(code));
    assert.ok(!/export const fetchCache\s*=\s*["']force-cache["']/.test(code));
  });
});

describe("the fix changed freshness only, not eligibility", () => {
  test("the three-part rule is intact", () => {
    assert.ok(/isActive: true/.test(code));
    assert.ok(/moderationStatus: "APPROVED"/.test(code));
    assert.ok(code.includes("...SAFE_DELIVERABLE_WHERE"));
  });

  test("the canonical clause is still imported, not restated", () => {
    assert.ok(/import \{ SAFE_DELIVERABLE_WHERE \} from "@\/lib\/file-safety"/.test(code));
    assert.ok(!/fileScanStatus:\s*"SAFE"/.test(code), "must not restate the status");
    assert.ok(!/fileScanKey:\s*\{/.test(code), "must not restate the key binding");
    assert.ok(!/fileKey:\s*\{\s*not:/.test(code), "must not restate the key check");
  });

  test("no extra condition was slipped into the product query", () => {
    // The product where-clause should contain exactly the two literal
    // conditions plus the spread. Anything else is scope creep into a fix
    // that was supposed to touch rendering only.
    const start = code.indexOf("products: {");
    assert.notEqual(start, -1);
    const block = code.slice(start, code.indexOf("select: { slug: true }", start));
    const conditions = block.match(/^\s*\w+:/gm) ?? [];
    assert.deepEqual(
      conditions.map((c) => c.trim().replace(":", "")).sort(),
      ["isActive", "moderationStatus", "products", "where"].sort()
    );
  });

  test("a database failure still degrades to static pages", () => {
    // force-dynamic means this now runs per request, so the existing guard
    // matters more than it did: an outage must not 500 the sitemap.
    assert.ok(/catch\s*\{\s*return staticPages;/.test(code));
  });
});
