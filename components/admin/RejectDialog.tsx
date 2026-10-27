"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QUICK_REJECTION_REASONS, quickReasonText } from "@/lib/rejection-reasons";
import {
  REVIEW_CHECKLIST,
  buildRejectionMessage,
  type ChecklistPointId,
  type ChecklistRow,
} from "@/lib/review-checklist";

/**
 * The founder's reject dialog: a reason, quick picks from the listing
 * standards, and a preview of what the seller will receive.
 *
 * Replaces window.prompt, which showed a one-line English box with no idea
 * of what the seller would read. The reason is required (the moderation
 * route refuses a rejection without one) and goes into the seller's email
 * and the audit log exactly as written.
 *
 * The founder ticks the review-checklist points the product failed and the
 * seller's message is written from them (lib/review-checklist): Arabic,
 * signed "فريق SaiFlow", never a person's name. It stays editable; once the
 * founder edits it by hand, ticking more points no longer overwrites it.
 * Nothing is pre-ticked, not even a point the auto-checks flagged: the
 * checks only flag, the founder decides.
 *
 * A native <dialog>, so focus, Escape and the backdrop behave as a dialog
 * should without extra code.
 */
export default function RejectDialog({
  open,
  productName,
  busy,
  error,
  checklist,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  productName: string;
  busy: boolean;
  error: string | null;
  /** The product's checklist rows, to show each point's auto-check beside its tick box. */
  checklist?: ChecklistRow[];
  onCancel: () => void;
  onConfirm: (reason: string, failedPoints: ChecklistPointId[]) => void;
}) {
  const t = useTranslations("admin.rejectDialog");
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<ChecklistPointId[]>([]);
  // True once the founder has typed in the box or picked a ready reason, so
  // ticking points never overwrites their own words.
  const [edited, setEdited] = useState(false);
  const fieldId = useId();

  function toggle(id: ChecklistPointId) {
    const next = failed.includes(id) ? failed.filter((p) => p !== id) : [...failed, id].sort((a, b) => a - b);
    setFailed(next);
    if (!edited) setReason(buildRejectionMessage(next));
  }

  // The effect only opens and closes the native dialog. The text is cleared
  // by the dialog's own close event below, so every opening starts empty
  // without setting state inside an effect.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const trimmed = reason.trim();

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClose={() => {
        setReason("");
        setFailed([]);
        setEdited(false);
      }}
      aria-labelledby={`${fieldId}-title`}
      className="max-h-[calc(100vh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-gray-800 bg-[#111111] p-0 text-start text-gray-200 backdrop:bg-black/70"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !busy) onConfirm(trimmed, failed);
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id={`${fieldId}-title`} className="text-lg font-semibold text-white">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            <bdi>{productName}</bdi>
          </p>
        </div>

        <fieldset dir="rtl" lang="ar">
          <legend className="mb-2 text-xs font-medium text-gray-400">{t("checklistHeading")}</legend>
          <div className="space-y-1">
            {REVIEW_CHECKLIST.map((point) => {
              const row = checklist?.find((r) => r.id === point.id);
              return (
                <label key={point.id} className="flex cursor-pointer items-start gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={failed.includes(point.id)}
                    onChange={() => toggle(point.id)}
                    className="mt-1 accent-red-500"
                  />
                  <span>
                    {point.id}) {point.label}
                    {row && row.state !== "manual" && (
                      <span className={`ms-1 text-xs ${row.state === "warn" ? "text-amber-300/90" : "text-teal-300/80"}`}>
                        {row.state === "warn" ? "⚠️" : "✅"} {row.reason}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          {edited && failed.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p className="text-xs text-gray-500">{t("editedNote")}</p>
              <button
                type="button"
                onClick={() => {
                  setReason(buildRejectionMessage(failed));
                  setEdited(false);
                }}
                className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:border-red-400/60 hover:text-white"
              >
                {t("rebuild")}
              </button>
            </div>
          )}
        </fieldset>

        <div>
          <p className="mb-2 text-xs font-medium text-gray-400">{t("otherReasons")}</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_REJECTION_REASONS.map((quick) => (
              <button
                key={quick.id}
                type="button"
                onClick={() => {
                  setReason(quickReasonText(quick));
                  setEdited(true);
                }}
                className="rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 hover:border-red-400/60 hover:text-white"
              >
                {t(`quick.${quick.id}`)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor={fieldId} className="mb-1 block text-sm font-medium text-gray-300">
            {t("label")}
          </label>
          <textarea
            id={fieldId}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setEdited(true);
            }}
            rows={8}
            required
            maxLength={2000}
            dir="auto"
            placeholder={t("placeholder")}
            className="w-full rounded-lg border border-gray-700 bg-[#0a0a0a] p-3 text-sm text-white placeholder-gray-600 focus:border-red-400 focus:outline-none"
          />
        </div>

        <div className="rounded-lg border border-gray-800 bg-[#0a0a0a] p-3">
          <p className="text-xs font-medium text-gray-400">{t("previewHeading")}</p>
          <p className="mt-2 text-sm font-semibold text-white">{t("previewTitle")}</p>
          <p className="mt-1 text-xs text-gray-400">
            {t("previewProduct")} <bdi>{productName}</bdi>
          </p>
          <p dir="auto" className="mt-1 whitespace-pre-line text-xs text-gray-300 [unicode-bidi:plaintext]">
            {t("previewReason")} {trimmed || "—"}
          </p>
          <p className="mt-1 text-xs text-gray-500">{t("previewNext")}</p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={busy || !trimmed}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("sending") : t("confirm")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
