"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Shown on a seller's dashboard only when that store's sales are on.
 * Payouts stay manual. The IBAN line appears only when none is saved.
 */
export function ManualPayoutNote({
  missingIban,
  settingsHref,
}: {
  missingIban: boolean;
  settingsHref: string;
}) {
  const t = useTranslations("dashboard.manualPayouts");
  return (
    <div role="note" className="mb-6 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 text-start">
      <p className="text-sm leading-relaxed text-gray-200">{t("note")}</p>
      {missingIban && (
        <p className="mt-1 text-sm leading-relaxed text-gray-300">
          {t("missingIban")}{" "}
          <Link href={settingsHref} className="text-teal-300 underline underline-offset-4">
            {t("settings")}
          </Link>
        </p>
      )}
    </div>
  );
}
