import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { authorizeHostedAccessRequest } from "@/lib/hosted-access/server";
import { rateLimiters } from "@/lib/rate-limit";
import { RECEIPT_LINK_TTL_DAYS } from "@/lib/download-links";

/**
 * The secure delivery page for a hosted-access product (e.g. an AI agent the
 * seller hosts). The buyer's equivalent of a download.
 *
 * Every render re-authorises from the persisted, verified Order
 * (lib/hosted-access/authorize). Nothing is cached, nothing is indexed, and
 * the page never redirects to the seller's link or fetches it: the link is
 * shown as an anchor the buyer opens in a new tab with no referrer, so the
 * credential in this page's own URL never travels to the seller's site.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Your access",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : "__ambiguous__";
  return value ?? null;
}

export default async function HostedAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("hostedAccess.delivery");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const limited = !rateLimiters.api(ip).success;

  const { productId } = await params;
  const query = await searchParams;
  const decision = limited
    ? ({ ok: false, reason: "not_authorized" } as const)
    : await authorizeHostedAccessRequest({
        productId,
        ref: first(query.ref),
        token: first(query.t),
        purchase: first(query.purchase),
      });

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-16 text-white">
      <main className="w-full max-w-lg rounded-2xl border border-gray-800 bg-[#111111] p-8">
        {decision.ok ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-400">{t("eyebrow")}</p>
            <h1 className="mt-2 text-2xl font-bold" dir="auto">
              {decision.productName}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {t("soldBy")} <bdi>{decision.shopName}</bdi>
              {decision.testOrder && <span className="ms-2 text-amber-400">{t("testOrder")}</span>}
            </p>
            <p className="mt-4 text-sm text-gray-400">{t("whatThisIs")}</p>

            <a
              href={decision.accessUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-teal-400"
            >
              {t("openCta")}
              <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
            <p className="mt-2 break-all text-center text-xs text-gray-500" dir="ltr">
              {new URL(decision.accessUrl).host}
            </p>

            {decision.instructions && (
              <section className="mt-6 rounded-xl border border-gray-800 bg-[#0a0a0a] p-4">
                <h2 className="text-sm font-semibold text-gray-300">{t("instructionsTitle")}</h2>
                <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm text-gray-300 [unicode-bidi:plaintext]">
                  {decision.instructions}
                </p>
              </section>
            )}

            <ul className="mt-6 space-y-1 text-xs text-gray-500">
              <li>{t("noteHostedBySeller")}</li>
              <li>{t("noteKeepPrivate")}</li>
              <li>{t("noteComeBack")}</li>
            </ul>
          </>
        ) : (
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t(`refused.${decision.reason}.title`)}</h1>
            <p className="mt-3 text-gray-400">{t(`refused.${decision.reason}.body`, { days: RECEIPT_LINK_TTL_DAYS })}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/login?callbackUrl=/dashboard/purchases"
                className="rounded-lg bg-teal-500 px-5 py-2.5 font-medium text-white hover:bg-teal-400"
              >
                {t("signIn")}
              </Link>
            </div>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-gray-500">
          {t("support")}{" "}
          <a href="mailto:support@saiflow.io" className="text-teal-400 hover:underline" dir="ltr">
            support@saiflow.io
          </a>
        </p>
      </main>
    </div>
  );
}
