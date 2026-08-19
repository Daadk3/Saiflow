"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * The products directory must not be a dead end.
 *
 * This is a second doorway into the EXISTING moderation system — it posts to
 * /api/admin/moderation/[productId], the same endpoint the moderation queue
 * uses, which records the ModerationEvent audit entry. No moderation logic is
 * duplicated or rewritten here.
 */
export default function ReviewButton({
  productId,
  productName,
  previewHref,
  fileHref,
}: {
  productId: string;
  productName: string;
  /**
   * The internal moderation preview — /dashboard/admin/products/[id]/preview.
   *
   * NOT the storefront. This used to point at the buyer's product page, which
   * requires an APPROVED moderation status and (since Stage E2) a deliverable
   * that has passed scanning. A moderator opening a PENDING product therefore
   * got a 404 from the one control meant to show them what they were deciding
   * on. The preview renders the same listing without either filter, behind the
   * admin authorization boundary, and sells nothing.
   */
  previewHref: string;
  /**
   * Where to inspect the seller's deliverable before deciding.
   *
   * SaiFlow's own inspection route, NOT a storage URL. Deliverables are
   * private, so no URL to one is ever handed to the browser: the route
   * re-checks admin authority server-side, resolves the storage key from the
   * product row, and redirects to a signed URL that expires in a minute.
   *
   * "Open" shows the listing as submitted; this shows what the buyer would
   * actually receive — approving without the second is guesswork.
   */
  fileHref?: string | null;
}) {
  const t = useTranslations("admin.directory");
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
        setError(data.error || t("failed"));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-300 transition-colors hover:bg-teal-500/10"
      >
        {t("review")}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <a
          href={previewHref}
          target="_blank"
          rel="noopener noreferrer"
          title={productName}
          className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"
        >
          {t("open")}
        </a>
        {fileHref && (
          <a
            href={fileHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/5"
          >
            {t("inspectFile")}
          </a>
        )}
        <button
          onClick={() => decide("APPROVED")}
          disabled={busy}
          className="rounded-lg bg-teal-500 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t("approve")}
        </button>
        <button
          onClick={() => decide("REJECTED")}
          disabled={busy}
          className="rounded-lg border border-red-500/40 px-2.5 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          {t("reject")}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={busy}
          className="px-1.5 text-xs text-gray-500 hover:text-gray-300"
        >
          {t("cancel")}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
