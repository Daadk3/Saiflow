"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import RejectDialog from "@/components/admin/RejectDialog";
import type { ChecklistPointId, ChecklistRow } from "@/lib/review-checklist";
import { DECISION_TOAST_MS, afterDecision, readDecisionResponse, type Decision } from "@/lib/decision-feedback";

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
 *
 * After a decision the page's data is refreshed in a transition and the
 * controls wait for it; when it lands, a short confirmation appears. If the
 * refresh finishes without the page showing the decision, the page reloads
 * (lib/decision-feedback). A refused or failed rejection keeps its dialog
 * open with the error inside.
 */
export default function DecisionButtons({
  productId,
  productName,
  status,
  approveBlocked = null,
  checklist,
}: {
  productId: string;
  /** Shown in the reject dialog, so the founder knows which product the reason is for. */
  productName: string;
  status: Status;
  /**
   * Why Approve is unavailable (a DeliverableGateReason), or null. The server
   * refuses approval without a deliverable that passed its check; this only
   * says so before the click.
   */
  approveBlocked?: string | null;
  /** The 8-point review checklist, shown beside the reject dialog's tick boxes. */
  checklist?: ChecklistRow[];
}) {
  const t = useTranslations("admin.directory");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A rejection needs a reason, written in the reject dialog (the API
  // refuses one without); approval sends straight away.
  const [rejecting, setRejecting] = useState(false);

  // The decision just saved, set inside the refresh transition so it is seen
  // together with the refreshed status (lib/decision-feedback).
  const [decided, setDecided] = useState<Decision | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const stage = afterDecision(decided, status, refreshing);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage === "reload") {
      // The refresh did not bring the decision back: read the server again.
      // Logged so a Preview test can tell this fallback ran.
      console.warn("[decision] refresh did not show the decision; reloading");
      window.location.reload();
      return;
    }
    if (stage !== "done") return;
    // The button that was pressed is gone now; keep keyboard focus here.
    statusRef.current?.focus();
    const timer = window.setTimeout(() => setDecided(null), DECISION_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  function decide(action: "APPROVED" | "REJECTED") {
    if (action === "REJECTED") {
      setError(null);
      setRejecting(true);
      return;
    }
    void send("APPROVED");
  }

  async function send(action: "APPROVED" | "REJECTED", reason?: string, failedPoints: ChecklistPointId[] = []) {
    if (action === "REJECTED" && !reason?.trim()) return; // the API requires a reason for rejections
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/moderation/${productId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason, failedPoints }),
      });
      const result = readDecisionResponse(res.ok, res.ok ? null : await res.json().catch(() => ({})));
      if (!result.ok) {
        // The dialog stays open (rejecting is unchanged) and shows this.
        setError("key" in result.error ? t(result.error.key) : result.error.text);
        return;
      }
      setRejecting(false);
      startRefresh(() => {
        setDecided(action);
        router.refresh();
      });
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
            disabled={busy || refreshing || approveBlocked !== null}
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
            disabled={busy || refreshing}
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
      {/* Always mounted, so screen readers announce what appears in it. */}
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {refreshing && <p className="text-xs text-gray-400">{t("updating")}</p>}
        {stage === "done" && decided && (
          <p className="fixed inset-x-4 bottom-6 z-50 mx-auto max-w-sm rounded-xl border border-teal-500/30 bg-[#0f1f1c] px-4 py-3 text-center text-sm text-teal-200 shadow-lg">
            {t(`decided.${decided}`)}
          </p>
        )}
      </div>
      {error && !rejecting && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <RejectDialog
        open={rejecting}
        productName={productName}
        busy={busy}
        error={rejecting ? error : null}
        onCancel={() => {
          setRejecting(false);
          setError(null);
        }}
        checklist={checklist}
        onConfirm={(reason, failedPoints) => void send("REJECTED", reason, failedPoints)}
      />
    </div>
  );
}
