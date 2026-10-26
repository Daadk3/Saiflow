import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { getStoresDirectory, STORES_PAGE_SIZE } from "@/lib/admin-stores";
import { formatDate } from "@/lib/formatDate";
import {
  STORE_COUNTRIES,
  UNKNOWN_COUNTRY_FILTER,
  countryOptionLabel,
  parseCountryFilter,
} from "@/lib/store-location";

export const dynamic = "force-dynamic";

function storesHref(params: { q?: string; country?: string }): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.country) search.set("country", params.country);
  const query = search.toString();
  return query ? `/dashboard/admin/stores?${query}` : "/dashboard/admin/stores";
}

/**
 * Every store on SaiFlow, newest first. Admin-only through the admin layout.
 * The store's public page is linked only while the store is active; its
 * owners' emails are here so the founder can reach them.
 */
export default async function AdminStoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const sp = await searchParams;
  const rawQ = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = rawQ?.trim().slice(0, 100) || undefined;
  const rawCountry = Array.isArray(sp.country) ? sp.country[0] : sp.country;
  const country = parseCountryFilter(rawCountry);
  const { rows, total, byCountry } = await getStoresDirectory({ q, country });
  const directoryTotal = byCountry.reduce((sum, row) => sum + row.count, 0);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link href="/dashboard/admin" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("stores.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("stores.subtitle")}</p>
        </header>

        <section className="mb-5">
          <h2 className="mb-2 text-sm font-medium text-gray-300">{t("stores.byCountry")}</h2>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={storesHref({ q })}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  country
                    ? "border-gray-800 bg-[#111] text-gray-300 hover:border-gray-600"
                    : "border-teal-500 bg-teal-500/10 text-teal-300"
                }`}
              >
                {t("stores.countryAll")}
                <span className="tabular-nums text-gray-500">{directoryTotal}</span>
              </Link>
            </li>
            {byCountry.map((row) => {
              const value = row.country ?? UNKNOWN_COUNTRY_FILTER;
              const active = country === value;
              return (
                <li key={value}>
                  <Link
                    href={storesHref({ q, country: value })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-teal-500 bg-teal-500/10 text-teal-300"
                        : "border-gray-800 bg-[#111] text-gray-300 hover:border-gray-600"
                    }`}
                  >
                    <bdi>{row.country ? countryOptionLabel(row.country) : t("stores.unknown")}</bdi>
                    <span className="tabular-nums text-gray-500">{row.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <form method="get" className="mb-5 flex flex-wrap gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            maxLength={100}
            placeholder={t("stores.search")}
            className="w-full max-w-xs rounded-lg border border-gray-800 bg-[#111] px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-teal-500 focus:outline-none"
          />
          <select
            name="country"
            defaultValue={country ?? ""}
            aria-label={t("stores.countryFilter")}
            className="max-w-full rounded-lg border border-gray-800 bg-[#111] px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          >
            <option value="">{t("stores.countryAll")}</option>
            <option value={UNKNOWN_COUNTRY_FILTER}>{t("stores.unknown")}</option>
            {STORE_COUNTRIES.map((code) => (
              <option key={code} value={code}>
                {countryOptionLabel(code)}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 hover:text-white">
            {t("stores.searchButton")}
          </button>
        </form>

        <p className="mb-3 font-mono text-xs text-gray-500">
          {t("stores.count", { count: total })}
          {total > rows.length && ` · ${t("stores.showingFirst", { count: STORES_PAGE_SIZE })}`}
        </p>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-6 text-center text-gray-500">{t("stores.empty")}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((store) => (
              <li key={store.id} className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-gray-100">
                      {store.isActive ? (
                        <Link href={`/shop/${encodeURIComponent(store.slug)}`} className="hover:text-teal-400 hover:underline underline-offset-4">
                          <bdi>{store.name}</bdi>
                        </Link>
                      ) : (
                        <bdi>{store.name}</bdi>
                      )}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-gray-500" dir="ltr">/shop/{store.slug}</p>
                  </div>
                  <span
                    className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      store.isActive ? "bg-green-500/10 text-green-400" : "bg-gray-500/10 text-gray-400"
                    }`}
                  >
                    {store.isActive ? t("stores.active") : t("stores.suspended")}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                  <div className="col-span-2">
                    <dt className="text-xs text-gray-500">{t("stores.owner")}</dt>
                    <dd className="text-gray-300">
                      {store.owners.length === 0
                        ? "—"
                        : store.owners.map((owner) => (
                            <span key={owner.email} className="block truncate">
                              <bdi>{owner.name || "—"}</bdi>{" "}
                              <a href={`mailto:${owner.email}`} className="text-teal-400 hover:underline" dir="ltr">
                                {owner.email}
                              </a>
                            </span>
                          ))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t("stores.country")}</dt>
                    <dd className="text-gray-300">
                      {store.country ? <bdi>{countryOptionLabel(store.country)}</bdi> : t("stores.unknown")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t("stores.city")}</dt>
                    <dd className="text-gray-300">{store.city ? <bdi>{store.city}</bdi> : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t("stores.products")}</dt>
                    <dd className="tabular-nums text-gray-300">
                      {t("stores.productCounts", { total: store.products, live: store.live })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">{t("stores.created")}</dt>
                    <dd className="text-gray-300">{formatDate(store.createdAt.toISOString(), locale)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
