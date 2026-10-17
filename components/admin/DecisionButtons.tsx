"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Status = "PENDING" | "APPROVED" | "REJECTED";

/**
 * Change a product's moderation decision from its admin page.
 *
 * A decision is never final: an approved product can turn out to be
 * misleading once someone looks at the file, and a rejected one can be put
 * right. The server always allowed this; the page simply offered no way to do
 * it once a product had been decided. This posts to the same endpoint as the
 * queue and the directory (/api/admin/moderation/[productId]), which records
 * the change in the audit log with its previous status, requires a reason for
 * a rejection, and emails the seller. Only the decisions that would change
 * something are offered.
 */
export default function DecisionButtons({
  productId,
  status,
  approveBlocked = null,
}: {
  productId: string;
  status: Status;
  /**
   * Why Approve is unavailable (a DeliverableGateReason), or null. The server
   * refuses approval without a deliverable that passed its check; this only
   * says so before the click.
   */
  approveBlocked?: string | null;
}) {
  const t = useTranslations("admin.directory");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "APPROVED" | "REJECTED") {
    let reason: string | undefined;
    if (action === "REJECTED") {
      reason = window.prompt(t("rejectReason")) ?? undefined;
      if (!reason?.trim()) return; // the API requires a reason for rejections
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/moderation/${productId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "not_approvable" && typeof data.reason === "string"
            ? t(`approveBlocked.${data.reason}`)
            : data.error || t("failed")
        );
        return;
      }
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== "APPROVED" && (
          <button
            type="button"
            onClick={() => decide("APPROVED")}
            disabled={busy || approveBlocked !== null}
            aria-describedby={approveBlocked ? `approve-blocked-${productId}` : undefined}
            className="rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("approve")}
          </button>
        )}
        {status !== "REJECTED" && (
          <button
            type="button"
            onClick={() => decide("REJECTED")}
            disabled={busy}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
          >
            {t("reject")}
          </button>
        )}
      </div>
      {status !== "APPROVED" && approveBlocked && (
        <p id={`approve-blocked-${productId}`} className="text-xs text-amber-300">
          {t(`approveBlocked.${approveBlocked}`)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
