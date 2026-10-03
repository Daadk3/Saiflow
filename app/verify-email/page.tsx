"use client";

import { FormEvent, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The page a verification email links to.
 *
 * Opening it changes nothing: the link is a GET, and mail scanners fetch GET
 * links. Verification happens only when the account's password is submitted
 * here, because the token alone would let someone who registered another
 * person's address get that person to confirm it with a single click.
 */

const ERROR_KEYS: Record<string, string> = {
  wrong_password: "auth.verifyEmail.errorWrongPassword",
  expired: "auth.verifyEmail.errorExpired",
  invalid: "auth.verifyEmail.errorInvalid",
  rate_limited: "auth.verifyEmail.errorRateLimited",
};

function VerifyEmailForm() {
  const t = useTranslations();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === "verified") {
        setVerified(true);
      } else {
        setError(t(ERROR_KEYS[data?.error] ?? "auth.verifyEmail.errorGeneric"));
      }
    } catch {
      setError(t("auth.verifyEmail.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white mb-2">{t("auth.verifyEmail.title")}</h1>
        <p className="text-gray-400 mb-6">{t("auth.verifyEmail.missingToken")}</p>
        <Link
          href="/login"
          className="inline-block w-full py-3 px-4 bg-teal-500 hover:bg-teal-400 text-white font-semibold rounded-xl transition-colors text-center"
        >
          {t("auth.backToLogin")}
        </Link>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="text-center" role="status">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-500/10 mb-6">
          <svg className="w-8 h-8 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">{t("auth.verifyEmail.successTitle")}</h1>
        <p className="text-gray-400 mb-6">{t("auth.verifyEmail.successBody")}</p>
        <Link
          href="/login"
          className="inline-block w-full py-3 px-4 bg-teal-500 hover:bg-teal-400 text-white font-semibold rounded-xl transition-colors text-center"
        >
          {t("auth.verifyEmail.successCta")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white">{t("auth.verifyEmail.title")}</h1>
        <p className="mt-2 text-gray-500">{t("auth.verifyEmail.subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
            {t("auth.password")}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder={t("auth.verifyEmail.passwordPlaceholder")}
            className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-800 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
          />
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl" role="alert">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 bg-teal-500 hover:bg-teal-400 disabled:bg-teal-500/50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors duration-200"
        >
          {loading ? t("auth.verifyEmail.submitting") : t("auth.verifyEmail.submit")}
        </button>
      </form>

      <p className="mt-6 text-sm text-gray-500 leading-relaxed">{t("auth.verifyEmail.notYours")}</p>

      <p className="mt-6 text-center">
        <Link href="/login" className="text-gray-500 hover:text-teal-400 text-sm transition-colors">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-[#111111] rounded-2xl border border-gray-800/50 shadow-2xl shadow-black/50 p-8">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500"></div>
                </div>
              }
            >
              <VerifyEmailForm />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
