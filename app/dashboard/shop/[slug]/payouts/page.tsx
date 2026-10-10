"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatPrice } from "@/lib/formatPrice";
import { formatDate } from "@/lib/formatDate";

/**
 * A shop owner's payouts: where SaiFlow sends their earnings, what they are
 * owed now, and every payout already made.
 *
 * Display and one form only. The server decides who may see or change the
 * bank details (the shop's OWNER), validates the IBAN, computes the balance
 * from the orders, and never sends the full IBAN back.
 */

interface Account {
  holderName: string;
  ibanMasked: string;
  bankName: string | null;
  updatedAt: string;
}

interface PayoutRow {
  id: string;
  amount: string;
  currency: string;
  orderCount: number;
  bankReference: string;
  ibanLast4: string;
  paidAt: string;
}

interface PayoutData {
  account: Account | null;
  owed: { amount: string; currency: string; orderCount: number; unreadable: number };
  payouts: PayoutRow[];
}

const FIELD =
  "mt-1 w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-4 py-2.5 text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none";

export default function ShopPayoutsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { status } = useSession();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("payouts");

  const [data, setData] = useState<PayoutData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [holderName, setHolderName] = useState("");
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status !== "authenticated") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shops/${encodeURIComponent(slug)}/payout-account`);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(res.status === 403 ? t("ownerOnly") : t("loadFailed"));
          return;
        }
        setData(body as PayoutData);
        if (!(body as PayoutData).account) setEditing(true);
      } catch {
        if (!cancelled) setLoadError(t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, router, slug, t]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/shops/${encodeURIComponent(slug)}/payout-account`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holderName, iban, bankName }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const code = body && typeof body.error === "string" ? body.error : "";
        setFormError(
          code === "invalid_iban"
            ? t("errors.iban")
            : code === "invalid_holder_name"
              ? t("errors.holderName")
              : code === "invalid_bank_name"
                ? t("errors.bankName")
                : res.status === 429
                  ? t("errors.tooMany")
                  : t("errors.generic")
        );
        return;
      }
      setData((prev) => (prev ? { ...prev, account: body.account as Account } : prev));
      setEditing(false);
      setIban("");
      setSaved(true);
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-gray-800 bg-[#111111] p-6">
          <p className="text-gray-300">{loadError}</p>
          <Link href={`/dashboard/shop/${encodeURIComponent(slug)}`} className="mt-4 inline-block text-teal-400 hover:text-teal-300">
            {t("backToShop")}
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-teal-500" aria-label={t("loading")} />
      </div>
    );
  }

  const money = (amount: string, currency: string) => <bdi>{formatPrice(Number(amount), currency, locale)}</bdi>;

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <Link href={`/dashboard/shop/${encodeURIComponent(slug)}`} className="text-sm text-gray-400 hover:text-teal-400">
          {t("backToShop")}
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-white">{t("heading")}</h1>
        <p className="mt-1 text-gray-500">{t("subtitle")}</p>

        <section className="mt-8 rounded-2xl border border-gray-800 bg-[#111111] p-6">
          <h2 className="text-sm font-medium text-gray-400">{t("owedHeading")}</h2>
          <p className="mt-2 text-3xl font-bold text-white">{money(data.owed.amount, data.owed.currency)}</p>
          <p className="mt-1 text-sm text-gray-500">{t("owedOrders", { count: data.owed.orderCount })}</p>
          <p className="mt-3 text-sm text-gray-400">{t("owedNote")}</p>
          {data.owed.unreadable > 0 && <p className="mt-2 text-sm text-amber-400">{t("unreadable", { count: data.owed.unreadable })}</p>}
        </section>

        <section className="mt-6 rounded-2xl border border-gray-800 bg-[#111111] p-6">
          <h2 className="text-lg font-semibold text-white">{t("accountHeading")}</h2>
          {saved && <p role="status" className="mt-2 text-sm text-teal-400">{t("saved")}</p>}
          {data.account && !editing ? (
            <div className="mt-4 space-y-1 text-sm">
              <p className="text-gray-300">{data.account.holderName}</p>
              <p className="font-mono text-gray-300" dir="ltr">{data.account.ibanMasked}</p>
              {data.account.bankName && <p className="text-gray-400">{data.account.bankName}</p>}
              <p className="text-gray-500">{t("updated", { date: formatDate(data.account.updatedAt, locale) })}</p>
              <button
                type="button"
                onClick={() => {
                  setHolderName(data.account?.holderName ?? "");
                  setBankName(data.account?.bankName ?? "");
                  setIban("");
                  setSaved(false);
                  setEditing(true);
                }}
                className="mt-3 rounded-lg border border-gray-700 px-4 py-2 text-gray-200 hover:border-teal-500/60 hover:text-white"
              >
                {t("change")}
              </button>
            </div>
          ) : (
            <form onSubmit={save} noValidate className="mt-4 space-y-4">
              <p className="text-sm text-gray-400">{t("formIntro")}</p>
              <label className="block text-sm text-gray-300">
                {t("holderName")}
                <input className={FIELD} value={holderName} onChange={(e) => setHolderName(e.target.value)} autoComplete="name" maxLength={100} required />
              </label>
              <label className="block text-sm text-gray-300">
                {t("iban")}
                <input
                  className={`${FIELD} font-mono`}
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  dir="ltr"
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="SA00 0000 0000 0000 0000 0000"
                  maxLength={34}
                  required
                />
              </label>
              <label className="block text-sm text-gray-300">
                {t("bankName")}
                <input className={FIELD} value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={100} />
              </label>
              {formError && <p role="alert" className="text-sm text-amber-400">{formError}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={saving} className="rounded-lg bg-teal-500 px-5 py-2.5 font-medium text-white hover:bg-teal-400 disabled:opacity-60">
                  {saving ? t("saving") : t("save")}
                </button>
                {data.account && (
                  <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-gray-700 px-5 py-2.5 text-gray-200">
                    {t("cancel")}
                  </button>
                )}
              </div>
            </form>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-gray-800 bg-[#111111] p-6">
          <h2 className="text-lg font-semibold text-white">{t("historyHeading")}</h2>
          {data.payouts.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">{t("historyEmpty")}</p>
          ) : (
            <ul className="mt-4 divide-y divide-gray-800">
              {data.payouts.map((payout) => (
                <li key={payout.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                  <span className="font-semibold text-white">{money(payout.amount, payout.currency)}</span>
                  <span className="text-gray-400">{formatDate(payout.paidAt, locale)}</span>
                  <span className="text-gray-500">{t("historyOrders", { count: payout.orderCount })}</span>
                  <span className="font-mono text-gray-500" dir="ltr">
                    {t("historyReference")}: {payout.bankReference} · ••{payout.ibanLast4}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
