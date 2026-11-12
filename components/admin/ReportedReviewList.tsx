import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/formatDate";
import type { ModerationReview } from "@/lib/reviews/store";
import { ReviewStars } from "@/components/product-reviews/ReviewStars";
import { ReviewModerationControls } from "@/components/admin/ReviewModerationControls";

/** The founder's list of reported and hidden buyer reviews. */
export async function ReportedReviewList({
  rows,
  showControls = true,
}: {
  rows: ModerationReview[];
  showControls?: boolean;
}) {
  const t = await getTranslations("reviews");
  const locale = await getLocale();

  if (rows.length === 0) {
    return <p className="mt-8 rounded-xl border border-gray-800 bg-[#111] p-6 text-center text-gray-400">{t("adminEmpty")}</p>;
  }

  return (
    <ul className="mt-6 space-y-4">
      {rows.map((review) => (
        <li key={review.id} className="rounded-2xl border border-gray-800 bg-[#111] p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ReviewStars value={review.stars} label={t("starOption", { n: review.stars })} />
            <span className={review.hidden ? "text-amber-300" : "text-teal-300"}>{review.hidden ? t("hidden") : t("visible")}</span>
            <span className="text-gray-400">{t("buyer", { mask: review.buyer })}</span>
          </div>
          <p className="mt-2 font-medium text-white">
            <bdi>{review.productName}</bdi>
            <span className="text-gray-500"> · </span>
            <bdi className="text-gray-300">{review.shopName}</bdi>
          </p>
          {review.body && (
            <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm text-gray-200 [unicode-bidi:plaintext]">
              {review.body}
            </p>
          )}
          {review.hiddenReason && (
            <p className="mt-3 text-sm text-amber-200/90">
              {t("hideReason")}: {review.hiddenReason}
            </p>
          )}
          {review.reports.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-gray-400">
              {review.reports.map((report) => (
                <li key={report.createdAt}>
                  {t("reportedBySeller")} · {formatDate(report.createdAt, locale)} — {report.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-gray-500">{t("noReport")}</p>
          )}
          {showControls && <ReviewModerationControls reviewId={review.id} hidden={review.hidden} />}
        </li>
      ))}
    </ul>
  );
}
