"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

export default function PricingPage() {
  const t = useTranslations("pricing");
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    { question: t("faq.q1"), answer: t("faq.a1") },
    { question: t("faq.q2"), answer: t("faq.a2") },
    { question: t("faq.q3"), answer: t("faq.a3") },
    { question: t("faq.q4"), answer: t("faq.a4") },
    { question: t("faq.q5"), answer: t("faq.a5") },
    { question: t("faq.q6"), answer: t("faq.a6") },
  ];

  const features = [
    t("tiers.feature1"),
    t("tiers.feature2"),
    t("tiers.feature3"),
    t("tiers.feature4"),
    t("tiers.feature5"),
    t("tiers.feature6"),
    t("tiers.feature7"),
    t("tiers.feature8"),
  ];

  return (
    <div className="pt-16">
      {/* Hero Section */}
      <section className="pt-16 pb-16 sm:pt-24 sm:pb-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 mb-6">
            <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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

      {/* Pricing Card */}
      <section className="py-12 px-4">
        <div className="max-w-lg mx-auto">
          {/* Card with glow effect */}
          <div className="relative group">
            {/* Glow background */}
            <div className="absolute -inset-1 bg-gradient-to-r from-teal-500 to-cyan-500 rounded-3xl blur-lg opacity-25 group-hover:opacity-40 transition-opacity duration-500"></div>

            {/* Card */}
            <div className="relative bg-[#111111] rounded-3xl border border-teal-500/30 p-8 sm:p-10">
              {/* Header */}
              <div className="text-center mb-8">
                <span className="inline-block px-4 py-1 bg-teal-500/10 text-teal-400 text-sm font-medium rounded-full mb-4">
                  {t("tiers.badge")}
                </span>
                <h2 className="text-2xl font-bold text-white mb-2">{t("tiers.name")}</h2>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-5xl sm:text-6xl font-extrabold text-white">{t("tiers.rate")}</span>
                  <span className="text-xl text-gray-400">{t("tiers.ratePeriod")}</span>
                </div>
                <p className="mt-2 text-gray-500">{t("tiers.rateNote")}</p>
              </div>

              {/* Features */}
              <ul className="space-y-4 mb-8">
                {features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-gray-300">{feature}</span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <Link
                href="/signup"
                className="btn-primary block w-full py-4 px-6 rounded-xl text-center"
              >
                {t("tiers.cta")}
              </Link>
              <p className="mt-4 text-center text-sm text-gray-500">
                {t("tiers.ctaNote")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Section */}
      <section className="py-20 sm:py-28 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              {t("comparison.heading")}
            </h2>
            <p className="text-gray-400">
              {t("comparison.subheading")}
            </p>
          </div>

          {/* Comparison Table */}
          <div className="bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-start py-5 px-6 text-gray-400 font-medium">{t("comparison.headerFeature")}</th>
                  <th className="text-center py-5 px-6">
                    <span className="inline-flex items-center gap-2 text-teal-400 font-semibold">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                      </svg>
                      {t("comparison.headerYou")}
                    </span>
                  </th>
                  <th className="text-center py-5 px-6 text-gray-400 font-medium">{t("comparison.headerThem")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">{t("comparison.rowMonthlyFee")}</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      {t("comparison.saiflowFree")}
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  {/* Competitor pricing in their actual currency — deliberately not localized */}
                  <td className="py-5 px-6 text-center text-gray-500">$29-99/mo</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">{t("comparison.rowTransactionFee")}</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      {t("comparison.saiflowRate")}
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">{t("comparison.themTransaction")}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">{t("comparison.rowSetupTime")}</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      {t("comparison.saiflowFast")}
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">{t("comparison.themSlow")}</td>
                </tr>
                <tr className="border-b border-white/5">
                  <td className="py-5 px-6 text-gray-300">{t("comparison.rowPayoutSpeed")}</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      {t("comparison.saiflowInstant")}
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">{t("comparison.themPayout")}</td>
                </tr>
                <tr>
                  <td className="py-5 px-6 text-gray-300">{t("comparison.rowHiddenCosts")}</td>
                  <td className="py-5 px-6 text-center">
                    <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                      {t("comparison.saiflowNone")}
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </td>
                  <td className="py-5 px-6 text-center text-gray-500">{t("comparison.themHidden")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 sm:py-28 px-4 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              {t("faq.heading")}
            </h2>
            <p className="text-gray-400">
              {t("faq.subheading")}
            </p>
          </div>

          {/* FAQ Accordion */}
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="bg-[#1A1A1A] rounded-2xl border border-white/10 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-6 text-start"
                >
                  <span className="text-white font-medium pe-4">{faq.question}</span>
                  <svg
                    className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
                      openFaq === index ? "rotate-180" : ""
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === index && (
                  <div className="px-6 pb-6">
                    <p className="text-gray-400 leading-relaxed">{faq.answer}</p>
                  </div>
                )}
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
