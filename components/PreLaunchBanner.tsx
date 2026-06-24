import { env } from "@/lib/env";
import { getTranslations } from "next-intl/server";

export default async function PreLaunchBanner() {
  if (!env.PRE_LAUNCH_MODE) return null;

  const t = await getTranslations("preLaunch");

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-[#0f0f0f] border-b border-gray-800 px-4 py-3 text-center text-sm text-gray-300"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        <svg
          className="w-4 h-4 text-gray-400 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{t("banner")}</span>
      </div>
    </div>
  );
}
