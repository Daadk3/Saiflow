"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function SupportSuccessPage() {
  const t = useTranslations("support.success");
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 shadow-2xl shadow-black/50 p-8 text-center">
            {/* Checkmark Icon */}
            <div className="w-16 h-16 bg-teal-500/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-teal-500/10">
              <svg
                className="w-8 h-8 text-teal-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            
            {/* Headline */}
            <h1 className="text-2xl font-bold text-white mb-2">
              {t("heading")}
            </h1>

            {/* Subtext */}
            <p className="text-gray-400 mb-8">
              {t("subtitle")}
            </p>

            {/* Buttons */}
            <div className="space-y-4">
              <Link
                href="/"
                className="block w-full bg-teal-500 hover:bg-teal-400 text-black font-semibold px-6 py-3 rounded-xl transition-colors shadow-lg shadow-teal-500/25"
              >
                {t("backToHome")}
              </Link>

              <Link
                href="/support"
                className="block text-teal-400 hover:text-teal-300 font-medium transition-colors"
              >
                {t("sendAnother")}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
