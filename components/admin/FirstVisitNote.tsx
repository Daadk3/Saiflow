"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

const KEY = "saiflow.founder.firstVisit.dismissed";

/**
 * Shown once, then never again (localStorage). Explains why live products say
 * "not yet reviewed" — without it, that badge reads as a malfunction.
 *
 * useSyncExternalStore keeps this SSR-safe: the server snapshot reports
 * "dismissed" so the note never flashes during hydration, and no state is set
 * inside an effect.
 */
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return true; // storage unavailable (private mode) — stay quiet
  }
}

function getServerSnapshot() {
  return true;
}

export default function FirstVisitNote() {
  const t = useTranslations("admin.firstVisit");
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }

  return (
    <section className="rounded-xl border border-teal-500/20 bg-teal-500/[0.06] p-5">
      <h2 className="text-sm font-semibold text-teal-300">{t("title")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">{t("body")}</p>
      <button
        onClick={dismiss}
        className="mt-3 text-xs font-medium text-teal-400 transition-colors hover:text-teal-300"
      >
        {t("dismiss")}
      </button>
    </section>
  );
}
