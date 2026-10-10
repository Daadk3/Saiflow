"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import type { PanelState } from "@/lib/checkout/dropin-controller";

export type { PanelState };

/**
 * Every state the payment area of SaiFlow's checkout page can be in, drawn
 * and nothing else. The controller behind DropInCheckout owns the network,
 * Geidea's library and the timers; this one only renders.
 *
 * Geidea's form lives in `containerRef`'s element, whose id is unique to this
 * mount and is set by DropInCheckout after mount. React never renders
 * children into it, so nothing React does can disturb the iframe Geidea
 * places there; the loading skeleton sits beside it, not inside.
 *
 * The hosted page is offered only before any session reached this page.
 * Once one has, every state offers that attempt's status page, and "try
 * again" reloads, which resumes the same session rather than starting one.
 * After the session has expired nothing offers to start again: the server
 * starts no new payment while this one's outcome is unknown, so the only
 * way forward shown is its status page.
 */

interface DropInPanelProps {
  state: PanelState;
  /** The element Geidea mounts into; its per-mount id is assigned by the caller. */
  containerRef: RefObject<HTMLDivElement | null>;
  productHref: string;
  onContinueHosted: () => void;
  onRetry: () => void;
}

const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-gray-700 px-5 py-3 text-sm font-medium text-gray-200 transition-colors hover:border-teal-500/60 hover:text-white";

function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function Notice({
  tone,
  title,
  body,
  children,
}: {
  tone: "info" | "warn" | "neutral";
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  const ring =
    tone === "warn"
      ? "border-amber-500/25 bg-amber-500/[0.06]"
      : tone === "info"
        ? "border-teal-500/25 bg-teal-500/[0.06]"
        : "border-gray-800 bg-[#111111]";
  const icon =
    tone === "warn" ? "text-amber-400" : tone === "info" ? "text-teal-400" : "text-gray-400";
  return (
    <div role="status" aria-live="polite" className={`rounded-2xl border p-6 text-center ${ring}`}>
      <svg className={`mx-auto h-8 w-8 ${icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h3 className="mt-3 text-base font-semibold text-white">{title}</h3>
      {body && <p className="mt-1.5 text-sm leading-relaxed text-gray-400">{body}</p>}
      {children && <div className="mt-5 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>}
    </div>
  );
}

export function DropInPanel({ state, containerRef, productHref, onContinueHosted, onRetry }: DropInPanelProps) {
  const t = useTranslations("checkout");
  const frameVisible = state.kind === "starting" || state.kind === "ready";
  const backLink = (
    <Link href={productHref} className={SECONDARY}>
      {t("backToProduct")}
    </Link>
  );
  return (
    <div className="space-y-4">
      {state.kind === "ready" && state.expired && (
        <Notice tone="warn" title={t("expiredTitle")} body={t("expiredBody")}>
          <a href={state.statusPath} className={PRIMARY}>
            {t("checkStatus")}
          </a>
        </Notice>
      )}

      {/* Geidea's secure form, framed as a light card on the dark page. */}
      <div
        className={
          frameVisible
            ? `relative overflow-hidden rounded-2xl bg-white p-1 shadow-xl shadow-black/40 ring-1 ring-white/10 sm:p-2 ${state.kind === "starting" ? "min-h-[420px]" : ""}`
            : "hidden"
        }
      >
        <div ref={containerRef} />
        {state.kind === "starting" && (
          <div className="absolute inset-0 flex flex-col justify-center gap-4 p-6" aria-hidden="true">
            <div className="mx-auto flex items-center gap-2 text-sm text-gray-500">
              <Spinner className="h-4 w-4 text-teal-500" />
              {t("preparing")}
            </div>
            <div className="h-11 animate-pulse rounded-lg bg-gray-100" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-11 animate-pulse rounded-lg bg-gray-100" />
              <div className="h-11 animate-pulse rounded-lg bg-gray-100" />
            </div>
            <div className="h-12 animate-pulse rounded-lg bg-teal-500/20" />
          </div>
        )}
      </div>
      {state.kind === "starting" && (
        <p role="status" className="sr-only">
          {t("preparing")}
        </p>
      )}

      {state.kind === "ready" && (
        <div className="space-y-3">
          {/* Geidea shows a refused card only briefly, inside its own form, and
              may not tell this page at all; so the help stays on screen while
              the session can still be paid. */}
          {!state.expired && (
            <p className="rounded-xl border border-gray-800 bg-[#111111] px-4 py-3 text-sm leading-relaxed text-gray-300">
              {t("cardHelp")}
            </p>
          )}
          <p className="text-center text-xs text-gray-500">
            {t("troublePrompt")}{" "}
            <button type="button" onClick={onRetry} className="font-medium text-teal-400 underline-offset-4 hover:underline">
              {t("reloadForm")}
            </button>
          </p>
        </div>
      )}

      {state.kind === "confirming" && (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 rounded-2xl border border-gray-800 bg-[#111111] p-6 text-sm text-gray-300">
          <Spinner className="h-5 w-5 text-teal-400" />
          {t("confirming")}
        </div>
      )}

      {(state.kind === "fallback" || state.kind === "redirecting") && (
        <Notice tone="info" title={t("fallbackTitle")} body={t("fallbackBody")}>
          <button type="button" onClick={onContinueHosted} disabled={state.kind === "redirecting"} className={PRIMARY}>
            {state.kind === "redirecting" ? (
              <>
                <Spinner className="h-4 w-4" />
                {t("redirecting")}
              </>
            ) : (
              t("continueHosted")
            )}
          </button>
        </Notice>
      )}

      {state.kind === "stuck" && (
        <Notice tone="warn" title={t("stuckTitle")} body={t("stuckBody")}>
          <button type="button" onClick={onRetry} className={PRIMARY}>
            {t("reloadForm")}
          </button>
          <a href={state.statusPath} className={SECONDARY}>
            {t("checkStatus")}
          </a>
          {backLink}
        </Notice>
      )}

      {state.kind === "cancelled" && (
        <Notice tone="neutral" title={t("cancelledTitle")} body={t("cancelledBody")}>
          <button type="button" onClick={onRetry} className={PRIMARY}>
            {t("tryAgain")}
          </button>
          <a href={state.statusPath} className={SECONDARY}>
            {t("checkStatus")}
          </a>
          {backLink}
        </Notice>
      )}

      {state.kind === "declined" && (
        <Notice tone="warn" title={t("declinedTitle")} body={t("declinedBody")}>
          <a href={state.statusPath} className={PRIMARY}>
            {t("checkStatus")}
          </a>
          <button type="button" onClick={onRetry} className={SECONDARY}>
            {t("tryAgain")}
          </button>
        </Notice>
      )}

      {state.kind === "unavailable" && (
        <Notice
          tone={state.problem === "service" ? "warn" : "neutral"}
          title={t(`${state.problem}Title`)}
          body={t(`${state.problem}Body`)}
        >
          {(state.problem === "service" || state.problem === "cookies") && (
            <button type="button" onClick={onRetry} className={PRIMARY}>
              {t("tryAgain")}
            </button>
          )}
          {backLink}
        </Notice>
      )}
    </div>
  );
}
