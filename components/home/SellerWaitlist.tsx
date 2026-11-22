"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

type Status = "idle" | "pending" | "ok" | "invalid" | "rate" | "error";

/**
 * Early-access sign-up for outside sellers. Buying stays on the browse path;
 * this form only collects an email for the seller launch.
 */
export function SellerWaitlist() {
  const t = useTranslations("home.waitlist");
  const locale = useLocale().startsWith("ar") ? "ar" : "en";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("pending");
    try {
      const res = await fetch("/api/seller-waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "homepage", locale }),
      });
      if (res.ok) {
        setEmail("");
        setStatus("ok");
        return;
      }
      if (res.status === 400) setStatus("invalid");
      else if (res.status === 429) setStatus("rate");
      else setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="pb-8 pt-4 sm:pb-12">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-teal-500/30 bg-gradient-to-br from-teal-500/15 via-[#111111] to-[#111111] p-8 sm:p-10">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{t("title")}</h2>
          <p className="mt-3 text-base leading-relaxed text-gray-300 sm:text-lg">{t("body")}</p>
          <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
            <label htmlFor="seller-waitlist-email" className="sr-only">
              {t("emailLabel")}
            </label>
            <input
              id="seller-waitlist-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("placeholder")}
              aria-label={t("emailLabel")}
              className="w-full rounded-lg border border-gray-800 bg-[#0a0a0a] px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <button
              type="submit"
              disabled={status === "pending"}
              className="inline-flex justify-center rounded-lg bg-teal-500 px-5 py-3 text-sm font-semibold text-[#0A1128] transition hover:bg-teal-400 disabled:opacity-60"
            >
              {status === "pending" ? t("pending") : t("submit")}
            </button>
          </form>
          <p className="mt-3 text-sm text-gray-400" role="status">
            {status === "ok" && <span className="text-teal-300">{t("success")}</span>}
            {status === "invalid" && t("invalid")}
            {status === "rate" && t("rateLimited")}
            {status === "error" && t("error")}
            {status === "idle" && t("note")}
          </p>
        </div>
      </div>
    </section>
  );
}
