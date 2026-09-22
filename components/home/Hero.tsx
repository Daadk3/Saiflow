import Link from "next/link";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";
import { IconArrow, IconBook, IconCheck, IconDownload } from "./icons";

/**
 * The hero. The copy carries the proposition; the panel beside it shows the
 * SaiFlow journey in one glance: a creator's store, one digital product,
 * payment done, file downloaded. It is deliberately not a storefront: no
 * named store, one product, one price, and a caption that says it is an
 * illustration, so nothing here can be mistaken for live marketplace data.
 */
export async function Hero() {
  const t = await getTranslations("home.hero");
  const locale = await getLocale();

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 start-0 h-[28rem] w-[28rem] rounded-full bg-teal-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 end-0 h-96 w-96 rounded-full bg-purple-500/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-20 lg:px-8 lg:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
          {/* Proposition */}
          <div className="space-y-7">
            <h1 className="text-4xl font-bold leading-[1.2] text-white sm:text-5xl lg:text-6xl">
              {t("title")}
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-gray-400 sm:text-xl">{t("subtitle")}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className="btn-primary text-base" aria-label={t("primaryAria")}>
                {t("primaryCta")}
              </Link>
              <Link href="/browse" className="btn-secondary text-base" aria-label={t("secondaryAria")}>
                {t("secondaryCta")}
              </Link>
            </div>
            <p className="text-sm text-gray-500">{t("trustLine")}</p>
          </div>

          {/* The journey: creator and product, paid, downloaded */}
          <div className="relative mx-auto w-full max-w-md" role="img" aria-label={t("mock.ariaLabel")}>
            <div
              aria-hidden="true"
              className="absolute -inset-4 rounded-[36px] bg-gradient-to-br from-teal-500/20 via-transparent to-purple-500/15 blur-2xl"
            />
            <div className="relative rounded-[28px] border border-gray-800 bg-[#111111] p-5 shadow-2xl shadow-black/60 sm:p-6">
              {/* Creator identity, generic on purpose */}
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Image
                    src="/mascot.png"
                    alt=""
                    aria-hidden="true"
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full bg-gray-900"
                  />
                  <div>
                    <p className="text-sm font-semibold text-white">{t("mock.storeLabel")}</p>
                    <p className="text-xs text-gray-500">{t("mock.storeRole")}</p>
                  </div>
                </div>
                <span className="rounded-full border border-gray-800 px-2.5 py-1 text-[11px] text-gray-500">
                  {t("mock.illustrative")}
                </span>
              </div>

              {/* One product */}
              <div className="rounded-2xl border border-gray-800 bg-[#0d0d0d] p-4">
                <div className="mb-4 flex h-40 items-center justify-center rounded-xl border border-blue-500/30 bg-gradient-to-br from-blue-500/30 to-blue-900/10 text-blue-200">
                  <IconBook className="h-12 w-12" />
                </div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{t("mock.productKind")}</p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="text-base font-semibold text-white">{t("mock.productTitle")}</p>
                  <p className="shrink-0 text-base font-bold text-teal-400">
                    <bdi>{formatPrice(49, "SAR", locale)}</bdi>
                  </p>
                </div>
              </div>

              {/* Paid, then download */}
              <div className="mt-4 flex items-center justify-center gap-3 rounded-2xl border border-gray-800 bg-[#0d0d0d] px-4 py-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-semibold text-emerald-300">
                  <IconCheck className="h-4 w-4" />
                  {t("mock.paidState")}
                </span>
                <IconArrow className="h-5 w-5 shrink-0 text-gray-600 rtl:-scale-x-100" />
                <span className="inline-flex items-center gap-2 rounded-full bg-[#00FFB3] px-3 py-1.5 text-sm font-semibold text-[#0A1128] shadow-[0_4px_12px_rgba(0,255,179,0.3)]">
                  <IconDownload className="h-4 w-4" />
                  {t("mock.downloadState")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
