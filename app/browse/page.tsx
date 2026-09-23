import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SAFE_DELIVERABLE_WHERE } from "@/lib/file-safety";
import { getLocale, getTranslations } from "next-intl/server";
import { CATEGORY_LABEL_KEYS, isProductCategory } from "@/lib/categories";
import type { ProductCategory } from "@/lib/categories";
import { ProductCard } from "@/components/ProductCard";
import type { ProductCardProduct } from "@/components/ProductCard";
import { IconChevronDown, IconSearch, IconStore } from "@/components/home/icons";

export const dynamic = "force-dynamic";

// No popularity sort until real popularity data exists: an option that
// silently fell back to newest would mislead. Unknown values become newest.
const SORT_OPTIONS = ["newest", "price-asc", "price-desc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

/** Search text is trimmed and capped; anything longer is a mistake, not a query. */
const MAX_QUERY_LENGTH = 80;

type Product = ProductCardProduct;

interface Filters {
  category?: ProductCategory;
  sort: SortOption;
  minPrice?: number;
  maxPrice?: number;
  q?: string;
}

async function getProducts(filters: Filters): Promise<Product[]> {
  const { category, sort, minPrice, maxPrice, q } = filters;
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    // Trust & Safety: only approved products are publicly listed
    moderationStatus: "APPROVED",
    // Stage E2: and only those whose attached deliverable would actually pass
    // checkout. Separate requirement from moderation, ANDed with it.
    ...SAFE_DELIVERABLE_WHERE,
  };

  if (isProductCategory(category)) {
    where.category = category;
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.price = {};
    if (minPrice !== undefined) where.price.gte = minPrice;
    if (maxPrice !== undefined) where.price.lte = maxPrice;
  }

  // Search narrows within the gated set: it is ANDed with every rule above.
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const orderBy =
    sort === "price-asc"
      ? { price: "asc" as const }
      : sort === "price-desc"
      ? { price: "desc" as const }
      : { createdAt: "desc" as const }; // newest

  try {
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        price: true,
        currency: true,
        images: true,
        thumbnailUrl: true,
        category: true,
        shop: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      orderBy,
    });

    return products.map((p) => ({
      ...p,
      price: Number(p.price),
    }));
  } catch (error) {
    // Don't let a DB hiccup take down /browse — render the empty state.
    console.error("Browse: failed to load products, rendering without them.", error);
    return [];
  }
}

function parsePrice(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseSort(raw: string | undefined): SortOption {
  return (SORT_OPTIONS as readonly string[]).includes(raw ?? "") ? (raw as SortOption) : "newest";
}

function parseQuery(raw: string | undefined): string | undefined {
  const q = raw?.trim().slice(0, MAX_QUERY_LENGTH);
  return q ? q : undefined;
}

/** A browse URL for the current filters with some of them changed. */
function browseHref(filters: Filters, overrides: Partial<Filters>): string {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.category) params.set("category", next.category);
  if (next.q) params.set("q", next.q);
  if (next.sort !== "newest") params.set("sort", next.sort);
  if (next.minPrice !== undefined) params.set("minPrice", String(next.minPrice));
  if (next.maxPrice !== undefined) params.set("maxPrice", String(next.maxPrice));
  const query = params.toString();
  return query ? `/browse?${query}` : "/browse";
}

