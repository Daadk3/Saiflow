import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ReportedReviewList } from "@/components/admin/ReportedReviewList";
import { loadReviewModerationQueue } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/** Reported buyer reviews, and reviews a moderator has hidden. Admins only, via the parent layout. */
export default async function AdminReviewsPage() {
  const t = await getTranslations("reviews");
  const rows = await loadReviewModerationQueue();

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/dashboard/admin" className="text-sm text-gray-500 transition-colors hover:text-gray-300">
          {t("adminBack")}
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">{t("adminTitle")}</h1>
        <p className="mt-1 text-sm text-gray-500">{t("adminSubtitle")}</p>
        <ReportedReviewList rows={rows} />
      </main>
    </div>
  );
}
