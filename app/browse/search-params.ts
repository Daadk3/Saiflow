import { isProductCategory } from "@/lib/categories";
import type { ProductCategory } from "@/lib/categories";

/**
 * Reading /browse's query string.
 *
 * Next.js passes each search parameter as a string, as an array of strings
 * when the name repeats (`?q=book&q=course`), or as undefined. Every reader
 * here accepts all three. A repeated name follows the rule of
 * `URLSearchParams.get()`: the first value is used and the rest are ignored.
 * The page never writes a repeated parameter itself, so this only meets
 * hand-edited or crafted URLs, which now render instead of failing.
 */
export type SearchParamValue = string | string[] | undefined;

// No popularity sort until real popularity data exists: an option that
// silently fell back to newest would mislead. Unknown values become newest.
export const SORT_OPTIONS = ["newest", "price-asc", "price-desc"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

/** Search text is trimmed and capped; anything longer is a mistake, not a query. */
export const MAX_QUERY_LENGTH = 80;

export interface Filters {
  category?: ProductCategory;
  sort: SortOption;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
}

/** The value a possibly repeated parameter stands for: its first occurrence. */
export function firstParam(raw: SearchParamValue): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseQuery(raw: SearchParamValue): string | undefined {
  const q = firstParam(raw)?.trim().slice(0, MAX_QUERY_LENGTH);
  return q ? q : undefined;
}

export function parsePrice(raw: SearchParamValue): number | undefined {
  const text = firstParam(raw);
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function parseSort(raw: SearchParamValue): SortOption {
  const value = firstParam(raw) ?? "";
  return (SORT_OPTIONS as readonly string[]).includes(value) ? (value as SortOption) : "newest";
}

export function parseCategory(raw: SearchParamValue): ProductCategory | undefined {
  const value = firstParam(raw);
  return isProductCategory(value) ? value : undefined;
}

/** Every filter /browse understands, read from its raw search parameters. */
export function parseFilters(params: Record<string, SearchParamValue>): Filters {
  return {
    category: parseCategory(params.category),
    sort: parseSort(params.sort),
    minPrice: parsePrice(params.minPrice),
    maxPrice: parsePrice(params.maxPrice),
    q: parseQuery(params.q),
  };
}
