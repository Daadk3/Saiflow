"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useLocale } from "next-intl";
import { formatPrice } from "@/lib/formatPrice";

// Tier 0 moderation queue — deliberately spartan.
// Admin authority is enforced server-side (ADMIN_EMAILS); non-admins get 403.
// Tier 1 replaces this with the full console (see docs/TRUST_AND_SAFETY.md).

interface PendingProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  thumbnailUrl: string | null;
  /**
   * Whether the deliverable can be opened through the admin inspection route.
   * The file's own URL is never sent here — it is a private object.
   */
  canInspect: boolean;
  certifiedAt: string | null;
  createdAt: string;
  shop: { name: string; slug: string };
}

export default function ModerationQueuePage() {
  const locale = useLocale();
  const ar = locale.startsWith("ar");

  const [items, setItems] = useState<PendingProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/moderation");
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setItems(data.pending ?? []);
    } catch {
      setError(ar ? "تعذر تحميل قائمة المراجعة" : "Failed to load the review queue");
    } finally {
      setLoading(false);
    }
  }, [ar]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id: string, action: "APPROVED" | "REJECTED") {
    let reason: string | undefined;
    if (action === "REJECTED") {
      reason =
        window.prompt(
          ar
            ? "سبب الرفض (سيُسجل في سجل المراجعة):"
            : "Rejection reason (recorded in the audit log):"
        ) ?? undefined;
      if (!reason?.trim()) return; // rejection requires a reason
    }
    setActingId(id);
    try {
      const res = await fetch(`/api/admin/moderation/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || (ar ? "فشل تسجيل القرار" : "Failed to record the decision"));
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setActingId(null);
    }
  }

  if (forbidden) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 pt-24">
        <p className="text-gray-400">
          {ar ? "هذه الصفحة لمشرفي المنصة فقط." : "This page is for marketplace administrators only."}
        </p>
      </div>
    );
  }

  return (
    <div className="pt-24 pb-16 px-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">
        {ar ? "قائمة مراجعة المنتجات" : "Product Review Queue"}
      </h1>
      <p className="text-gray-400 text-sm mb-8">
        {ar
          ? "كل قرار يُسجَّل في سجل تدقيق دائم."
          : "Every decision is recorded in a permanent audit log."}
      </p>

      {loading && <p className="text-gray-500">{ar ? "جارٍ التحميل…" : "Loading…"}</p>}
      {error && (
        <div className="p-4 mb-6 bg-red-500/10 border border-red-500/20 rounded-xl">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && items.length === 0 && !forbidden && (
        <div className="p-8 text-center rounded-xl border border-gray-800 bg-[#0f0f0f]">
          <p className="text-gray-400">
            {ar ? "لا توجد منتجات بانتظار المراجعة. ✓" : "No products awaiting review. ✓"}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {items.map((p) => (
          <div key={p.id} className="p-5 rounded-xl bg-[#0f0f0f] border border-gray-800">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-[#1a1a1a] border border-gray-800">
                {p.thumbnailUrl && (
                  <Image src={p.thumbnailUrl} alt="" width={64} height={64} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-white">{p.name}</h2>
                <p className="text-sm text-gray-500">
                  {p.shop.name} · {formatPrice(p.price, p.currency, locale)}
                  {p.category ? ` · ${p.category}` : ""}
                </p>
                {p.description && (
                  <p className="text-sm text-gray-400 mt-2 line-clamp-3">{p.description}</p>
                )}
                <p className="text-xs text-gray-600 mt-2 font-mono">
                  {ar ? "إقرار البائع:" : "Seller certified:"}{" "}
                  {p.certifiedAt ? new Date(p.certifiedAt).toLocaleString(locale) : "—"}
                </p>
                {p.canInspect && (
                  // SaiFlow's inspection route, not the file's URL: it
                  // re-checks admin authority and redirects to a signed URL
                  // that expires in a minute.
                  <a
                    href={`/api/admin/inspect/${p.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-2 text-xs text-teal-400 hover:text-teal-300 underline"
                  >
                    {ar ? "معاينة الملف" : "Inspect file"}
                  </a>
                )}
              </div>
              <div className="flex sm:flex-col gap-2 sm:justify-center">
                <button
                  onClick={() => decide(p.id, "APPROVED")}
                  disabled={actingId === p.id}
                  className="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                >
                  {ar ? "اعتماد" : "Approve"}
                </button>
                <button
                  onClick={() => decide(p.id, "REJECTED")}
                  disabled={actingId === p.id}
                  className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-400 text-sm font-semibold border border-red-500/30 transition-colors"
                >
                  {ar ? "رفض" : "Reject"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
