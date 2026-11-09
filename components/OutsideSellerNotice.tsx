"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { shouldShowOutsideSellerNotice } from "@/lib/outside-seller-notice";

/**
 * Calm note for people opening a store or preparing a product.
 *
 * Informational only: this component renders no button, no field, and no
 * `disabled` state. Creating a store and uploading a file stay available.
 */
export function OutsideSellerNotice() {
  const t = useTranslations("outsideSeller");
  const { data: session, status } = useSession();
  if (!shouldShowOutsideSellerNotice(status, session?.user?.isAdmin)) return null;

  return (
    <div
      role="note"
      className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 text-start"
    >
      <div className="flex items-start gap-3">
        <svg
          className="mt-0.5 h-5 w-5 shrink-0 text-teal-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="min-w-0 text-sm leading-relaxed text-gray-300">{t("notice")}</p>
      </div>
    </div>
  );
}
