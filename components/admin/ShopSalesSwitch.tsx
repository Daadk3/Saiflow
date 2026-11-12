"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Founder-only control for one store's sales switch.
 *
 * The admin layout already refuses anyone who is not an admin. This posts
 * to the sales route, which checks isAdminEmail again and writes the audit
 * row. It never approves a product.
 */
export function ShopSalesSwitch({ shopId, enabled }: { shopId: string; enabled: boolean }) {
  const t = useTranslations("admin.stores");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/admin/shops/${encodeURIComponent(shopId)}/sales`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${
          enabled ? "bg-teal-500/10 text-teal-300" : "bg-amber-500/10 text-amber-300"
        }`}
      >
        {enabled ? t("salesOn") : t("salesOff")}
      </span>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className="rounded-lg border border-gray-700 bg-[#111] px-3 py-1.5 text-xs text-gray-200 hover:border-teal-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? t("salesSaving") : enabled ? t("turnSalesOff") : t("turnSalesOn")}
      </button>
      <p className="max-w-xs text-end text-[11px] leading-snug text-gray-500">{t("salesHelp")}</p>
      {error && <p className="text-[11px] text-red-400">{t("salesError")}</p>}
    </div>
  );
}
