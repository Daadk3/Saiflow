import Link from "next/link";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

/**
 * The hero. The copy carries the proposition, the two CTAs are the two
 * paths, and the trust line closes it. Beside the copy stands the ghost:
 * SaiFlow's personality, a decorative supporting illustration and never
 * the logo or marketplace data. No mock product, price or store.
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

      <div className="relative mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-16 lg:px-8 lg:pt-24">
        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          {/* Proposition: first on wide screens, under the ghost on narrow ones */}
          <div className="order-2 flex flex-col items-center text-center lg:order-1 lg:items-start lg:text-start">
            <h1 className="text-balance text-4xl font-bold leading-[1.2] text-white sm:text-5xl xl:text-6xl">{t("title")}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-gray-400 sm:text-xl lg:max-w-xl">{t("subtitle")}</p>
            <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/signup" className="btn-primary text-base" aria-label={t("primaryAria")}>
                {t("primaryCta")}
              </Link>
              <Link href="/browse" className="btn-secondary text-base" aria-label={t("secondaryAria")}>
                {t("secondaryCta")}
              </Link>
            </div>
            <p className="mt-6 text-sm text-gray-500">{t("trustLine")}</p>
          </div>

          {/* The ghost: personality beside the copy, decorative only */}
          <div className="relative order-1 mx-auto w-28 sm:w-36 lg:order-2 lg:w-72 xl:w-80">
            <div aria-hidden="true" className="absolute inset-[15%] rounded-full bg-teal-400/20 blur-3xl" />
            <Image
              src="/mascot-headphones.png"
              alt=""
              aria-hidden="true"
              width={320}
              height={320}
              priority
              className="relative h-auto w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
