import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";
import { IconArrow, IconCheck, IconDownload, IconLock, IconPlay } from "./icons";

/**
 * The buyer side: product, payment, payment confirmed, file download. The
 * four states are illustrative UI, laid out in reading order and stacked on
 * small screens. The connector arrows flip with the writing direction.
 */
export async function BuyerFlow() {
  const t = await getTranslations("home.buyer");
  const locale = await getLocale();
  const price = formatPrice(149, "SAR", locale);
  const digits = new Intl.NumberFormat(locale);
  const caption = (step: number, label: string) => `${digits.format(step)} · ${label}`;

  const connector = (
    <li aria-hidden="true" className="flex items-center justify-center text-gray-700">
      <IconArrow className="h-6 w-6 rotate-90 sm:rotate-0 sm:rtl:-scale-x-100" />
    </li>
  );

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">{t("title")}</h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-400 sm:text-xl">{t("body")}</p>
          <Link href="/browse" className="btn-primary mt-8 text-base">
            {t("cta")}
          </Link>
        </div>

        <ol
          aria-label={t("flowAria")}
          className="mt-14 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:gap-2"
        >
          {/* 1. Product */}
          <li className="rounded-2xl border border-gray-800 bg-[#111111] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{caption(1, t("stepProduct"))}</p>
            <div className="mb-3 flex h-20 items-center justify-center rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/30 to-purple-900/10 text-purple-200">
              <IconPlay className="h-8 w-8" />
            </div>
            <p className="line-clamp-1 text-sm font-semibold text-white">{t("mockProduct")}</p>
            <p className="mt-1 text-sm font-bold text-teal-400">
              <bdi>{price}</bdi>
            </p>
          </li>
          {connector}

          {/* 2. Payment */}
          <li className="rounded-2xl border border-gray-800 bg-[#111111] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{caption(2, t("stepPayment"))}</p>
            <div className="space-y-2 rounded-xl border border-gray-800 bg-[#0d0d0d] p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{t("mockTotal")}</span>
                <span className="font-semibold text-white">
                  <bdi>{price}</bdi>
                </span>
              </div>
              <div className="h-2 rounded bg-gray-800" aria-hidden="true" />
              <div className="h-2 w-2/3 rounded bg-gray-800" aria-hidden="true" />
            </div>
            <div className="mt-3 flex items-center justify-center gap-2 rounded-full bg-[#00FFB3] px-3 py-2 text-sm font-semibold text-[#0A1128]">
              <IconLock className="h-4 w-4" />
              {t("mockPay")}
            </div>
          </li>
          {connector}

          {/* 3. Payment confirmed */}
          <li className="flex flex-col rounded-2xl border border-emerald-500/30 bg-[#0f1a15] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{caption(3, t("stepConfirmed"))}</p>
            <div className="flex flex-1 flex-col items-center justify-center py-2">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                <IconCheck className="h-8 w-8" />
              </span>
            </div>
          </li>
          {connector}

          {/* 4. Download */}
          <li className="flex flex-col rounded-2xl border border-teal-500/30 bg-[#0d1a18] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{caption(4, t("stepDownload"))}</p>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-teal-500/40 bg-teal-500/15 px-4 py-2 text-sm font-semibold text-teal-200">
                <IconDownload className="h-4 w-4" />
                {t("stepDownload")}
              </span>
              <p className="text-center text-xs text-gray-400">{t("mockReady")}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
