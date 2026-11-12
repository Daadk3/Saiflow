"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Quiet report control for the shop owner. It never edits or deletes the review. */
export function ReportReviewButton({ reviewId }: { reviewId: string }) {
  const t = useTranslations("reviews");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setState(res.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "done") return <p className="text-xs text-gray-400">{t("reportSent")}</p>;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline">
        {t("report")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="block text-xs text-gray-400" htmlFor={`report-${reviewId}`}>
        {t("reportReason")}
      </label>
      <textarea
        id={`report-${reviewId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={500}
        required
        rows={3}
        className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white"
      />
      <p className="text-xs text-gray-500">{t("reportHint")}</p>
      {state === "error" && <p className="text-xs text-amber-400">{t("error")}</p>}
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500"
      >
        {t("reportSubmit")}
      </button>
    </form>
  );
}
