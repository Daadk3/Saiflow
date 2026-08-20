"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Copy a permanent public URL to the clipboard.
 *
 * WHAT THIS IS NOT. It is not `ShareButton`. That component shares *the page
 * you are currently on* (`window.location.href`) and offers the native share
 * sheet first. This one copies *a URL it is handed*, which is the whole
 * distinction that matters here: the creator dashboard is at
 * `/dashboard/shop/...`, the link being copied is the public product address,
 * and on a Vercel Preview deployment `window.location` would yield a
 * `*.vercel.app` host. A component that reads its own location cannot be used
 * for this. The URL arrives as a prop, built by `lib/site-url`.
 *
 * COPY, NOT SHARE. No native share sheet. The share sheet is a system UI whose
 * outcome is invisible to the page — it cannot report success, and dismissing
 * it is indistinguishable from completing it. A creator who wants a link on
 * their clipboard should get a definite "copied" confirmation, and this
 * control sits next to a visible eye/preview action, so its behaviour needs to
 * be unambiguous rather than adaptive.
 *
 * LABELS COME FROM THE CALLER. No `useTranslations` here. The caller owns the
 * wording ("Copy link" / "نسخ الرابط") and its message keys, which keeps this
 * component free of translation state and lets the same control carry
 * different wording in a table row and a form field. It also means this file
 * introduces no message keys of its own.
 *
 * TELLS THE TRUTH ABOUT NOTHING ELSE. It has no idea whether the product is
 * approved, scanned, active or sellable, and it must not: the URL is reserved
 * for the product from creation and the creator may copy it at any point in
 * its life. Eligibility is decided server-side by `SAFE_DELIVERABLE_WHERE`,
 * and an ineligible product's page still refuses to render. Copying a link
 * grants nothing.
 *
 * NO NETWORK. No fetch, no server action, no file, storage, scan or provider
 * data. It receives a string and writes it to the clipboard.
 */

export interface CopyLinkButtonProps {
  /**
   * The absolute URL to copy. Build it with `productUrl()` from
   * `lib/site-url` — never from `window.location`.
   */
  url: string;
  /** Resting label, e.g. "Copy link" / "نسخ الرابط". */
  label: string;
  /** Confirmation label shown briefly after a successful copy. */
  copiedLabel: string;
  /** Accessible name. Defaults to `label`. */
  ariaLabel?: string;
  /** Replaces the default styling entirely when provided. */
  className?: string;
}

/** How long the confirmation stays on screen. */
const COPIED_FEEDBACK_MS = 2500;

const DEFAULT_CLASS =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-800/50 " +
  "hover:bg-gray-800 border border-gray-700 hover:border-gray-500 " +
  "text-gray-300 hover:text-white text-xs font-medium transition-colors " +
  "focus:outline-none focus:ring-2 focus:ring-teal-500/60";

/**
 * Last-resort copy for contexts where the async Clipboard API is missing or
 * refused: a permission denial, or any non-secure context, where
 * `navigator.clipboard` is simply `undefined`.
 *
 * `document.execCommand` is deprecated and still the only synchronous copy
 * every browser honours. It is reached only after the modern path has failed,
 * so the deprecation costs nothing and the fallback is what stops a denied
 * permission from becoming a dead button.
 *
 * The textarea is positioned off-screen rather than hidden: `display: none`
 * and `visibility: hidden` elements cannot be selected, so the copy would
 * silently do nothing. `readOnly` keeps the mobile keyboard down.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

export default function CopyLinkButton({
  url,
  label,
  copiedLabel,
  ariaLabel,
  className,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing on unmount matters because the confirmation outlives a click by
  // 2.5s and these buttons live in a list that re-renders as products change.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const confirm = useCallback(() => {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, []);

  const copy = useCallback(async () => {
    // 1. Async Clipboard API — the normal path on every current browser over
    //    HTTPS, which is every environment SaiFlow is served from.
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        confirm();
        return;
      } catch {
        // Denied by permission policy, or the document was not focused.
        // Fall through rather than reporting a success that did not happen.
      }
    }

    // 2. Synchronous legacy copy.
    if (legacyCopy(url)) {
      confirm();
      return;
    }

    // 3. Nothing could write to the clipboard. Put the URL in front of the
    //    creator so it can be copied by hand — a prompt is a poor experience
    //    and a far better one than a button that appears to do nothing.
    if (typeof window !== "undefined") {
      window.prompt(label, url);
    }
  }, [url, label, confirm]);

  return (
    <button
      // Explicitly "button": this control is rendered inside the product edit
      // <form>, and the default "submit" would save the product on every copy.
      type="button"
      onClick={copy}
      aria-label={ariaLabel ?? label}
      // Direction-neutral by construction — flex + gap, no left/right margins —
      // so the same markup lays out correctly under Arabic RTL and English LTR.
      className={className ?? DEFAULT_CLASS}
    >
      {copied ? (
        <>
          <svg
            className="w-3.5 h-3.5 text-teal-400 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {/* role="status" announces the confirmation to screen readers, which
              otherwise get no signal that anything happened. */}
          <span className="text-teal-400" role="status">
            {copiedLabel}
          </span>
        </>
      ) : (
        <>
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
            />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
