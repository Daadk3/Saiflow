"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { pollPaymentStatus } from "@/lib/payments/status-poll";
import type { PollOutcome } from "@/lib/payments/status-poll";

/**
 * The page Geidea returns the buyer to.
 *
 * Arriving here proves nothing, and the page treats it that way. It reads
 * the merchant reference from the URL, asks SaiFlow's own status endpoint
 * what became of that attempt, and shows exactly what it is told: confirmed
 * only once the verified callback has written an Order, otherwise processing
 * for a bounded while, or failed, cancelled or expired. It never contacts
 * Geidea and never learns an order id. The download button appears only in
 * the paid view, and only with the path the status endpoint supplied, which
 * that endpoint derives from the confirmed Order. The page builds no download
 * address of its own, and the download route authorises from the Order again
 * on every click.
 */

type View =
  | { kind: "processing" }
  | { kind: "paid"; productName: string; downloadUrl: string | null }
  | { kind: "failed" | "cancelled" | "expired"; productName: string }
  | { kind: "timeout"; productName: string | null }
  | { kind: "unknown" }
  | { kind: "error" };

function viewFor(outcome: PollOutcome): View {
  switch (outcome.kind) {
    case "settled":
      return outcome.status === "paid"
        ? { kind: "paid", productName: outcome.productName, downloadUrl: outcome.downloadUrl }
        : { kind: outcome.status, productName: outcome.productName };
    case "processing":
      return { kind: "timeout", productName: outcome.productName };
    case "unknown":
      return { kind: "unknown" };
    case "aborted":
      return { kind: "processing" };
    default:
      return { kind: "error" };
  }
}

function SuccessContent() {
  const t = useTranslations("success");
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");

  const [view, setView] = useState<View>(ref ? { kind: "processing" } : { kind: "unknown" });

  useEffect(() => {
    if (!ref) return;
    const controller = new AbortController();
    pollPaymentStatus({ ref, signal: controller.signal }).then((outcome) => {
      if (!controller.signal.aborted) setView(viewFor(outcome));
    });
    return () => controller.abort();
  }, [ref]);

  const isProcessing = view.kind === "processing";
  const isPaid = view.kind === "paid";
  const isTimeout = view.kind === "timeout";
  const isEnded = view.kind === "failed" || view.kind === "cancelled" || view.kind === "expired";

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/10 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 p-6">
        <Link href="/" className="inline-flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-xl font-bold text-white">Saiflow</span>
        </Link>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div
            className="bg-[#111111] rounded-2xl border border-gray-800/50 shadow-2xl shadow-black/50 p-8 text-center"
            role="status"
            aria-live="polite"
          >
            {isPaid && (
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-emerald-500/10">
                <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            {(isProcessing || isTimeout) && (
              <div className="w-16 h-16 flex items-center justify-center mx-auto mb-6">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-teal-500" aria-hidden="true" />
              </div>
            )}
            {(isEnded || view.kind === "unknown" || view.kind === "error") && (
              <div className="w-16 h-16 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 ring-4 ring-amber-500/10">
                <svg className="w-8 h-8 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            )}

            <h1 className="text-2xl font-bold text-white mb-2">{t(`${view.kind}Title`)}</h1>

            <p className="text-gray-400 mb-8">
              {view.kind === "paid" || isEnded
                ? t.rich(`${view.kind}Body`, {
                    name: view.productName,
                    product: (chunks) => <strong className="text-white">{chunks}</strong>,
                  })
                : t(`${view.kind}Body`)}
            </p>

            {view.kind === "paid" && view.downloadUrl !== null && (
              <a
                href={view.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-teal-500 hover:bg-teal-400 text-white px-6 py-3 rounded-xl font-semibold transition-colors mb-6"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t("downloadCta")}
              </a>
            )}
            {view.kind === "paid" && view.downloadUrl === null && (
              <p className="text-amber-400 text-sm mb-6">{t("paidNoLink")}</p>
            )}

            {(isTimeout || isEnded || view.kind === "unknown" || view.kind === "error") && ref && (
              <p className="text-gray-500 text-xs mb-6 break-all">{t("referenceLabel", { ref })}</p>
            )}

            <p className="text-gray-500 text-sm mb-6">
              {t.rich("helperText", {
                email: (chunks) => (
                  <a href="mailto:support@saiflow.io" className="text-teal-400 hover:text-teal-300">
                    {chunks}
                  </a>
                ),
              })}
            </p>

            <Link
              href="/browse"
              className="inline-block text-teal-400 hover:text-teal-300 font-medium transition-colors"
            >
              {t("continueShopping")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function LoadingFallback() {
  const t = useTranslations("success");
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="bg-[#111111] rounded-2xl border border-gray-800/50 p-8 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500 mx-auto"></div>
        <p className="text-gray-400 mt-4">{t("suspenseFallback")}</p>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SuccessContent />
    </Suspense>
  );
}
