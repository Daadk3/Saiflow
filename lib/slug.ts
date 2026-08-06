/**
 * Shared slug generation for shops and products.
 *
 * Latin names produce readable slugs ("My eBook" -> "my-ebook").
 * Non-Latin names (e.g. Arabic, the primary market) would previously
 * collapse to an empty string and collide on the unique slug index —
 * they now fall back to a short random handle so creation never fails.
 */
export function slugify(name: string, prefix = "item"): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  if (base.length >= 2) return base;
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
