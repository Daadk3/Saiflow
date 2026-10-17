/**
 * Ready-made rejection reasons for the founder's reject dialog.
 *
 * The first five follow the listing standards (lib/listing-standards), so a
 * rejection names the standard the product missed in the words the seller
 * already saw on their add-product form. The sixth is the commonest file
 * problem seen live: a PDF exported with JavaScript inside, which the scanner
 * refuses.
 *
 * Each reason is bilingual, Arabic first, because the seller's email carries
 * the reason exactly as written. The founder can edit it before sending.
 *
 * Pure and client-safe.
 */
export interface QuickReason {
  id: string;
  ar: string;
  en: string;
}

export const QUICK_REJECTION_REASONS: readonly QuickReason[] = [
  {
    id: "file_mismatch",
    ar: "الملف لا يطابق عنوان المنتج ووصفه. ارفع الملف الذي يصفه الإعلان.",
    en: "The file doesn't match the product's title and description. Upload the file the listing describes.",
  },
  {
    id: "no_real_preview",
    ar: "لا توجد صورة عرض من المحتوى الفعلي. أضف صورة من داخل المنتج، لا شعارًا فقط.",
    en: "There's no preview image of the actual content. Add a picture from inside the product, not just a logo.",
  },
  {
    id: "placeholder_file",
    ar: "الملف تجريبي أو مؤقت أو فارغ. ارفع الملف النهائي الذي سيستلمه المشتري.",
    en: "The file is a test, placeholder or empty file. Upload the final file the buyer will receive.",
  },
  {
    id: "missing_whats_included",
    ar: "الوصف لا يوضح ما يحتويه المنتج. اذكر الصيغة وعدد الصفحات أو الملفات وطريقة الاستخدام.",
    en: "The description doesn't say what's included. State the format, the number of pages or files, and how to use it.",
  },
  {
    id: "dishonest_listing",
    ar: "الإعلان لا يصف بصدق ما سيستلمه المشتري. عدّل العنوان والوصف ليطابقا الملف.",
    en: "The listing isn't honest about what the buyer receives. Edit the title and description to match the file.",
  },
  {
    id: "pdf_javascript",
    ar: "الملف يحتوي على أكواد برمجية (JavaScript) مضمّنة، وهذا غير مسموح لحماية المشترين. أعد تصديره كملف PDF عادي (مثلًا: «طباعة ← حفظ كـ PDF»، أو من Canva بصيغة «PDF للطباعة») ثم ارفعه من صفحة تعديل المنتج.",
    en: "The file contains embedded JavaScript, which isn't allowed to protect buyers. Re-export it as a plain PDF (e.g. Print → Save as PDF, or Canva's \"PDF Print\") and upload it again from the product's Edit page.",
  },
];

/** The reason as it goes into the email and the audit log: Arabic, then English. */
export function quickReasonText(reason: QuickReason): string {
  return `${reason.ar}\n${reason.en}`;
}
