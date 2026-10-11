import Link from "next/link";
import { LISTING_STANDARDS } from "@/lib/listing-standards";

/**
 * The listing standards as a compact checklist. No hooks, so a server page
 * and a client form can both render it; the caller passes the language.
 *
 * "seller": shown above the certification on the add and edit forms, with a
 * link to the full policy. "admin": shown on the review page as the questions
 * to answer before approving.
 */
export function ListingStandards({ ar, variant }: { ar: boolean; variant: "seller" | "admin" }) {
  const heading =
    variant === "seller"
      ? ar
        ? "معايير قبول المنتج"
        : "Listing standards"
      : ar
        ? "قبل الاعتماد، تحقّق من:"
        : "Before approving, check:";
  const footer =
    variant === "seller"
      ? ar
        ? "المنتجات التي لا تستوفي هذه المعايير تُرفض مع ذكر السبب، ويمكنك تعديلها وإعادة إرسالها للمراجعة."
        : "Products that miss these are rejected with a reason; you can fix them and send them back for review."
      : ar
        ? "إن لم يستوفِ المنتج أحدها، فارفضه مع ذكر السبب؛ يستطيع البائع تعديله وإعادة إرساله."
        : "If one is missed, reject with the reason; the seller can fix the product and send it back.";

  return (
    <div className="rounded-xl border border-white/10 bg-[#111] p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-200">{heading}</h2>
      <ul className="space-y-1.5 text-sm text-gray-400">
        {LISTING_STANDARDS.map((item) => (
          <li key={item.en} className="flex gap-2">
            <span aria-hidden="true" className="text-teal-400">
              ✓
            </span>
            <span>{ar ? item.ar : item.en}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gray-500">
        {footer}{" "}
        {variant === "seller" && (
          <Link href="/content-policy" target="_blank" className="text-teal-400 underline-offset-4 hover:underline">
            {ar ? "سياسة المحتوى" : "Content policy"}
          </Link>
        )}
      </p>
    </div>
  );
}
