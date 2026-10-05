import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  IconArrow,
  IconBook,
  IconPalette,
  IconPlay,
  IconSearch,
  IconStore,
  IconTag,
  IconTemplate,
  IconUpload,
} from "./icons";

/**
 * The two-path choice under the hero: sell, or buy. Each card is one link.
 * The illustrations are decorative and text-free, built from icons and
 * neutral bars, so nothing in them can read as a real store or listing.
 */
function SellerIllustration() {
  return (
    <div aria-hidden="true" className="relative h-44 overflow-hidden rounded-2xl border border-teal-500/20 bg-[#0d0d0d] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/20 text-teal-300">
          <IconStore className="h-5 w-5" />
        </span>
        <div className="space-y-1.5">
          <div className="h-2 w-24 rounded bg-gray-700" />
          <div className="h-2 w-14 rounded bg-gray-800" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-teal-500/40 bg-teal-500/5 p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          <IconUpload className="h-5 w-5" />
        </span>
        <div className="flex-1 space-y-1.5">
          <div className="h-2 w-3/4 rounded bg-gray-700" />
          <div className="h-2 w-1/2 rounded bg-gray-800" />
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00FFB3] text-[#0A1128]">
          <IconTag className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-2 w-20 rounded bg-gray-800" />
        <div className="h-2 w-10 rounded bg-gray-800" />
      </div>
    </div>
  );
}

function BuyerIllustration() {
  const tiles = [
    { Icon: IconBook, tone: "border-blue-500/30 from-blue-500/30 to-blue-900/10 text-blue-200" },
    { Icon: IconPlay, tone: "border-purple-500/30 from-purple-500/30 to-purple-900/10 text-purple-200" },
    { Icon: IconTemplate, tone: "border-orange-500/30 from-orange-500/30 to-orange-900/10 text-orange-200" },
    { Icon: IconPalette, tone: "border-pink-500/30 from-pink-500/30 to-pink-900/10 text-pink-200" },
  ];
  return (
    <div aria-hidden="true" className="relative h-44 overflow-hidden rounded-2xl border border-purple-500/20 bg-[#0d0d0d] p-4">
      <div className="flex items-center gap-2 rounded-full border border-gray-800 bg-[#111111] px-3 py-2 text-gray-500">
        <IconSearch className="h-4 w-4" />
        <div className="h-2 w-32 rounded bg-gray-800" />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {tiles.map(({ Icon, tone }, i) => (
          <div key={i} className={`flex h-16 items-center justify-center rounded-xl border bg-gradient-to-br ${tone}`}>
            <Icon className="h-6 w-6" />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {tiles.map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-2 w-full rounded bg-gray-700" />
            <div className="h-2 w-1/2 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    </div>
  );
}

export async function TwoPaths() {
  const t = await getTranslations("home.paths");

  return (
    <section className="py-8 sm:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="mb-8 text-center text-3xl font-bold leading-tight text-white sm:mb-10 sm:text-4xl">{t("title")}</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {/* Seller path */}
          <Link
            href="/signup"
            className="group relative flex flex-col overflow-hidden rounded-3xl border border-teal-500/30 bg-gradient-to-br from-teal-500/10 via-[#111111] to-[#111111] p-6 transition hover:-translate-y-1 hover:border-teal-400/60 hover:shadow-2xl hover:shadow-teal-500/10 sm:p-8"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-teal-500/20 blur-3xl"
            />
            <SellerIllustration />
            <h3 className="mt-6 text-2xl font-bold text-white sm:text-3xl">{t("sell.title")}</h3>
            <p className="mt-3 text-base leading-relaxed text-gray-400 sm:text-lg">{t("sell.body")}</p>
            <span className="btn-primary mt-7 w-fit text-base">
              {t("sell.cta")}
              <IconArrow className="h-4 w-4 rtl:-scale-x-100" />
            </span>
          </Link>

          {/* Buyer path */}
          <Link
            href="/browse"
            className="group relative flex flex-col overflow-hidden rounded-3xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 via-[#111111] to-[#111111] p-6 transition hover:-translate-y-1 hover:border-purple-400/60 hover:shadow-2xl hover:shadow-purple-500/10 sm:p-8"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl"
            />
            <BuyerIllustration />
            <h3 className="mt-6 text-2xl font-bold text-white sm:text-3xl">{t("buy.title")}</h3>
            <p className="mt-3 text-base leading-relaxed text-gray-400 sm:text-lg">{t("buy.body")}</p>
            <span className="mt-7 inline-flex w-fit items-center gap-2 rounded-full border border-purple-400/40 bg-purple-500/15 px-6 py-3 text-base font-semibold text-purple-100 transition group-hover:bg-purple-500/25">
              {t("buy.cta")}
              <IconArrow className="h-4 w-4 rtl:-scale-x-100" />
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
