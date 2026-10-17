import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { RECEIPT_LINK_TTL_DAYS } from "@/lib/download-links";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Where an expired download link lands (app/api/download). The buyer did
 * nothing wrong, so this explains how to download again instead of showing
 * an error: sign in with the address they bought with and open My purchases.
 */
export default async function DownloadExpiredPage() {
  const t = await getTranslations("downloadExpired");
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-16 text-white">
      <main className="w-full max-w-lg rounded-2xl border border-gray-800 bg-[#111111] p-8 text-center">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-3 text-gray-400">{t("body", { days: RECEIPT_LINK_TTL_DAYS })}</p>
        <ol className="mt-6 space-y-2 text-start text-sm text-gray-300">
          <li>1. {t("step1")}</li>
          <li>2. {t("step2")}</li>
        </ol>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/login?callbackUrl=/dashboard/purchases"
            className="rounded-lg bg-teal-500 px-5 py-2.5 font-medium text-white hover:bg-teal-400"
          >
            {t("signIn")}
          </Link>
          <Link
            href="/signup"
            className="rounded-lg border border-gray-700 px-5 py-2.5 font-medium text-gray-200 hover:border-gray-500"
          >
            {t("signUp")}
          </Link>
        </div>
        <p className="mt-6 text-xs text-gray-500">
          {t("support")}{" "}
          <a href="mailto:support@saiflow.io" className="text-teal-400 hover:underline" dir="ltr">
            support@saiflow.io
          </a>
        </p>
      </main>
    </div>
  );
}
