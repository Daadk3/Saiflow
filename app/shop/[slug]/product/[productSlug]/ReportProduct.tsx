"use client";

import { useState } from "react";
import { useLocale } from "next-intl";

// "Report this product" — Trust & Safety Tier 0.
// Deliberately quiet: a text link that expands to a small form.
// Reports never remove products; they notify the admin for human review.

const CATEGORIES: { value: string; en: string; ar: string }[] = [
  { value: "copyright", en: "Copyright infringement", ar: "انتهاك حقوق النشر" },
  { value: "illegal", en: "Illegal content", ar: "محتوى غير قانوني" },
  { value: "explicit", en: "Explicit sexual content", ar: "محتوى جنسي صريح" },
  { value: "child_safety", en: "Child safety concern", ar: "مساس بسلامة الأطفال" },
  { value: "political", en: "Political content", ar: "محتوى سياسي" },
  { value: "religious", en: "Religious content", ar: "محتوى ديني مسيء" },
  { value: "hate_harassment", en: "Hate / harassment", ar: "كراهية أو تحرش" },
  { value: "fraud_scam", en: "Fraud / scam", ar: "احتيال أو نصب" },
  { value: "malware", en: "Malware", ar: "برمجيات ضارة" },
  { value: "other", en: "Other", ar: "أخرى" },
];

export default function ReportProduct({ productId }: { productId: string }) {
  const ar = useLocale().startsWith("ar");
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) return;
    setState("sending");
    try {
      const res = await fetch(`/api/products/${productId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, details: details || undefined }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="text-sm text-gray-500 mt-8" role="status">
        {ar
          ? "شكرًا لك — استلمنا بلاغك وسنراجعه."
          : "Thank you — we received your report and will review it."}
      </p>
    );
  }

  return (
    <div className="mt-8">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-gray-500 hover:text-gray-300 underline transition-colors"
        >
          {ar ? "الإبلاغ عن هذا المنتج" : "Report this product"}
        </button>
      ) : (
        <form onSubmit={submit} className="max-w-md space-y-3 p-4 rounded-xl bg-[#111] border border-white/10">
          <p className="text-sm font-semibold text-white">
            {ar ? "الإبلاغ عن هذا المنتج" : "Report this product"}
          </p>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:border-teal-500 focus:outline-none"
          >
            <option value="">{ar ? "اختر السبب…" : "Select a reason…"}</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {ar ? c.ar : c.en}
              </option>
            ))}
          </select>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder={ar ? "تفاصيل إضافية (اختياري)" : "Additional details (optional)"}
            className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none"
          />
          {state === "error" && (
            <p className="text-sm text-red-400">
              {ar ? "تعذر إرسال البلاغ. حاول مرة أخرى." : "Could not submit the report. Please try again."}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={state === "sending" || !category}
              className="px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 disabled:opacity-50 text-red-400 text-sm font-semibold border border-red-500/30 transition-colors"
            >
              {state === "sending" ? (ar ? "جارٍ الإرسال…" : "Sending…") : ar ? "إرسال البلاغ" : "Submit report"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 rounded-lg text-gray-400 hover:text-white text-sm transition-colors"
            >
              {ar ? "إلغاء" : "Cancel"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
