/**
 * Every row of the admin products directory opens that product's page.
 *
 * The page is where an admin inspects the file and retries a failed safety
 * check. Its only entry used to be the Review button, which is shown only
 * for products nobody has reviewed, so an approved product whose check
 * failed (as many did while the scanner key was dead) could not be reached
 * from the list at all.
 *
 * Structural: reads the source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(resolve(ROOT, "app/dashboard/admin/products/page.tsx"), "utf8");

test("the product name links to its page in both the table and the phone cards, whatever its review state", () => {
  const links = [...page.matchAll(/<Link\s+href=\{`\/dashboard\/admin\/products\/\$\{p\.id\}\/preview`\}[\s\S]*?<bdi>\{p\.name\}<\/bdi>\s*<\/Link>/g)];
  assert.equal(links.length, 2, "one in the table, one in the phone layout");
  for (const link of links) {
    const before = page.slice(Math.max(0, link.index! - 400), link.index);
    assert.ok(!/\{!p\.humanReviewed && \(\s*$/.test(before), "not hidden behind the unreviewed-only condition");
  }
});

test("the product page it opens is the one that offers the retry", () => {
  const preview = readFileSync(resolve(ROOT, "app/dashboard/admin/products/[id]/preview/page.tsx"), "utf8");
  assert.match(preview, /<RescanButton/);
});
