import Link from "next/link";
import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { formatPrice } from "@/lib/formatPrice";
import { IconBook, IconLink, IconTemplate, IconUpload } from "./icons";

/**
 * The creator side of the proposition, with an illustrative storefront
 * dashboard: a store with its own link, two products with the states the
 * real dashboard uses, and the upload tile. No revenue, no sales counts.
 */
export async function CreatorValue() {
  const t = await getTranslations("home.creator");
  const locale = await getLocale();

  const products = [
    { title: "product1", status: "statusPublished", price: 39, Icon: IconBook, tone: "bg-blue-500/10 text-blue-300", pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    { title: "product2", status: "statusReview", price: 25, Icon: IconTemplate, tone: "bg-orange-500/10 text-orange-300", pill: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  ] as const;

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Dashboard mockup: on wide screens it sits on the start side, the copy on the end side. */}
          <div className="relative order-2 mx-auto w-full max-w-lg lg:order-1 lg:max-w-none" role="img" aria-label={t("mock.ariaLabel")}>
            <div
              aria-hidden="true"
              className="absolute -inset-4 rounded-[36px] bg-gradient-to-tr from-teal-500/15 via-transparent to-orange-500/10 blur-2xl"
            />
            <div className="relative rounded-[28px] border border-gray-800 bg-[#111111] p-5 shadow-2xl shadow-black/60 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Image
                    src="/mascot-tablet.png"
                    alt=""
                    aria-hidden="true"
                    width={44}
                    height={44}
                    className="h-11 w-11 rounded-full bg-gray-900"
                  />
                  <div>
                    <p className="font-semibold text-white">{t("mock.storeName")}</p>
                    <p className="flex items-center gap-1.5 text-xs text-teal-400">
                      <IconLink className="h-3.5 w-3.5" />
                      <span dir="ltr">{t("mock.storeLink")}</span>
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-gray-800 px-2.5 py-1 text-[11px] text-gray-500">
                  {t("mock.illustrative")}
                </span>
              </div>

              <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {t("mock.productsHeading")}
              </p>
              <ul className="space-y-3">
                {products.map(({ title, status, price, Icon, tone, pill }) => (
                  <li
                    key={title}
                    className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-[#0d0d0d] p-3"
                  >
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{t(`mock.${title}`)}</p>
                      <p className="text-sm text-teal-400">
                        <bdi>{formatPrice(price, "SAR", locale)}</bdi>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${pill}`}>
                      {t(`mock.${status}`)}
                    </span>
                  </li>
                ))}
                <li className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-700 p-3 text-gray-400">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-300">
                    <IconUpload className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{t("mock.uploadTitle")}</p>
                    <p className="text-xs text-gray-500">{t("mock.uploadBody")}</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          {/* Copy */}
          <div className="order-1 space-y-6 lg:order-2">
            <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">{t("title")}</h2>
            <p className="max-w-xl text-lg leading-relaxed text-gray-400 sm:text-xl">{t("body")}</p>
            <Link href="/signup" className="btn-primary text-base" aria-label={t("ctaAria")}>
              {t("cta")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
