"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * "Send the confirmation link again", shared by the login and signup pages.
 *
 * The server answers before it looks anything up (so it cannot reveal which
 * addresses are registered), which means a success here only says the request
 * was ACCEPTED, never that an email went out. So the button never disappears:
 * after a request it pauses for a minute, then offers itself again, and the
 * message says what is actually known. The server's own per-address limit
 * still caps how many emails one address can receive.
 */

const COOLDOWN_MS = 60_000;

type State = "idle" | "sending" | "requested" | "failed";

export function ResendVerification({ email, label }: { email: string; label: string }) {
  const t = useTranslations();
  const [state, setState] = useState<State>("idle");
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [coolingDown]);

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setState("requested");
        setCoolingDown(true);
      } else {
        setState("failed");
      }
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {state === "requested" && (
        <p className="text-sm text-teal-300" role="status">
          {t("auth.login.resendSent")}
        </p>
      )}
      {state === "failed" && (
        <p className="text-sm text-red-400" role="alert">
          {t("auth.login.resendError")}
        </p>
      )}
      <button
        type="button"
        onClick={resend}
        disabled={state === "sending" || coolingDown}
        className="text-sm font-medium text-teal-400 hover:text-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state === "sending" ? t("auth.login.resending") : coolingDown ? t("auth.login.resendWait") : label}
      </button>
    </div>
  );
}
