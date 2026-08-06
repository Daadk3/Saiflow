import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { getFounderStats } from "@/lib/admin-stats";
import { formatNumber } from "@/lib/formatNumber";
import FirstVisitNote from "@/components/admin/FirstVisitNote";
import MissionMascot from "@/components/admin/MissionMascot";

export const dynamic = "force-dynamic";

/** Rules-based, never AI. Exactly one mission, in strict priority order. */
type MissionKey = "missingFile" | "review" | "pending" | "payments" | "calm";

function pickMission(s: {
  missingFile: unknown[];
  notYetReviewed: number;
  pending: number;
  paymentsEnabled: boolean;
}): MissionKey {
  if (s.missingFile.length > 0) return "missingFile";
  if (s.notYetReviewed > 0) return "review";
  if (s.pending > 0) return "pending";
  if (!s.paymentsEnabled) return "payments";
  return "calm";
}

const MISSION_HREF: Record<MissionKey, string> = {
  missingFile: "/dashboard/admin/products?filter=all",
  review: "/dashboard/admin/products?filter=needs_review",
  pending: "/dashboard/moderation",
  payments: "/dashboard/admin/products",
  calm: "/dashboard/admin/products",
};

export default async function FounderDashboardPage() {
  const t = await getTranslations("admin");
  const locale = await getLocale();
  const stats = await getFounderStats();

  // Payments stay disabled while PRE_LAUNCH_MODE is on. We never compute revenue.
  const paymentsEnabled = process.env.PRE_LAUNCH_MODE === "false";

  const mission = pickMission({
    missingFile: stats.missingFile,
    notYetReviewed: stats.notYetReviewed,
    pending: stats.pending,
    paymentsEnabled,
  });

  const reviewedCount = stats.byStatus.APPROVED - stats.notYetReviewed;
  const reviewTotal = stats.byStatus.APPROVED;
  const reviewPct = reviewTotal > 0 ? Math.round((reviewedCount / reviewTotal) * 100) : 100;

  const n = (v: number) => formatNumber(v, locale);
  const pulseQuiet =
    stats.pulse.newUsers === 0 &&
    stats.pulse.newProducts === 0 &&
    stats.pulse.newShops === 0 &&
    stats.pulse.newReports === 0;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("subtitle")}</p>
        </header>

        <div className="space-y-5">
          <FirstVisitNote />

          {/* 1 — TODAY'S MISSION */}
          <section
            className={`rounded-2xl border p-6 ${
              mission === "calm"
                ? "border-teal-500/25 bg-teal-500/[0.06]"
                : "border-gray-800 bg-[#111]"
            }`}
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gray-500">
              {t("mission.eyebrow")}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {mission === "calm" && <MissionMascot mood="happy" size={56} />}
                <h2 className="text-xl font-semibold leading-snug">
                  {mission === "review"
                    ? t("mission.review", { count: n(stats.notYetReviewed) })
                    : mission === "pending"
                      ? t("mission.pending", { count: n(stats.pending) })
                      : t(`mission.${mission}`)}
                </h2>
              </div>
              <Link
                href={MISSION_HREF[mission]}
                className="rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-400"
              >
                {mission === "calm" ? t("mission.ctaCalm") : t("mission.cta")}
              </Link>
            </div>
          </section>

          {/* 2 — ATTENTION (only when something is broken) */}
          {stats.missingFile.length > 0 && (
            <section className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-red-400">
                {t("attention.eyebrow")}
              </p>
              <ul className="mt-4 space-y-3">
                {stats.missingFile.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/15 bg-[#150f10] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        <bdi>{p.name}</bdi>
                      </p>
                      <p className="mt-0.5 text-sm text-red-300/80">
                        {t("attention.missingFile")}
                      </p>
                    </div>
                    <Link
                      href={`/shop/${p.shopSlug}/product/${p.slug}`}
                      className="shrink-0 rounded-lg border border-red-500/30 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/10"
                    >
                      {t("attention.view")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 3 — MANUAL REVIEW PROGRESS (disappears when complete) */}
          {stats.notYetReviewed > 0 && (
            <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber-400">
                  {t("review.eyebrow")}
                </p>
                <p className="font-mono text-sm tabular-nums text-gray-400">
                  {n(reviewedCount)} / {n(reviewTotal)}
                </p>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-amber-400/80"
                  style={{ width: `${reviewPct}%` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p
                  className="text-sm text-gray-400"
                  title={t("review.tooltip")}
                >
                  {t("review.explain", { count: n(stats.notYetReviewed) })}
                </p>
                <Link
                  href="/dashboard/admin/products?filter=needs_review"
                  className="shrink-0 rounded-lg bg-amber-500/90 px-4 py-2 text-sm font-semibold text-[#161007] transition-colors hover:bg-amber-400"
                >
                  {t("review.cta")}
                </Link>
              </div>
            </section>
          )}

          {/* 4 — PLATFORM PULSE */}
          <section className="rounded-xl border border-gray-800/70 bg-[#0f0f0f] px-5 py-4">
            <p className="text-sm text-gray-400">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gray-600">
                {t("pulse.eyebrow")}
              </span>
              <span className="mx-2 text-gray-700">·</span>
              {pulseQuiet
                ? t("pulse.quiet")
                : [
                    stats.pulse.newUsers > 0 && t("pulse.users", { count: n(stats.pulse.newUsers) }),
                    stats.pulse.newProducts > 0 && t("pulse.products", { count: n(stats.pulse.newProducts) }),
                    stats.pulse.newShops > 0 && t("pulse.shops", { count: n(stats.pulse.newShops) }),
                    stats.pulse.newReports > 0 && t("pulse.reports", { count: n(stats.pulse.newReports) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </p>
          </section>

          {/* 5 — PLATFORM SNAPSHOT (quiet, colourless) */}
          <section>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-gray-600">
              {t("snapshot.eyebrow")}
            </p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["users", stats.users],
                ["creators", stats.creators],
                ["shops", stats.shops],
                ["products", stats.products],
                ["pending", stats.byStatus.PENDING],
                ["approved", stats.byStatus.APPROVED],
                ["rejected", stats.byStatus.REJECTED],
                ["reviewed", reviewedCount],
              ].map(([key, value]) => (
                <div
                  key={key as string}
                  className="rounded-lg border border-gray-800/60 bg-[#0f0f0f] px-3 py-2.5"
                >
                  <dt className="text-[11px] text-gray-500">{t(`snapshot.${key}`)}</dt>
                  <dd className="mt-0.5 font-mono text-lg tabular-nums text-gray-200">
                    {n(value as number)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* 6 — PAYMENTS (never computes revenue) */}
          <section className="rounded-xl border border-gray-800/70 bg-[#0f0f0f] px-5 py-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gray-600">
              {t("payments.eyebrow")}
            </p>
            <p className="mt-2 text-sm text-gray-300">{t("payments.disabled")}</p>
            <div className="mt-3 flex gap-6 text-sm">
              <span className="text-gray-500">
                {t("payments.revenue")} <span className="text-gray-400">—</span>
              </span>
              <span className="text-gray-500">
                {t("payments.liveOrders")} <span className="text-gray-400">—</span>
              </span>
            </div>
            {stats.testOrders > 0 && (
              <p className="mt-3 text-xs text-gray-600">
                {t("payments.testNote", { count: n(stats.testOrders) })}
              </p>
            )}
          </section>

          {/* 7 — QUICK ACTIONS (exactly three) */}
          <nav className="flex flex-wrap gap-2 pt-1">
            <Link
              href="/dashboard/admin/products?filter=needs_review"
              className="rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
            >
              {t("actions.startReview")}
            </Link>
            <Link
              href="/dashboard/admin/products"
              className="rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
            >
              {t("actions.products")}
            </Link>
            <Link
              href="/dashboard/moderation"
              className="rounded-lg border border-gray-800 bg-[#111] px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-700 hover:text-white"
            >
              {t("actions.queue")}
            </Link>
          </nav>
        </div>
      </main>
    </div>
  );
}
