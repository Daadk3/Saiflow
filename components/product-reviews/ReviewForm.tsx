"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const ERRORS = {
  invalid: "invalidLink",
  expired: "expired",
  not_allowed: "notAllowed",
  unauthorized: "signInBody",
  too_long: "tooLong",
  markup: "markup",
  contact: "contact",
  rate_limited: "rateLimited",
  error: "error",
} as const;
type FormError = keyof typeof ERRORS;

function isFormError(value: unknown): value is FormError {
  return typeof value === "string" && value in ERRORS;
}

/**
 * Stars plus an optional plain-text note. The server decides whether this
 * purchase may review; the form only sends what the buyer typed.
 */
export function ReviewForm({
  productId,
  productName,
  token,
  orderId,
  initialStars,
  initialBody,
  hidden,
}: {
  productId: string;
  productName: string;
  token?: string;
  orderId?: string;
  initialStars: number | null;
  initialBody: string | null;
  hidden: boolean;
}) {
  const t = useTranslations("reviews");
  const editing = initialStars !== null;
  const [stars, setStars] = useState<number | null>(initialStars);
  const [body, setBody] = useState(initialBody ?? "");
  const [state, setState] = useState<"idle" | "sending" | "saved" | FormError>("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (stars === null) {
      setState("error");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId,
          stars,
          body,
          ...(token ? { token } : { orderId }),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setState(isFormError(data?.error) ? data.error : "error");
        return;
      }
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">{editing ? t("formEditTitle") : t("formTitle")}</h1>
        <p className="mt-2 text-sm text-gray-400">
          {t("productLabel")} <bdi className="text-white">{productName}</bdi>
        </p>
      </div>

      {hidden && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{t("hiddenNote")}</p>}

      <fieldset>
        <legend className="text-sm font-medium text-gray-200">{t("starsLabel")}</legend>
        <div className="mt-2 flex gap-2" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = stars !== null && n <= stars;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={stars === n}
                aria-label={t("starOption", { n })}
                onClick={() => setStars(n)}
                className={`h-11 w-11 rounded-lg border text-lg ${
                  selected ? "border-amber-400/60 bg-amber-400/15 text-amber-300" : "border-gray-700 text-gray-500 hover:border-gray-500"
                }`}
              >
                ★
              </button>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor="review-body" className="text-sm font-medium text-gray-200">
          {t("bodyLabel")}
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={500}
          rows={5}
          dir="auto"
          className="mt-2 w-full rounded-xl border border-gray-700 bg-[#0a0a0a] px-3 py-2 text-sm text-white"
        />
        <p className="mt-1 text-xs text-gray-500">{t("bodyHint")}</p>
      </div>

      {state === "saved" && <p className="text-sm text-teal-300">{t("saved")}</p>}
      {state !== "idle" && state !== "sending" && state !== "saved" && (
        <p className="text-sm text-amber-300">{state === "error" && stars === null ? t("invalidStars") : t(ERRORS[state])}</p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-400 disabled:opacity-60"
      >
        {editing ? t("update") : t("submit")}
      </button>
    </form>
  );
}
