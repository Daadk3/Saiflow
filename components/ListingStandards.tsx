import Link from "next/link";
import { LISTING_STANDARDS, type ListingCheck } from "@/lib/listing-standards";

/**
 * The listing standards. No hooks, so a server page and a client form can
 * both render it; the caller passes the language.
 *
 * "seller": shown above the certification on the add and edit forms, as a
 * plain bulleted list with a link to the full policy. Nothing is ticked:
 * these are what the seller must do, not something already checked.
 *
 * "admin": the founder's "Before approving" checklist, from `checks`
 * computed on the server (lib/admin-product-preview). A green ✓ means the
 * server verified it, a red ✗ that it failed, a grey ○ that only a person
 * can judge it. It used to draw a ✓ beside every standard whatever the
 * product's state, which read as "all checked" when nothing was.
 */
export function ListingStandards({
  ar,
  variant,
  checks = [],
}: {
  ar: boolean;
  variant: "seller" | "admin";
  checks?: ListingCheck[];
}) {
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
      {variant === "seller" ? (
        <ul className="list-disc space-y-1.5 ps-5 text-sm text-gray-400">
          {LISTING_STANDARDS.map((item) => (
            <li key={item.en}>{ar ? item.ar : item.en}</li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {checks.map((check) => (
            <li key={check.key} className="flex gap-2">
              <CheckMark state={check.state} ar={ar} />
              <span className={check.state === "fail" ? "text-red-300" : check.state === "pass" ? "text-gray-300" : "text-gray-400"}>
                {ar ? check.label.ar : check.label.en}
                {check.state === "fail" && check.detail && (
                  <span className="block text-xs text-red-400/80">{check.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
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

/** The mark and what it means, for screen readers too. */
function CheckMark({ state, ar }: { state: ListingCheck["state"]; ar: boolean }) {
  const [mark, color, said] =
    state === "pass"
      ? ["✓", "text-teal-400", ar ? "تم التحقق" : "Verified"]
      : state === "fail"
        ? ["✗", "text-red-400", ar ? "غير مستوفى" : "Not met"]
        : ["○", "text-gray-500", ar ? "تحقّق يدويًا" : "Check manually"];
  return (
    <span className={`shrink-0 ${color}`}>
      <span aria-hidden="true">{mark}</span>
      <span className="sr-only">{said}: </span>
    </span>
  );
}
