import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProductReviewSection, ReviewAverageLine } from "@/components/product-reviews/ProductReviewSection";
import { ReviewForm } from "@/components/product-reviews/ReviewForm";
import { ReportedReviewList } from "@/components/admin/ReportedReviewList";
import type { ModerationReview, PublicReviewSummary } from "@/lib/reviews/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  title: "Review preview",
};

/**
 * Local screenshots only. Stays a 404 unless REVIEW_FIXTURE_PREVIEW=1, and
 * the rows below are fixture data, not the database.
 */
const SUMMARY: PublicReviewSummary = {
  average: 4.7,
  count: 3,
  truncated: false,
  reviews: [
    {
      id: "rev_fixture_1",
      stars: 5,
      body: "منتج واضح ومفيد. استلمته مباشرة بعد الدفع، والشرح مرتب.",
      buyer: "س•••",
      createdAt: "2026-11-01T10:00:00.000Z",
    },
    {
      id: "rev_fixture_2",
      stars: 4,
      body: "جيد جدًا. التنزيل كان سريعًا والملف كما وُصف.",
      buyer: "م•••",
      createdAt: "2026-10-20T10:00:00.000Z",
    },
    {
      id: "rev_fixture_3",
      stars: 5,
      body: "أنصح به لمن يبدأ بيع المنتجات الرقمية.",
      buyer: "ن•••",
      createdAt: "2026-10-02T10:00:00.000Z",
    },
  ],
};

const QUEUE: ModerationReview[] = [
  {
    id: "rev_fixture_reported",
    stars: 1,
    body: "لم يعجبني الترتيب.",
    buyer: "أ•••",
    hidden: false,
    hiddenReason: null,
    productName: "دليل بيع المنتجات الرقمية",
    shopName: "متجر سيف",
    reports: [{ reason: "لا يصف المنتج، ويبدو إساءة للمتجر.", createdAt: "2026-11-08T12:00:00.000Z" }],
  },
  {
    id: "rev_fixture_hidden",
    stars: 2,
    body: "مراجعة مخفية عن صفحة المنتج.",
    buyer: "ل•••",
    hidden: true,
    hiddenReason: "لا تتعلق بالمنتج الذي اشتراه.",
    productName: "دليل بيع المنتجات الرقمية",
    shopName: "متجر سيف",
    reports: [{ reason: "خارج الموضوع.", createdAt: "2026-11-05T12:00:00.000Z" }],
  },
];

export default async function ReviewPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.REVIEW_FIXTURE_PREVIEW !== "1") notFound();
  const view = (await searchParams).view ?? "product";
  const buy = await getTranslations("products");

  if (view === "form") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <main className="mx-auto max-w-lg px-4 py-12">
          <ReviewForm
            productId="prod_fixture"
            productName="دليل بيع المنتجات الرقمية"
            token="fixture-token-not-a-real-purchase"
            initialStars={null}
            initialBody={null}
            hidden={false}
          />
        </main>
      </div>
    );
  }

  if (view === "admin") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white">
        <main className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold">{(await getTranslations("reviews"))("adminTitle")}</h1>
          <p className="mt-1 text-sm text-gray-500">{(await getTranslations("reviews"))("adminSubtitle")}</p>
          <ReportedReviewList rows={QUEUE} showControls />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-teal-500/10 text-teal-200">
              <span className="text-lg font-semibold">دليل بيع المنتجات الرقمية</span>
            </div>
            <h1 className="mt-8 text-3xl font-bold sm:text-4xl">
              <bdi>دليل بيع المنتجات الرقمية</bdi>
            </h1>
            <p className="mt-2 text-sm text-gray-400">
              <bdi>متجر سيف</bdi>
            </p>
            <p dir="auto" className="mt-6 whitespace-pre-wrap text-gray-300 [unicode-bidi:plaintext]">
              دليل عملي لبائعي المنتجات الرقمية: صفحة المنتج، الدفع، وتسليم الملف بعد الشراء.
            </p>
            <ProductReviewSection summary={SUMMARY} canReport={false} />
          </div>
          <aside>
            <div className="rounded-2xl border border-gray-800 bg-[#111111] p-6 lg:sticky lg:top-24">
              <p className="text-4xl font-bold">
                <bdi>٤٩٫٠٠ ر.س</bdi>
              </p>
              <ReviewAverageLine summary={SUMMARY} />
              <button type="button" className="mt-6 w-full rounded-xl bg-teal-500 py-3 font-semibold text-white">
                {buy("buyNow")}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