interface BrowsePageProps {
  searchParams: Promise<{
    category?: string;
    sort?: string;
    minPrice?: string;
    maxPrice?: string;
    q?: string;
  }>;
}

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const params = await searchParams;
  const filters: Filters = {
    category: isProductCategory(params.category) ? params.category : undefined,
    sort: parseSort(params.sort),
    minPrice: parsePrice(params.minPrice),
    maxPrice: parsePrice(params.maxPrice),
    q: parseQuery(params.q),
  };
  const { category, sort, minPrice, maxPrice, q } = filters;

  const products = await getProducts(filters);
  const locale = await getLocale();
  const t = await getTranslations();
  const categories = Object.entries(CATEGORY_LABEL_KEYS) as [ProductCategory, string][];
  const priceActive = minPrice !== undefined || maxPrice !== undefined;
  const filtersActive = Boolean(category || q || priceActive || sort !== "newest");

  const sortLabels: Record<SortOption, string> = {
    newest: t("products.newest"),
    "price-asc": t("products.priceLow"),
    "price-desc": t("products.priceHigh"),
  };

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
      active
        ? "border-teal-400/60 bg-teal-500/15 text-teal-200"
        : "border-gray-800 bg-[#111111] text-gray-300 hover:border-gray-600 hover:text-white"
    }`;

  const hiddenFilters = (except: "q" | "price") => (
    <>
      {category && <input type="hidden" name="category" value={category} />}
      {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
      {except !== "q" && q && <input type="hidden" name="q" value={q} />}
      {except !== "price" && minPrice !== undefined && <input type="hidden" name="minPrice" value={minPrice} />}
      {except !== "price" && maxPrice !== undefined && <input type="hidden" name="maxPrice" value={maxPrice} />}
    </>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header: heading, search, categories */}
      <section className="relative overflow-hidden border-b border-gray-800">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 start-1/4 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 end-0 h-72 w-72 rounded-full bg-purple-500/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-7xl px-4 pb-5 pt-8 sm:px-6 sm:pb-6 sm:pt-10 lg:px-8">
          <h1 className="text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
            {t("storefront.browse.title")}
          </h1>
          <p className="mt-2 max-w-2xl text-base text-gray-400 sm:text-lg">{t("storefront.browse.subtitle")}</p>

          {/* One component: icon, field and submit share a single pill. The icon sits beside the
              field, not over it, so no global input padding rule can push text under it. */}
          <form method="get" action="/browse" role="search" className="mt-5 max-w-2xl">
            {hiddenFilters("q")}
            <label htmlFor="browse-search" className="sr-only">
              {t("storefront.browse.searchLabel")}
            </label>
            <div className="flex items-center gap-2 rounded-full border border-gray-700 bg-[#111111] p-1.5 ps-4 transition-colors focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500">
              <IconSearch className="h-5 w-5 shrink-0 text-gray-500" />
              <input
                id="browse-search"
                type="search"
                name="q"
                defaultValue={q ?? ""}
                maxLength={MAX_QUERY_LENGTH}
                placeholder={t("storefront.browse.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent py-2 text-base text-white placeholder:text-gray-500 focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-full bg-[#00FFB3] px-4 py-2 text-sm font-semibold text-[#0A1128] transition hover:bg-[#00E6A0]"
              >
                {t("storefront.browse.searchButton")}
              </button>
            </div>
          </form>

          <nav aria-label={t("storefront.browse.categoriesHeading")} className="mt-4 flex flex-wrap gap-1.5">
            <Link href={browseHref(filters, { category: undefined })} className={chip(!category)} aria-current={!category ? "page" : undefined}>
              {t("categories.all")}
            </Link>
            {categories.map(([slug, labelKey]) => (
              <Link
                key={slug}
                href={browseHref(filters, { category: slug })}
                className={chip(category === slug)}
                aria-current={category === slug ? "page" : undefined}
              >
                {t(labelKey)}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* Toolbar and grid */}
      <section className="py-5 sm:py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* One compact toolbar: what is shown, then sort, price and clear. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <p className="text-sm text-gray-400">
              <span className="font-semibold text-white">
                {category ? t(CATEGORY_LABEL_KEYS[category]) : t("products.allProducts")}
              </span>
              <span aria-hidden="true"> · </span>
              {q && <span>{t("storefront.browse.resultsFor", { q })} · </span>}
              {t("storefront.shopView.showingProductsCount", { count: products.length })}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-gray-800 bg-[#111111] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white">
                  <span>
                    {t("storefront.browse.sortLabel")}: <span className="font-semibold text-white">{sortLabels[sort]}</span>
                  </span>
                  <IconChevronDown className="h-4 w-4 text-gray-500" />
                </summary>
                <ul className="mt-2 w-56 rounded-2xl border border-gray-800 bg-[#111111] p-1.5 shadow-xl shadow-black/40 sm:absolute sm:end-0 sm:z-10">
                  {SORT_OPTIONS.map((option) => (
                    <li key={option}>
                      <Link
                        href={browseHref(filters, { sort: option })}
                        aria-current={sort === option ? "true" : undefined}
                        className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                          sort === option ? "bg-gray-800 font-semibold text-white" : "text-gray-300 hover:bg-gray-800/60 hover:text-white"
                        }`}
                      >
                        {sortLabels[option]}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>

              <details className="relative">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-gray-800 bg-[#111111] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-white">
                  <span>{t("storefront.browse.priceLabel")}</span>
                  {priceActive && <span className="text-teal-400">•</span>}
                  <IconChevronDown className="h-4 w-4 text-gray-500" />
                </summary>
                <form
                  method="get"
                  action="/browse"
                  className="mt-2 flex flex-wrap items-end gap-2 rounded-2xl border border-gray-800 bg-[#111111] p-3 shadow-xl shadow-black/40 sm:absolute sm:end-0 sm:z-10 sm:w-80"
                >
                  {hiddenFilters("price")}
                  <input
                    type="number"
                    inputMode="decimal"
                    dir="ltr"
                    name="minPrice"
                    min={0}
                    placeholder={t("products.minPrice")}
                    defaultValue={minPrice ?? ""}
                    aria-label={t("products.minPrice")}
                    className="no-spinner w-24 flex-1 rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    dir="ltr"
                    name="maxPrice"
                    min={0}
                    placeholder={t("products.maxPrice")}
                    defaultValue={maxPrice ?? ""}
                    aria-label={t("products.maxPrice")}
                    className="no-spinner w-24 flex-1 rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                  <button
                    type="submit"
                    className="rounded-full bg-[#00FFB3] px-4 py-2 text-sm font-semibold text-[#0A1128] transition hover:bg-[#00E6A0]"
                  >
                    {t("storefront.browse.applyFilters")}
                  </button>
                </form>
              </details>

              {filtersActive && (
                <Link href="/browse" className="px-1 text-sm font-medium text-teal-400 transition-colors hover:text-teal-300">
                  {t("storefront.browse.clearFilters")}
                </Link>
              )}
            </div>
          </div>

          {products.length > 0 ? (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-4">
              {products.map((product) => (
                <li key={product.id} className="flex">
                  <ProductCard
                    product={product}
                    locale={locale}
                    categoryLabel={isProductCategory(product.category) ? t(CATEGORY_LABEL_KEYS[product.category]) : null}
                    byShopLabel={t("storefront.browse.byShop", { shop: product.shop.name })}
                    viewLabel={t("products.viewProduct")}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-3xl border border-dashed border-gray-800 bg-[#0f0f0f] px-6 py-16 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-300">
                <IconStore className="h-7 w-7" />
              </div>
              <h3 className="text-2xl font-semibold text-white">
                {filtersActive ? t("storefront.browse.emptyFilteredTitle") : t("storefront.browse.emptyTitle")}
              </h3>
              <p className="mx-auto mt-3 max-w-md text-gray-400">
                {filtersActive ? t("storefront.browse.emptyFilteredBody") : t("storefront.browse.emptyBody")}
              </p>
              <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                {filtersActive && (
                  <Link href="/browse" className="btn-secondary">
                    {t("storefront.browse.clearFilters")}
                  </Link>
                )}
                <Link href="/signup" className="btn-primary">
                  {t("storefront.browse.emptyCta")}
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
