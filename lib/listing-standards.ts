/**
 * SaiFlow's listing standards: what every product must meet to be approved.
 *
 * One list, shown in three places so they can never disagree: the content
 * policy (the rule), the seller's add and edit forms (before they submit),
 * and the founder's review page (while deciding). Added after an approved
 * product turned out to be a logo sold as a 100 SAR website template.
 *
 * These are checked by a person at review; nothing here is enforced in code.
 * A product that misses one is rejected with a reason, and the seller can fix
 * it and save to send it back for review. A buyer whose product is
 * materially different from its description is entitled to a refund under
 * the refund policy.
 */
export const LISTING_STANDARDS: ReadonlyArray<{ ar: string; en: string }> = [
  {
    ar: "الملف يطابق العنوان والوصف: ما يراه المشتري هو ما يستلمه.",
    en: "The file matches the title and description: what the buyer sees is what they get.",
  },
  {
    ar: "الوصف يوضح بدقة ما يحتويه المنتج: الصيغة، وعدد الصفحات أو الملفات، وطريقة الاستخدام.",
    en: "The description says exactly what is included: the format, the number of pages or files, and how to use it.",
  },
  {
    ar: "صورة عرض واحدة على الأقل من المحتوى الفعلي، وليست شعارًا فقط.",
    en: "At least one preview image of the actual content, not just a logo.",
  },
  {
    ar: "لا ملفات تجريبية أو مؤقتة أو فارغة.",
    en: "No test, placeholder or empty files.",
  },
  {
    ar: "السعر يحدده البائع، لكن يجب أن يكون الإعلان صادقًا فيما يستلمه المشتري.",
    en: "The price is the seller's to set, but the listing must be honest about what the buyer receives.",
  },
];

/**
 * The shortest description the review checklist counts as describing the
 * product (trimmed characters). Below it, "describes what's included" can't
 * be true; above it, a person still has to read it.
 */
export const MIN_DESCRIPTION_LENGTH = 80;

/**
 * One line of the founder's "Before approving" checklist.
 *
 * `pass` and `fail` are facts the server checked (lib/admin-product-preview);
 * `manual` is a standard only a person can judge, shown with a neutral mark
 * and never a tick. Nothing renders a ✓ the server did not verify.
 */
export interface ListingCheck {
  key: string;
  label: { ar: string; en: string };
  state: "pass" | "fail" | "manual";
  /** Why a check failed, already in the reader's language; set by the page. */
  detail?: string;
}

/** The checks the server can verify, by key, with their labels. */
export const AUTOMATIC_CHECK_LABELS = {
  file_safe: { ar: "ملف المنتج اجتاز فحص الأمان.", en: "The product file passed its safety check." },
  preview_image: { ar: "توجد صورة عرض للمنتج.", en: "There is a preview image." },
  description_length: {
    ar: `الوصف ${MIN_DESCRIPTION_LENGTH} حرفًا على الأقل.`,
    en: `The description is at least ${MIN_DESCRIPTION_LENGTH} characters.`,
  },
} as const;
