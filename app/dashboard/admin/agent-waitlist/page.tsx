import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/formatDate";
import { AGENT_WAITLIST_PAGE_SIZE, agentLabel, parsePage } from "@/lib/agent-waitlist";

export const dynamic = "force-dynamic";

function pageHref(page: number): string {
  return page > 1 ? `/dashboard/admin/agent-waitlist?page=${page}` : "/dashboard/admin/agent-waitlist";
}

/**
 * People who asked to hear when an /agents kit launches, newest first.
 * Admin-only through the admin layout. Read-only: nothing here emails anyone.
 */
export default async function AdminAgentWaitlistPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const sp = await searchParams;
  const page = parsePage(sp.page);

  const [total, rows] = await Promise.all([
    prisma.agentWaitlist.count(),
    prisma.agentWaitlist.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * AGENT_WAITLIST_PAGE_SIZE,
      take: AGENT_WAITLIST_PAGE_SIZE,
      select: { id: true, email: true, agentSlug: true, locale: true, createdAt: true },
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / AGENT_WAITLIST_PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link href="/dashboard/admin" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
            ← {t("title")}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">{t("agentWaitlist.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("agentWaitlist.subtitle")}</p>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-xs text-gray-500">{t("agentWaitlist.count", { count: total })}</p>
          {total > 0 ? (
            <a
              href="/api/admin/agent-waitlist"
              className="rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
            >
              {t("agentWaitlist.export")}
            </a>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-6 text-center text-gray-500">
            {t("agentWaitlist.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-start text-sm">
              <thead className="bg-[#111] text-xs text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("agentWaitlist.email")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("agentWaitlist.agent")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("agentWaitlist.language")}</th>
                  <th scope="col" className="px-4 py-3 text-start font-medium">{t("agentWaitlist.date")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 bg-[#0f0f0f]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-mono text-xs text-gray-200" dir="ltr">
                      <bdi>{row.email}</bdi>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      <bdi>{agentLabel(row.agentSlug, locale)}</bdi>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.locale === "en" ? t("agentWaitlist.english") : t("agentWaitlist.arabic")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-400">
                      {formatDate(row.createdAt.toISOString(), locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label={t("agentWaitlist.pages")}>
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="text-gray-400 hover:text-white">
                {t("agentWaitlist.newer")}
              </Link>
            ) : (
              <span />
            )}
            <span className="font-mono text-xs text-gray-500">{t("agentWaitlist.pageOf", { page, pages })}</span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="text-gray-400 hover:text-white">
                {t("agentWaitlist.older")}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </main>
    </div>
  );
}
