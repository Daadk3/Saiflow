/**
 * One-off data backfill: repair Product rows whose `slug` is empty.
 *
 * WHY
 * Products created before the non-Latin slug fallback shipped (lib/slug.ts)
 * stored an empty slug when the title contained no Latin characters — e.g. a
 * purely Arabic title. Those products are counted on their shop page but have
 * no usable URL: /shop/<shop>/product/ resolves to 404, and the sitemap
 * advertises the broken path. New products are already fixed; this repairs the
 * historical rows only.
 *
 * SAFETY
 * - Read-only by default. Requires an explicit --apply to write.
 * - Touches ONLY the `slug` column, ONLY on rows whose slug is blank.
 * - Refuses to run if the number of targets differs from --expect.
 * - Deterministic: the fallback handle is derived from the product id, so a
 *   re-run produces the same slug. Idempotent: a second run finds 0 targets.
 * - All writes happen inside a single transaction.
 * - Verifies afterwards that zero blank slugs remain, and exits non-zero on
 *   any mismatch.
 * - Logs ids, titles and slugs only. Never emails or any other personal data.
 *
 * USAGE
 *   node scripts/backfill-empty-product-slugs.ts            # dry run
 *   node scripts/backfill-empty-product-slugs.ts --apply    # write
 *   node scripts/backfill-empty-product-slugs.ts --expect 3 # different count
 *
 * NEVER wire this into the build command or any automatic deployment step.
 */

import { PrismaClient } from "@prisma/client";
// .ts extension is required by Node's native TypeScript loader (the script
// runs as `node scripts/...ts`, no build step, no extra dependency).
import { slugBase } from "../lib/slug.ts";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const expectFlag = args.indexOf("--expect");
const EXPECTED = expectFlag !== -1 ? Number(args[expectFlag + 1]) : 5;

if (!Number.isInteger(EXPECTED) || EXPECTED < 0) {
  console.error("--expect must be a non-negative integer");
  process.exit(2);
}

/** Deterministic, URL-safe handle for a title with no Latin characters. */
function fallbackHandle(productId: string): string {
  return `product-${productId.slice(-8).toLowerCase()}`;
}

function proposeSlug(name: string, productId: string): string {
  const base = slugBase(name ?? "");
  const candidate = base.length >= 2 ? base : fallbackHandle(productId);
  return candidate.slice(0, 100); // matches the API's product-slug cap
}

async function main() {
  const mode = APPLY ? "APPLY (will write)" : "DRY RUN (read-only)";
  console.log(`\n=== Empty product slug backfill — ${mode} ===\n`);

  // Blank = empty string or whitespace only. Raw read so btrim() is exact;
  // Prisma has no trim-aware filter.
  const blank = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Product" WHERE btrim("slug") = ''
  `;
  const ids = blank.map((r) => r.id);

  console.log(`Blank-slug products found: ${ids.length} (expected ${EXPECTED})`);

  if (ids.length === 0) {
    console.log("\nNothing to do — no blank slugs remain. ✓");
    return;
  }

  if (ids.length !== EXPECTED) {
    console.error(
      `\n✋ REFUSING TO RUN: found ${ids.length} blank-slug products but expected ${EXPECTED}.\n` +
        `   Re-verify the data, then re-run with --expect ${ids.length} if the difference is understood.`
    );
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      moderationStatus: true,
      createdAt: true,
      shopId: true,
      shop: { select: { slug: true, name: true, isActive: true } },
      _count: { select: { orders: true, moderationEvents: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Existing slugs per shop, so we never collide on @@unique([shopId, slug]).
  const shopIds = [...new Set(products.map((p) => p.shopId))];
  const siblings = await prisma.product.findMany({
    where: { shopId: { in: shopIds } },
    select: { id: true, shopId: true, slug: true },
  });
  const takenByShop = new Map<string, Set<string>>();
  for (const s of siblings) {
    if (!takenByShop.has(s.shopId)) takenByShop.set(s.shopId, new Set());
    if (s.slug.trim() !== "") takenByShop.get(s.shopId)!.add(s.slug);
  }

  const plan: Array<{ id: string; from: string; to: string }> = [];
  let orderFlags = 0;

  console.log("\n--- PLAN ---");
  for (const p of products) {
    const taken = takenByShop.get(p.shopId) ?? new Set<string>();
    let next = proposeSlug(p.name, p.id);
    let n = 2;
    while (taken.has(next)) next = `${proposeSlug(p.name, p.id)}-${n++}`;
    taken.add(next);
    takenByShop.set(p.shopId, taken);

    if (p._count.orders > 0) orderFlags++;

    console.log(
      [
        `  id=${p.id}`,
        `  title=${JSON.stringify(p.name)}`,
        `  shop=/shop/${p.shop.slug}`,
        `  slug: ${JSON.stringify(p.slug)}  ->  ${JSON.stringify(next)}`,
        `  url:  /shop/${p.shop.slug}/product/${next}`,
        `  active=${p.isActive} moderation=${p.moderationStatus} created=${p.createdAt.toISOString().slice(0, 10)}`,
        `  orders=${p._count.orders} moderationEvents=${p._count.moderationEvents}`,
        "",
      ].join("\n")
    );

    plan.push({ id: p.id, from: p.slug, to: next });
  }

  // Duplicate guard across the plan itself.
  const perShop = new Map<string, Set<string>>();
  for (const p of products) {
    const to = plan.find((x) => x.id === p.id)!.to;
    if (!perShop.has(p.shopId)) perShop.set(p.shopId, new Set());
    if (perShop.get(p.shopId)!.has(to)) {
      console.error(`✋ Duplicate proposed slug "${to}" within shop ${p.shopId}. Aborting.`);
      process.exitCode = 1;
      return;
    }
    perShop.get(p.shopId)!.add(to);
  }
  console.log("Duplicate check: none within any shop ✓");

  if (orderFlags > 0) {
    console.log(
      `\nNOTE: ${orderFlags} target(s) have orders. Orders reference productId, not slug,\n` +
        `      and downloads/checkout are id-based, so a slug change does not affect them.\n` +
        `      Flagged for visibility only.`
    );
  }

  if (!APPLY) {
    console.log(`\nDry run complete. ${plan.length} product(s) would change.`);
    console.log("Re-run with --apply to write. Nothing was modified.\n");
    return;
  }

  console.log("\n--- APPLYING ---");
  await prisma.$transaction(
    plan.map((p) =>
      prisma.product.update({ where: { id: p.id }, data: { slug: p.to } })
    )
  );
  console.log(`Updated ${plan.length} product(s).`);

  const remaining = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Product" WHERE btrim("slug") = ''
  `;
  if (remaining.length !== 0) {
    console.error(`✋ VERIFY FAILED: ${remaining.length} blank slug(s) still present.`);
    process.exitCode = 1;
    return;
  }
  console.log("Verified: zero blank slugs remain ✓");

  console.log("\n--- BEFORE / AFTER ---");
  for (const p of plan) console.log(`  ${p.id}  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
