"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

/**
 * Sign out in one click.
 *
 * `signOut({ callbackUrl })` started the sign-out and navigated in the same
 * breath, so a first click could land back on a page that was still rendered
 * for the signed-in user, and it looked as if nothing happened. This waits
 * for NextAuth to clear the session cookie, then does a full page load of the
 * home page, so nothing rendered while signed in survives. The button is
 * disabled while that happens, so a second click cannot race the first.
 */
export function SignOutButton({ className, onStart }: { className?: string; onStart?: () => void }) {
  const t = useTranslations("nav");
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    onStart?.();
    try {
      await signOut({ redirect: false });
    } finally {
      // Whatever happened, leave the signed-in page: a full load re-reads the
      // session from the server, which is the only answer that counts.
      window.location.assign("/");
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={busy} aria-busy={busy} className={className}>
      {busy ? t("signingOut") : t("signOut")}
    </button>
  );
}
