/**
 * Shared slug generation for shops and products.
 *
 * Latin names produce readable slugs ("My eBook" -> "my-ebook").
 * Non-Latin names (e.g. Arabic, the primary market) would previously
 * collapse to an empty string and collide on the unique slug index —
 * they now fall back to a short random handle so creation never fails.
 */
export function slugify(name: string, prefix = "item", suffix?: string): string {
  const base = slugBase(name);
  if (base.length >= 2) return base;

  // `suffix` makes the fallback deterministic — the one-off slug backfill
  // passes a stable value derived from the product id so re-running it
  // produces the same handle. Runtime callers omit it and get a random one.
  return `${prefix}-${suffix ?? Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The Latin-only portion of a slug. Returns "" when a name has no usable
 * Latin/digit characters (e.g. a purely Arabic title) — callers decide the
 * fallback. Exported so the backfill script applies identical base rules.
 */
export function slugBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
