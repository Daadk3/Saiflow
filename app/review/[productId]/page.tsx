import type { Metadata } from "next";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { ReviewForm } from "@/components/product-reviews/ReviewForm";
import { prepareReviewForm } from "@/lib/reviews/authorize";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The review form. A signed token (receipt or success page) or a signed-in
 * buyer opening one of their own orders. Anything else is an explanation,
 * never a form.
 */
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ t?: string; purchase?: string }>;
}) {
  const { productId } = await params;
  const query = await searchParams;
  const t = await getTranslations("reviews");
  const token = query.t;
  const orderId = token ? undefined : query.purchase;
  const session = token ? null : await getServerSession(authOptions);
  const draft = await prepareReviewForm({
    productId,
    token,
    orderId,
    sessionEmail: session?.user?.email ?? null,
    secret: process.env.NEXTAUTH_SECRET,
  });

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-lg px-4 py-12">
        {draft.ok ? (
          <ReviewForm
            productId={productId}
            productName={draft.productName}
            token={draft.token}
            orderId={draft.orderId}
            initialStars={draft.stars}
            initialBody={draft.body}
            hidden={draft.hidden}
          />
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-[#111] p-6">
            <h1 className="text-xl font-bold">{t("formTitle")}</h1>
            <p className="mt-3 text-sm text-gray-300">
              {draft.error === "expired"
                ? t("expired")
                : draft.error === "not_allowed"
                  ? t("notAllowed")
                  : draft.error === "unauthorized"
                    ? t("signInBody")
                    : t("invalidLink")}
            </p>
            {draft.error === "unauthorized" && (
              <Link href={`/login?callbackUrl=${encodeURIComponent(`/review/${productId}?purchase=${orderId ?? ""}`)}`} className="mt-4 inline-block text-teal-400">
                {t("signIn")}
              </Link>
            )}
            <Link href="/dashboard/purchases" className="mt-4 block text-sm text-gray-500 hover:text-gray-300">
              {t("purchasesLink")}
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
