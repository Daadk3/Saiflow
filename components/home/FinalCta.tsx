import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { IconArrow, IconStore } from "./icons";

export async function FinalCta() {
  const t = await getTranslations("home.finalCta");

  return (
    <section className="pb-24 pt-8 sm:pb-32 sm:pt-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="mb-10 text-center text-3xl font-bold text-white sm:text-4xl lg:text-5xl">{t("title")}</h2>
        <div className="grid gap-5 md:grid-cols-2">
          {/* Creator side */}
          <div className="relative overflow-hidden rounded-3xl border border-teal-500/30 bg-gradient-to-br from-teal-500/15 via-[#111111] to-[#111111] p-8 sm:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-teal-500/20 blur-3xl"
            />
            <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300">
              <IconStore className="h-6 w-6" />
            </span>
            <h3 className="text-2xl font-bold text-white sm:text-3xl">{t("creatorTitle")}</h3>
            <Link href="/signup" className="btn-primary mt-7 text-base">
              {t("creatorCta")}
            </Link>
          </div>

          {/* Buyer side */}
          <div className="relative overflow-hidden rounded-3xl border border-gray-800 bg-[#111111] p-8 sm:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-purple-500/15 blur-3xl"
            />
            <span className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/15 text-purple-300">
              <IconArrow className="h-6 w-6 rtl:-scale-x-100" />
            </span>
            <h3 className="text-2xl font-bold text-white sm:text-3xl">{t("buyerTitle")}</h3>
            <Link href="/browse" className="btn-secondary mt-7 text-base">
              {t("buyerCta")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
