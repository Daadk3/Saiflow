"use client";

import Link from "next/link";
import Image from "next/image";
import { useTranslations } from "next-intl";

export function HeroSection() {
  const t = useTranslations();
  const secondary = t("hero.secondary");
  return (
    <section className="relative overflow-hidden bg-transparent">
      {/* Additional subtle background shapes for hero section */}
      <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-teal-500/8 blur-3xl pointer-events-none" />
      <div className="absolute top-10 right-10 h-64 w-64 rounded-full bg-cyan-500/8 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-120px] left-1/2 -translate-x-1/2 h-72 w-72 rounded-full bg-teal-500/5 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 lg:pt-28 lg:pb-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left */}
          <div className="space-y-6">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight">
              {t('hero.title')}
            </h1>
            {secondary && (
              <p className="text-sm sm:text-base font-medium tracking-wide text-gray-500">
                {secondary}
              </p>
            )}
            <p className="text-lg sm:text-xl text-gray-400 max-w-xl">
              {t('hero.subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/signup"
                className="btn-primary"
                aria-label="Start selling digital products - Sign up for free"
              >
                {t('hero.cta')}
              </Link>
              <Link
                href="/browse"
                className="btn-secondary"
                aria-label="Browse all digital products"
              >
                {t('hero.browse')}
              </Link>
            </div>
          </div>

          {/* Right visuals */}
          <div className="relative">
            <div className="absolute -inset-6 rounded-[32px] bg-gradient-to-br from-teal-500/20 via-transparent to-cyan-500/10 blur-2xl" />
            <div className="relative rounded-[28px] border border-gray-800 bg-[#111111] shadow-xl shadow-black/40 p-6">
              {/* Mock header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Image src="/mascot.png" alt="Saiflow mascot logo in shop preview" width={40} height={40} className="h-10 w-10" />
                  <div>
                    <p className="text-sm text-gray-400">متجر Saiflow</p>
                    <p className="text-base font-semibold text-white">متجر صانع محتوى</p>
                  </div>
                </div>
                <span className="rounded-full bg-teal-500/10 text-teal-400 text-sm font-semibold px-3 py-1">
                  مباشر
                </span>
              </div>

              {/* Floating product mockups */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: "حزمة كورسات", price: "٤٩٩ ر.س", color: "from-teal-500/90 to-emerald-500/80" },
                  { title: "حزمة كتب", price: "١٤٩ ر.س", color: "from-sky-500/90 to-blue-500/80" },
                  { title: "قوالب تصميم", price: "٢٤٩ ر.س", color: "from-amber-500/90 to-orange-500/80" },
                  { title: "حزمة فلاتر", price: "٧٩ ر.س", color: "from-purple-500/90 to-indigo-500/80" },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-gray-800 bg-[#111111] p-4 shadow-sm hover:shadow-lg hover:border-gray-700 transition"
                  >
                    <div
                      className={`h-20 rounded-xl bg-gradient-to-br ${item.color} flex items-center justify-center text-white font-semibold text-lg mb-3`}
                    >
                      {item.title}
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-400">
                      <span>{item.price}</span>
                      <span className="flex items-center gap-1 text-teal-600 font-semibold">
                        اشترِ
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0-4 4m4-4H3" />
                        </svg>
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Bottom stat */}
              <div className="mt-6 flex items-center justify-between rounded-xl border border-gray-800 bg-[#111111] px-4 py-3">
                <div>
                  <p className="text-sm text-gray-400">آخر عملية بيع</p>
                  <p className="text-base font-semibold text-white">+١٤٩ ر.س من نورة</p>
                </div>
                <span className="text-sm font-semibold text-teal-400 bg-teal-500/10 px-3 py-1 rounded-full">
                  قبل دقيقتين
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
