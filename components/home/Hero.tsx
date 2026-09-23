import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * The hero. Text-led on purpose: the headline carries the proposition, the
 * copy explains the two sides, the two CTAs are the two paths, and the trust
 * line closes it. No illustration, no mock product, nothing that could read
 * as marketplace data. The two-path cards directly below are the visual.
 */
export async function Hero() {
  const t = await getTranslations("home.hero");

  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-1/2 h-[30rem] w-[42rem] -translate-x-1/2 rounded-full bg-teal-500/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 end-0 h-80 w-80 rounded-full bg-purple-500/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-16 sm:px-6 sm:pb-16 sm:pt-24 lg:px-8 lg:pt-28">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <h1 className="text-4xl font-bold leading-[1.2] text-white sm:text-5xl lg:text-6xl">{t("title")}</h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-400 sm:text-xl">{t("subtitle")}</p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
            <Link href="/signup" className="btn-primary text-base" aria-label={t("primaryAria")}>
              {t("primaryCta")}
            </Link>
            <Link href="/browse" className="btn-secondary text-base" aria-label={t("secondaryAria")}>
              {t("secondaryCta")}
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-500">{t("trustLine")}</p>
        </div>
      </div>
    </section>
  );
}
