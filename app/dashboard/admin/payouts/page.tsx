"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatPrice } from "@/lib/formatPrice";
import { formatDate } from "@/lib/formatDate";

/**
 * Seller payouts, for SaiFlow's admins (the admin layout enforces that).
 *
 * The admin sends each transfer from the bank, then records it here. The
 * form sends back the amount and order count the admin saw; the server
 * recomputes both from the orders and refuses if anything changed, so a
 * recorded payout always matches exactly the orders it marks as paid.
 *
 * Before paying, check Geidea for refunds and chargebacks on these orders:
 * refunds are not recorded on orders yet (see lib/payouts).
 */

interface ShopOwed {
  shopId: string;
  name: string;
  slug: string;
  owed: { amount: string; currency: string; orderCount: number; unreadable: number };
  oldestOrderAt: string;
  account: {
    holderName: string;
    iban: string;
    ibanMasked: string;
    bankName: string | null;
    updatedAt: string;
    changedRecently: boolean;
  } | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function RecordPayout({ shop, onRecorded }: { shop: ShopOwed; onRecorded: () => void }) {
  const t = useTranslations("adminPayouts");
  const locale = useLocale();
  const [bankReference, setBankReference] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shop.shopId,
          expectedAmount: shop.owed.amount,
          expectedOrderCount: shop.owed.orderCount,
          bankReference,
          paidAt: new Date(`${paidOn}T12:00:00Z`).toISOString(),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body && typeof body.error === "string" ? body.error : "";
        setError(
          code === "balance_changed"
            ? t("errors.balanceChanged")
            : code === "no_payout_account"
              ? t("errors.noAccount")
              : code === "invalid_bank_reference"
                ? t("errors.reference")
                : code === "invalid_paid_at"
                  ? t("errors.date")
                  : t("errors.generic")
        );
        return;
      }
      onRecorded();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 border-t border-gray-800 pt-4">
      <label className="block text-sm text-gray-300">
        {t("bankReference")}
        <input
          value={bankReference}
          onChange={(e) => setBankReference(e.target.value)}
          maxLength={100}
          required
          dir="ltr"
          className="mt-1 w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-white"
        />
      </label>
      <label className="block text-sm text-gray-300">
        {t("paidOn")}
        <input
          type="date"
          value={paidOn}
          max={today()}
          onChange={(e) => setPaidOn(e.target.value)}
          required
          className="mt-1 rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-white"
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-300">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
        <span>
          {t("confirm", {
            amount: formatPrice(Number(shop.owed.amount), shop.owed.currency, locale),
            last4: shop.account?.iban.slice(-4) ?? "",
          })}
        </span>
      </label>
      {error && <p role="alert" className="text-sm text-amber-400">{error}</p>}
      <button
        type="submit"
        disabled={!confirmed || busy || bankReference.trim().length < 3}
        className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-white hover:bg-teal-400 disabled:opacity-50"
      >
        {busy ? t("recording") : t("record")}
      </button>
    </form>
  );
}

export default function AdminPayoutsPage() {
  const t = useTranslations("adminPayouts");
  const locale = useLocale();
  const [shops, setShops] = useState<ShopOwed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [recordedName, setRecordedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payouts");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(t("errors.load"));
        return;
      }
      setShops((body as { shops: ShopOwed[] }).shops);
    } catch {
      setError(t("errors.load"));
    }
  }, [t]);

  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(kickoff);
  }, [load]);

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href="/dashboard/admin" className="text-sm text-gray-400 hover:text-teal-400">
          {t("back")}
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-white">{t("heading")}</h1>
        <p className="mt-1 text-gray-500">{t("subtitle")}</p>
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-3 text-sm text-amber-300">{t("refundWarning")}</p>
        {recordedName && <p role="status" className="mt-4 text-sm text-teal-400">{t("recorded", { name: recordedName })}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-amber-400">{error}</p>}
        {shops === null && !error && <p className="mt-6 text-gray-500">{t("loading")}</p>}
        {shops !== null && shops.length === 0 && <p className="mt-6 text-gray-400">{t("nothingOwed")}</p>}

        <ul className="mt-6 space-y-4">
          {(shops ?? []).map((shop) => (
            <li key={shop.shopId} className="rounded-2xl border border-gray-800 bg-[#111111] p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-white">{shop.name}</h2>
                <p className="text-xl font-bold text-white">
                  <bdi>{formatPrice(Number(shop.owed.amount), shop.owed.currency, locale)}</bdi>
                </p>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {t("ordersSince", { count: shop.owed.orderCount, date: formatDate(shop.oldestOrderAt, locale) })}
              </p>
              {shop.owed.unreadable > 0 && <p className="mt-1 text-sm text-amber-400">{t("unreadable", { count: shop.owed.unreadable })}</p>}
              {shop.account ? (
                <div className="mt-3 space-y-1 text-sm">
                  <p className="text-gray-300">{shop.account.holderName}</p>
                  <p className="font-mono text-white" dir="ltr">{shop.account.iban}</p>
                  {shop.account.bankName && <p className="text-gray-400">{shop.account.bankName}</p>}
                  {shop.account.changedRecently && (
                    <p className="text-amber-400">{t("changedRecently", { date: formatDate(shop.account.updatedAt, locale) })}</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-amber-400">{t("noAccount")}</p>
              )}
              {shop.account && shop.owed.orderCount > 0 && (
                recording === shop.shopId ? (
                  <RecordPayout
                    shop={shop}
                    onRecorded={() => {
                      setRecording(null);
                      setRecordedName(shop.name);
                      void load();
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setRecordedName(null);
                      setRecording(shop.shopId);
                    }}
                    className="mt-4 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:border-teal-500/60 hover:text-white"
                  >
                    {t("recordTransfer")}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
