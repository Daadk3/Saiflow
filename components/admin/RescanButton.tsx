"use client";

import { useState } from "react";

/**
 * Admin retry of a failed file scan. Labels arrive from the server page so
 * this stays a tiny client island. The server decides whether the retry is
 * allowed; this only asks.
 */
interface RescanButtonProps {
  productId: string;
  labels: { retry: string; retrying: string; started: string; refused: string; limited: string };
}

export function RescanButton({ productId, labels }: RescanButtonProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/products/${productId}/rescan`, { method: "POST" });
      setNote(res.ok ? labels.started : res.status === 429 ? labels.limited : labels.refused);
    } catch {
      setNote(labels.refused);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="rounded-full border border-gray-700 px-3 py-1 text-xs font-medium text-gray-200 transition-colors hover:border-teal-500/60 hover:text-white disabled:opacity-50"
      >
        {busy ? labels.retrying : labels.retry}
      </button>
      {note && <span className="text-xs text-gray-400">{note}</span>}
    </div>
  );
}
