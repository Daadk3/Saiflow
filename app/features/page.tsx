"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function FeaturesPage() {
  const t = useTranslations("features");

  const chips = t.raw("chips") as string[];
  const checkoutItems = t.raw("cards.checkout.items") as string[];
  const payoutsItems = t.raw("cards.payouts.items") as string[];
  const deliveryItems = t.raw("cards.delivery.items") as string[];
  const noFeesItems = t.raw("cards.noFees.items") as string[];

  const miniFeatures = [
    { icon: "🔗", key: "customLinks" },
    { icon: "📧", key: "emailReceipts" },
    { icon: "🇸🇦", key: "localPayments" },
    { icon: "📱", key: "mobileReady" },
    { icon: "🎨", key: "customBranding" },
    { icon: "📊", key: "analytics" },
    { icon: "💬", key: "support" },
  ] as const;

  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-16 sm:pt-24 sm:pb-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 mb-6">
            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-teal-400 text-sm font-medium">{t("hero.eyebrow")}</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.1]">
            {t("hero.title")}
          </h1>

          {/* Subheadline */}
          <p className="mt-6 text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            {t("hero.subtitle")}
          </p>
        </div>
      </section>

      {/* Features Bento Grid */}
      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

            {/* Feature 1: Sell Anything (Large) */}
            <div className="md:col-span-2 bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-teal-500/50 transition-all duration-300 group hover:shadow-xl hover:shadow-teal-500/5">
              <div className="flex flex-col lg:flex-row gap-8">
                <div className="flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-teal-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    {/* Package Icon */}
                    <svg className="w-7 h-7 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{t("cards.sellAnything.title")}</h3>
                  <p className="text-gray-400 leading-relaxed mb-6">
                    {t("cards.sellAnything.description")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {chips.map((item) => (
                      <span key={item} className="px-3 py-1.5 bg-white/5 rounded-full text-sm text-gray-300 font-medium border border-white/10">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                {/* Upload Icon Illustration */}
                <div className="lg:w-64 h-48 lg:h-auto bg-gradient-to-br from-teal-900/30 to-cyan-900/20 rounded-2xl flex items-center justify-center border border-teal-500/20">
                  <div className="text-center">
                    {/* Upload Cloud Icon */}
                    <svg className="w-20 h-20 text-teal-400/70 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-teal-400/60 text-sm mt-2">{t("cards.sellAnything.imageLabel")}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 2: Simple Checkout */}
            <div className="bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-purple-500/50 transition-all duration-300 group hover:shadow-xl hover:shadow-purple-500/5">
              <div className="w-14 h-14 rounded-2xl bg-purple-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                {/* CreditCard Icon */}
                <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{t("cards.checkout.title")}</h3>
              <p className="text-gray-400 leading-relaxed mb-6">
                {t("cards.checkout.description")}
              </p>
              <ul className="space-y-2">
                {checkoutItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-300 text-sm">
                    <svg className="w-4 h-4 text-purple-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Feature 3: Instant Payouts */}
            <div className="bg-gradient-to-br from-green-900/50 to-emerald-900/30 rounded-3xl p-8 border border-green-500/30 hover:border-green-500/50 transition-all duration-300 group hover:shadow-xl hover:shadow-green-500/5">
              <div className="w-14 h-14 rounded-2xl bg-green-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                {/* Zap Icon */}
                <svg className="w-7 h-7 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{t("cards.payouts.title")}</h3>
              <p className="text-gray-400 leading-relaxed mb-6">
                {t("cards.payouts.description")}
              </p>
              <ul className="space-y-2">
                {payoutsItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-green-100/80 text-sm">
                    <svg className="w-4 h-4 text-green-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Feature 4: Secure Delivery */}
            <div className="bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-blue-500/50 transition-all duration-300 group hover:shadow-xl hover:shadow-blue-500/5">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                {/* Shield Icon */}
                <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{t("cards.delivery.title")}</h3>
              <p className="text-gray-400 leading-relaxed mb-6">
                {t("cards.delivery.description")}
              </p>
              <ul className="space-y-2">
                {deliveryItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-gray-300 text-sm">
                    <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Feature 5: Sales Dashboard (Large) */}
            <div className="md:col-span-2 bg-[#1A1A1A] rounded-3xl p-8 border border-white/10 hover:border-orange-500/50 transition-all duration-300 group hover:shadow-xl hover:shadow-orange-500/5">
              <div className="flex flex-col lg:flex-row gap-8">
                <div className="flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-orange-500/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    {/* BarChart Icon */}
                    <svg className="w-7 h-7 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-3">{t("cards.dashboard.title")}</h3>
                  <p className="text-gray-400 leading-relaxed mb-6">
                    {t("cards.dashboard.description")}
                  </p>
                </div>
                {/* Mini chart */}
                <div className="lg:w-64 h-48 lg:h-auto bg-gradient-to-br from-orange-900/20 to-red-900/10 rounded-2xl flex items-end justify-center p-6 border border-orange-500/20">
                  <div className="flex items-end gap-2 w-full h-32">
                    {[40, 65, 45, 80, 55, 90, 70, 85].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-gradient-to-t from-orange-500 to-orange-400 rounded-t-lg transition-all hover:from-orange-400 hover:to-orange-300"
                        style={{ height: `${h}%` }}
                      ></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Feature 6: No Monthly Fees */}
            <div className="bg-gradient-to-br from-teal-900 to-teal-800 rounded-3xl p-8 border border-teal-500/30 hover:border-teal-400/50 transition-all duration-300 group hover:shadow-xl hover:shadow-teal-500/10">
              <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                {/* DollarSign Icon */}
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">{t("cards.noFees.title")}</h3>
              <p className="text-teal-100/70 leading-relaxed mb-6">
                {t("cards.noFees.description")}
              </p>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-extrabold text-white">{t("cards.noFees.rate")}</span>
                <span className="text-teal-200/60">{t("cards.noFees.ratePeriod")}</span>
              </div>
              <ul className="space-y-2">
                {noFeesItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-teal-100/80 text-sm">
                    <svg className="w-4 h-4 text-teal-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* Additional Features Grid */}
      <section className="py-16 sm:py-24 px-4 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              {t("moreHeading")}
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {t("moreSubheading")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {miniFeatures.map((feature) => (
              <div
                key={feature.key}
                className="p-6 bg-[#1A1A1A] rounded-2xl border border-white/10 hover:border-white/20 transition-all duration-300 hover:translate-y-[-2px]"
              >
                <span className="text-3xl mb-4 block">{feature.icon}</span>
                <h3 className="text-lg font-semibold text-white mb-1">{t(`more.${feature.key}.title`)}</h3>
                <p className="text-gray-500 text-sm">{t(`more.${feature.key}.description`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-32 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">
            {t("cta.title")}
          </h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
            {t("cta.subtitle")}
          </p>
          <Link
            href="/signup"
            className="btn-primary text-lg px-10 py-5"
          >
            {t("cta.primary")}
            <svg className="w-5 h-5 rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            {t("cta.note")}
          </p>
        </div>
      </section>
    </div>
  );
}
