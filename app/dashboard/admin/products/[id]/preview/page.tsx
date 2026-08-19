import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getLocale, getTranslations } from "next-intl/server";
import { authOptions } from "@/app/api/auth/authOptions";
import { isAdminEmail } from "@/lib/admin";
import { getAdminProductPreview } from "@/lib/admin-product-preview";
import type { ModeratorFileSafety } from "@/lib/moderator-file-status";
import { formatPrice } from "@/lib/formatPrice";
import { formatDate } from "@/lib/formatDate";

/**
 * The moderator's view of a product.
 *
 * WHAT THIS REPLACES. The products directory used to send "Open" to
 * /shop/[slug]/product/[productSlug] — the buyer's page. That page has always
 * required `moderationStatus: "APPROVED"`, so the PENDING products a moderator
 * opens the queue to look at answered 404, and Stage E2's sellability gate
 * widened the miss to anything whose file has not passed scanning. Approve and
 * reject were never affected; only the ability to look first.
 *
 * The fix is a separate internal page rather than a relaxation of the public
 * query. The storefront gate is untouched — this file does not import it, and
 * a moderator seeing an unapproved listing here changes nothing about what a
 * buyer can reach.
 *
 * NOT A STOREFRONT. There is no BuyButton, no checkout call and no purchase
 * path of any kind. A disabled placeholder stands where the buy card sits on
 * the public page, because a moderation screen that can take money is one
 * careless edit away from taking it by accident, and "we passed sellable
 * false" is not a guarantee — not rendering the component is.
 *
 * NO DELIVERABLE, EVER. The file itself is reached only through
 * /api/admin/inspect/[productId], which re-authorises the request, applies the
 * inspection policy and mints a signed URL that expires in a minute. This page
 * receives a reason and two booleans from lib/admin-product-preview.ts and
 * never sees a storage key, a URL or a scan column — check by reading: no
 * file-column identifier appears anywhere below.
 */

export const dynamic = "force-dynamic";

/**
 * The admin layout already sets these for the whole segment. Repeated here
 * because a page's own metadata is what survives if this route is ever moved,
 * and an internal view of unapproved listings must never be indexable.
 */
export const metadata: Metadata = {
  title: "Moderation preview",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminProductPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  /**
   * app/dashboard/admin/layout.tsx is the authorization boundary and already
   * performs exactly this check for every route in the segment. It is done
   * again here on purpose: this page renders content that is deliberately
   * outside the public gate, so its access rule should be legible in the file
   * that renders it and should survive the route being moved.
   */
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard");

  const { id } = await params;
  const product = await getAdminProductPreview(id);
  if (!product) notFound();

  const t = await getTranslations("admin");
  const locale = await getLocale();

  const image = product.thumbnailUrl ?? product.images?.[0] ?? null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-6">
          <Link
            href="/dashboard/admin/products"
            className="text-sm text-gray-500 transition-colors hover:text-gray-300"
          >
            ← {t("preview.back")}
          </Link>
          <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-amber-400">
            {t("preview.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            <bdi>{product.name}</bdi>
          </h1>
          <p className="mt-2 text-sm text-gray-500">{t("preview.notPublic")}</p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {/* Listing as submitted */}
          <section className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-300">
              {t("preview.listing")}
            </h2>

            <div className="flex h-[280px] items-center justify-center overflow-hidden rounded-lg border border-gray-800 bg-[#1a1a1a]">
              {image ? (
                <Image
                  src={image}
                  alt=""
                  aria-hidden="true"
                  width={1200}
                  height={800}
                  className="max-h-full w-auto object-contain"
                />
              ) : (
                <span className="text-sm text-gray-600">
                  {t("preview.noImage")}
                </span>
              )}
            </div>

            <dl className="mt-6 space-y-3 text-sm">
              <Row label={t("preview.shop")}>
                <bdi>{product.shop.name}</bdi>
              </Row>
              <Row label={t("preview.price")}>
                <bdi>{formatPrice(product.price, product.currency, locale)}</bdi>
              </Row>
              <Row label={t("directory.col.category")}>
                {product.category ?? "—"}
              </Row>
              <Row label={t("directory.col.created")}>
                {formatDate(product.createdAt, locale, {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </Row>
            </dl>

            <div className="mt-6 border-t border-gray-800 pt-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-300">
                {t("preview.description")}
              </h3>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-400">
                <bdi>
                  {product.description || t("preview.descriptionEmpty")}
                </bdi>
              </p>
            </div>
          </section>

          {/* Moderation facts */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-5">
              <h2 className="mb-3 text-sm font-semibold text-gray-300">
                {t("preview.moderation")}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    product.moderationStatus === "APPROVED"
                      ? "bg-green-500/10 text-green-400"
                      : product.moderationStatus === "PENDING"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {t(`directory.status.${product.moderationStatus}`)}
                </span>
                {!product.isActive && (
                  <span className="whitespace-nowrap rounded-md bg-gray-500/10 px-2 py-0.5 text-[11px] font-medium text-gray-400">
                    {t("preview.inactive")}
                  </span>
                )}
              </div>
            </div>

            <FileSafetyPanel
              safety={product.fileSafety}
              canInspect={product.canInspect}
              productId={product.id}
              t={t}
            />

            {/* Where the buy card sits on the public page. Deliberately inert:
                no purchase component is mounted and no checkout endpoint is
                referenced anywhere in this file. */}
            <div className="rounded-xl border border-dashed border-gray-800 bg-[#0f0f0f] p-5 text-center">
              <p className="text-lg font-semibold text-gray-500">
                <bdi>
                  {formatPrice(product.price, product.currency, locale)}
                </bdi>
              </p>
              <p
                aria-disabled="true"
                className="mt-3 select-none rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-500"
              >
                {t("preview.purchaseDisabled")}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-end text-gray-200">{children}</dd>
    </div>
  );
}

/**
 * The one thing this page exists to add.
 *
 * Every value comes from `moderatorFileSafety`, which is a thin mapping over
 * `deliverableGateReason` — the reviewed authority. Nothing here re-derives
 * safety, and nothing here gates anything: it tells a human what the gate will
 * do, and the gate itself is elsewhere and unchanged.
 */
function FileSafetyPanel({
  safety,
  canInspect,
  productId,
  t,
}: {
  safety: ModeratorFileSafety;
  canInspect: boolean;
  productId: string;
  t: (k: string) => string;
}) {
  const tone = {
    ok: "bg-green-500/10 text-green-400",
    waiting: "bg-blue-500/10 text-blue-300",
    attention: "bg-amber-500/10 text-amber-400",
    blocked: "bg-red-500/10 text-red-400",
  }[safety.tone];

  return (
    <div className="rounded-xl border border-gray-800 bg-[#0f0f0f] p-5">
      <h2 className="mb-3 text-sm font-semibold text-gray-300">
        {t("fileSafety.heading")}
      </h2>

      <span
        className={`inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${tone}`}
      >
        {t(`fileSafety.reason.${safety.reason}`)}
      </span>

      {/* Moderation and file safety are independent, and this sentence is
          where that is made explicit. Approve and reject stay available in
          every state; what changes is whether the decision reaches a buyer. */}
      <p className="mt-3 text-xs leading-relaxed text-gray-400">
        {safety.publishable
          ? t("fileSafety.publishable")
          : t("fileSafety.notPublishable")}
      </p>

      {canInspect ? (
        <a
          href={`/api/admin/inspect/${productId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5"
        >
          {t("directory.inspectFile")}
        </a>
      ) : (
        <p className="mt-4 text-xs text-gray-600">
          {t("fileSafety.noInspection")}
        </p>
      )}
    </div>
  );
}
