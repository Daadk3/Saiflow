"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Hide or restore one review. The list behind it is rendered on the server. */
export function ReviewModerationControls({ reviewId, hidden }: { reviewId: string; hidden: boolean }) {
  const t = useTranslations("reviews");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function submit(action: "hide" | "unhide") {
    setState("saving");
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewId, action, reason }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {!hidden && (
        <label className="block text-xs text-gray-400">
          {t("hideReason")}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white"
          />
        </label>
      )}
      {state === "error" && <p className="text-xs text-amber-300">{t("error")}</p>}
      {hidden ? (
        <button
          type="button"
          disabled={state === "saving"}
          onClick={() => submit("unhide")}
          className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-100 hover:border-gray-400"
        >
          {t("unhide")}
        </button>
      ) : (
        <button
          type="button"
          disabled={state === "saving"}
          onClick={() => submit("hide")}
          className="rounded-lg bg-amber-500/90 px-3 py-1.5 text-sm font-semibold text-[#161007] hover:bg-amber-400"
        >
          {t("hide")}
        </button>
      )}
    </div>
  );
}
