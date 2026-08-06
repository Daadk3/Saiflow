"use client";

import { useState } from "react";
import { useLocale } from "next-intl";

// Share a permanent public URL (storefront or product).
// Preference order: native share sheet (mobile) → clipboard → visible prompt.
export default function ShareButton({ title }: { title: string }) {
  const ar = useLocale().startsWith("ar");
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;

    // 1. Native share sheet where supported (iOS/Android)
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user dismissed the sheet — not an error, and no fallback needed
        return;
      }
    }

    // 2. Clipboard with success feedback
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // 3. Last-resort fallback for old/locked-down browsers
      window.prompt(ar ? "انسخ الرابط:" : "Copy this link:", url);
    }
  }

  return (
    <button
      onClick={share}
      aria-label={ar ? "مشاركة الرابط" : "Share link"}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#222] border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white text-sm font-medium transition-colors"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-teal-400" role="status">
            {ar ? "تم نسخ الرابط ✓" : "Link copied ✓"}
          </span>
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342a3 3 0 100-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684zm0-9.316a3 3 0 105.368-2.684 3 3 0 00-5.368 2.684z" />
          </svg>
          <span>{ar ? "مشاركة" : "Share"}</span>
        </>
      )}
    </button>
  );
}
