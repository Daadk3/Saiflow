import Link from "next/link";
import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import {
  getProductsDirectory,
  isValidCursor,
  DIRECTORY_FILTERS,
  DIRECTORY_SORTS,
  type DirectoryFilter,
  type DirectorySort,
} from "@/lib/admin-stats";
import type { ModeratorFileSafety } from "@/lib/moderator-file-status";
import { formatPrice } from "@/lib/formatPrice";
import { formatDate } from "@/lib/formatDate";
import ReviewButton from "@/components/admin/ReviewButton";

export const dynamic = "force-dynamic";

/** Every query param is allowlisted — unknown values fall back, never pass through. */
function parseParams(sp: Record<string, string | string[] | undefined>) {
  const raw = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);

  const filter = DIRECTORY_FILTERS.includes(raw("filter") as DirectoryFilter)
    ? (raw("filter") as DirectoryFilter)
    : "needs_review"; // default: why the founder is here
  const sort = DIRECTORY_SORTS.includes(raw("sort") as DirectorySort)
    ? (raw("sort") as DirectorySort)
    : "createdAt";
  const dir = raw("dir") === "asc" ? "asc" : "desc";
  const cursorRaw = raw("cursor");
  const cursor = cursorRaw && isValidCursor(cursorRaw) ? cursorRaw : undefined;
  const q = raw("q")?.trim().slice(0, 100) || undefined;

  return { filter, sort, dir: dir as "asc" | "desc", cursor, q };
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const sp = await searchParams;
  const { filter, sort, dir, cursor, q } = parseParams(sp);
  const { rows, nextCursor, totalForFilter } = await getProductsDirectory({
    filter,
    sort,
    dir,
    cursor,
    q,
  });

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { filter, sort, dir, q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    return `?${p.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href="/dashboard/admin"
            className="text-sm text-gray-500 transition-colors hover:text-gray-300"
          >
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            {t("directory.title")}
          </h1>
        </header>

        {/* Filters + search */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {DIRECTORY_FILTERS.map((f) => (
            <Link
              key={f}
              href={qs({ filter: f, cursor: undefined })}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                f === filter
                  ? "border-teal-500 bg-teal-500/10 font-medium text-teal-300"
                  : "border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
              }`}
            >
              {t(`directory.filters.${f}`)}
            </Link>
          ))}
          <form className="ms-auto flex gap-2" action="/dashboard/admin/products">
            <input type="hidden" name="filter" value={filter} />
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder={t("directory.searchPlaceholder")}
              maxLength={100}
              className="w-52 rounded-lg border border-gray-800 bg-[#0f0f0f] px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:border-teal-500 focus:outline-none"
            />
            <button className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:border-gray-700">
              {t("directory.search")}
            </button>
          </form>
        </div>

        <p
          className={`mb-3 text-xs text-gray-600 ${
            locale.startsWith("ar") ? "" : "font-mono"
          }`}
        >
          {t("directory.count", { count: String(totalForFilter) })}
        </p>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-10 text-center">
            <p className="text-gray-400">{t("directory.empty")}</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto rounded-xl border border-gray-800 md:block">
              <table className="w-full text-sm">
                <thead className="bg-[#111] text-start">
                  <tr
                    className={`text-[11px] text-gray-500 ${
                      locale.startsWith("ar") ? "" : "uppercase tracking-wider"
                    }`}
                  >
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.product")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.shop")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.category")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.price")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.status")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.reviewSource")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.reports")}</th>
                    <th className="px-3 py-3 text-start font-medium">{t("directory.col.created")}</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-t border-gray-800/70 align-middle">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-gray-800 bg-[#1a1a1a]">
                            {p.thumbnailUrl && (
                              <Image
                                src={p.thumbnailUrl}
                                alt=""
                                width={36}
                                height={36}
                                className="h-full w-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-gray-100">
                              <bdi>{p.name}</bdi>
                            </p>
                            <p className="truncate text-xs text-gray-500">
                              <bdi>{p.creatorName}</bdi>
                              {!p.hasFile && (
                                <span className="ms-2 text-red-400">
                                  {t("directory.noFile")}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-gray-400"><bdi>{p.shopName}</bdi></td>
                      <td className="px-3 py-3 text-gray-500">{p.category ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-3 tabular-nums text-gray-300">
                        <bdi>{formatPrice(p.price, p.currency, locale)}</bdi>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={p.moderationStatus} t={t} />
                          <FileSafetyBadge safety={p.fileSafety} t={t} />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <ReviewSourceBadge reviewed={p.humanReviewed} t={t} />
                      </td>
                      <td className="px-3 py-3 tabular-nums text-gray-500">{p.reportCount}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-gray-500">
                        {formatDate(p.createdAt, locale, { day: "2-digit", month: "2-digit", year: "numeric" })}
                      </td>
                      <td className="px-3 py-3 text-end">
                        {!p.humanReviewed && (
                          <ReviewButton
                            productId={p.id}
                            productName={p.name}
                            previewHref={`/dashboard/admin/products/${p.id}/preview`}
                            fileHref={p.canInspect ? `/api/admin/inspect/${p.id}` : null}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {rows.map((p) => (
                <div key={p.id} className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-gray-800 bg-[#1a1a1a]">
                      {p.thumbnailUrl && (
                        <Image
                          src={p.thumbnailUrl}
                          alt=""
                          width={44}
                          height={44}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium"><bdi>{p.name}</bdi></p>
                      <p className="truncate text-xs text-gray-500">
                        <bdi>{p.shopName}</bdi> · <bdi>{formatPrice(p.price, p.currency, locale)}</bdi>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={p.moderationStatus} t={t} />
                        <FileSafetyBadge safety={p.fileSafety} t={t} />
                        <ReviewSourceBadge reviewed={p.humanReviewed} t={t} />
                        {!p.hasFile && (
                          <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">
                            {t("directory.noFile")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  {!p.humanReviewed && (
                    <div className="mt-3 flex justify-end">
                      <ReviewButton
                        productId={p.id}
                        productName={p.name}
                        previewHref={`/dashboard/admin/products/${p.id}/preview`}
                        fileHref={p.canInspect ? `/api/admin/inspect/${p.id}` : null}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {nextCursor && (
          <div className="mt-6 flex justify-center">
            <Link
              href={qs({ cursor: nextCursor })}
              className="rounded-lg border border-gray-800 px-4 py-2 text-sm text-gray-300 hover:border-gray-700"
            >
              {t("directory.next")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({
  status,
  t,
}: {
  status: "PENDING" | "APPROVED" | "REJECTED";
  t: (k: string) => string;
}) {
  const cls =
    status === "APPROVED"
      ? "bg-green-500/10 text-green-400"
      : status === "PENDING"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-red-500/10 text-red-400";
  return (
    <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {t(`directory.status.${status}`)}
    </span>
  );
}

/**
 * The moderator-facing scan state, beside the moderation state rather than
 * merged into it.
 *
 * They are separate questions and stay separate controls: nothing here
 * disables approve or reject. What it does is stop a moderator approving a
 * product and expecting it on the storefront when the file has not passed —
 * the detail view spells that out, and this is the at-a-glance version.
 *
 * `missing_file_key` renders nothing, because the row already carries the
 * "Missing file" badge and `hasFile` is now true under exactly the opposite
 * condition. Two badges saying "no file" is noise, not emphasis.
 */
function FileSafetyBadge({
  safety,
  t,
}: {
  safety: ModeratorFileSafety;
  t: (k: string) => string;
}) {
  if (safety.reason === "missing_file_key") return null;

  const cls = {
    ok: "bg-green-500/10 text-green-400",
    waiting: "bg-blue-500/10 text-blue-300",
    attention: "bg-amber-500/10 text-amber-400",
    blocked: "bg-red-500/10 text-red-400",
  }[safety.tone];

  return (
    <span
      title={
        safety.publishable
          ? t("fileSafety.publishable")
          : t("fileSafety.notPublishable")
      }
      className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {t(`fileSafety.reason.${safety.reason}`)}
    </span>
  );
}

function ReviewSourceBadge({
  reviewed,
  t,
}: {
  reviewed: boolean;
  t: (k: string) => string;
}) {
  return reviewed ? (
    <span className="whitespace-nowrap rounded-md bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-300">
      {t("directory.humanReviewed")}
    </span>
  ) : (
    <span
      title={t("review.tooltip")}
      className="whitespace-nowrap rounded-md bg-gray-500/10 px-2 py-0.5 text-[11px] font-medium text-gray-400"
    >
      {t("directory.notYetReviewed")}
    </span>
  );
}
