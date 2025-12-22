"use client";

import Link from "next/link";
import { useLanguage } from "@/contexts/LanguageContext";

const categories = [
  { key: "ebooksGuides", slug: "ebooks", icon: "📘" },
  { key: "onlineCourses", slug: "courses", icon: "🎥" },
  { key: "templatesThemes", slug: "templates", icon: "🧩" },
  { key: "musicAudio", slug: "music", icon: "🎵" },
  { key: "artGraphics", slug: "art", icon: "🎨" },
  { key: "softwareApps", slug: "software", icon: "💻" },
];

export function CategoriesSection() {
  const { t } = useLanguage();
  
  return (
    <section className="py-16 sm:py-20 px-4 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              {t('categories.digitalProducts')}
            </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/browse?category=${category.slug}`}
              className="group rounded-xl border border-gray-800 bg-[#111111] p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md hover:border-gray-700"
            >
              <div className="flex items-start gap-4">
                <div
                  className={[
                    "w-14 h-14 rounded-xl flex items-center justify-center shadow-lg transform transition-transform duration-200",
                    "group-hover:scale-105",
                    category.slug === "ebooks" && "bg-gradient-to-br from-blue-500 to-blue-600",
                    category.slug === "courses" && "bg-gradient-to-br from-purple-500 to-purple-600",
                    category.slug === "templates" && "bg-gradient-to-br from-pink-500 to-rose-600",
                    category.slug === "music" && "bg-gradient-to-br from-orange-500 to-amber-600",
                    category.slug === "art" && "bg-gradient-to-br from-red-500 to-orange-600",
                    category.slug === "software" && "bg-gradient-to-br from-teal-500 to-emerald-600",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="text-white text-2xl leading-none">{category.icon}</span>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-white">
                    {t(`categories.${category.key}`)}
                  </h3>
                </div>
              </div>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-teal-400">
                {t('common.viewAll')}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
