"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The seller's view of a file's check: uploaded, scanning, passed or failed,
 * with a short reason and a retry when one is possible.
 *
 * Renders a value the server derived (lib/seller-file-state.ts). Nothing here
 * decides anything: the retry asks the server, and the server refuses
 * anything that is not a failed, retryable file.
 */
export type SellerFileStateName = "uploaded" | "scanning" | "passed" | "failed";

export interface FileScanStateView {
  state: SellerFileStateName;
  failure: string | null;
  canRetry: boolean;
}

const FAILURE_KEYS: Record<string, string> = {
  unsafe_content: "failureUnsafeContent",
  unsupported_format: "failureUnsupportedFormat",
  password_protected: "failurePasswordProtected",
  archive_problem: "failureArchiveProblem",
  check_unavailable: "failureCheckUnavailable",
  timed_out: "failureTimedOut",
  not_started: "failureNotStarted",
  attempts_exhausted: "failureAttemptsExhausted",
  no_record: "failureNoRecord",
};

const BADGE: Record<SellerFileStateName, string> = {
  uploaded: "bg-gray-500/10 text-gray-300 border-gray-500/30",
  scanning: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  passed: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  failed: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATE_KEYS: Record<SellerFileStateName, string> = {
  uploaded: "stateUploaded",
  scanning: "stateScanning",
  passed: "statePassed",
  failed: "stateFailed",
};

interface FileScanStateProps {
  productId: string;
  value: FileScanStateView | null;
  /** Called after a retry was accepted, so the caller can reload its data. */
  onRetried?: () => void;
}

export function FileScanState({ productId, value, onRetried }: FileScanStateProps) {
  const t = useTranslations("fileSafety");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!value) return null;

  async function retry() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/products/${productId}/rescan`, { method: "POST" });
      if (res.ok) {
        setNote(t("retryStarted"));
        onRetried?.();
      } else if (res.status === 429) {
        setNote(t("retryLimited"));
      } else {
        setNote(t("retryRefused"));
      }
    } catch {
      setNote(t("retryRefused"));
    } finally {
      setBusy(false);
    }
  }

  const failureKey = value.failure ? FAILURE_KEYS[value.failure] ?? "failureUnknown" : null;

  return (
    <div className="flex flex-col gap-1">
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE[value.state]}`}
      >
        {value.state === "scanning" && (
          <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {value.state === "passed" && (
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {t(STATE_KEYS[value.state])}
      </span>
      {value.state === "failed" && failureKey && (
        <p className="text-xs leading-relaxed text-red-400/80">{t(failureKey)}</p>
      )}
      {value.state === "failed" && value.canRetry && (
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="w-fit rounded-full border border-gray-700 px-3 py-1 text-xs font-medium text-gray-200 transition-colors hover:border-teal-500/60 hover:text-white disabled:opacity-50"
        >
          {busy ? t("retrying") : t("retryAction")}
        </button>
      )}
      {note && <p className="text-xs text-gray-400">{note}</p>}
    </div>
  );
}
