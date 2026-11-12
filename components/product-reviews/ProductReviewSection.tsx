import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/formatDate";
import { formatNumber } from "@/lib/formatNumber";
import type { PublicReviewSummary } from "@/lib/reviews/store";
import { ReviewStars } from "@/components/product-reviews/ReviewStars";
import { ReportReviewButton } from "@/components/product-reviews/ReportReviewButton";

/**
 * Visible reviews on a product page. Renders nothing when there are none:
 * no empty stars, no placeholder average.
 */
export async function ProductReviewSection({
  summary,
  canReport,
}: {
  summary: PublicReviewSummary;
  canReport: boolean;
}) {
  if (summary.count === 0 || summary.average === null) return null;
  const t = await getTranslations("reviews");
  const locale = await getLocale();
  const shown = formatNumber(summary.average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <section className="mt-12" aria-labelledby="product-reviews-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="product-reviews-heading" className="text-lg font-semibold text-white">
          {t("title")}
        </h2>
        <p className="text-sm text-gray-300">
          <ReviewStars value={summary.average} label={t("averageLabel", { average: shown })} />
          <span className="ms-2 font-semibold text-white">{shown}</span>
          <span className="text-gray-500"> · {t("count", { count: summary.count })}</span>
        </p>
      </div>
      {summary.truncated && (
        <p className="mt-2 text-xs text-gray-500">{t("showingLatest", { count: summary.reviews.length })}</p>
      )}
      <ul className="mt-4 space-y-3">
        {summary.reviews.map((review) => (
          <li key={review.id} className="rounded-xl border border-gray-800 bg-[#111111] p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <ReviewStars value={review.stars} label={t("starOption", { n: review.stars })} />
              <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-300">
                {t("verified")}
              </span>
              <span className="text-gray-400">{t("buyer", { mask: review.buyer })}</span>
              <time className="text-xs text-gray-500" dateTime={review.createdAt}>
                {formatDate(review.createdAt, locale)}
              </time>
            </div>
            {review.body && (
              <p dir="auto" className="mt-3 whitespace-pre-wrap text-start text-sm leading-relaxed text-gray-200 [unicode-bidi:plaintext]">
                {review.body}
              </p>
            )}
            {canReport && (
              <div className="mt-3">
                <ReportReviewButton reviewId={review.id} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The one-line average for the purchase card. Nothing when there are no reviews. */
export async function ReviewAverageLine({ summary }: { summary: PublicReviewSummary }) {
  if (summary.count === 0 || summary.average === null) return null;
  const t = await getTranslations("reviews");
  const locale = await getLocale();
  const shown = formatNumber(summary.average, locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <p className="mt-3 text-sm text-gray-300">
      <ReviewStars value={summary.average} label={t("averageLabel", { average: shown })} />
      <span className="ms-2 font-semibold text-white">{shown}</span>
      <span className="text-gray-500"> · {t("count", { count: summary.count })}</span>
    </p>
  );
}
