"use client";

import { useTranslations } from "next-intl";

export function PlatformSection() {
  const t = useTranslations('footer');
  return (
    <section className="py-16 px-4 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold text-center mb-8 text-white">
          {t('tagline')}
        </h2>
      </div>
    </section>
  );
}

