/**
 * The founder's 8-point product review checklist.
 *
 * Shown on every pending card in the review queue and on the admin preview
 * page. Three points have automatic checks (3, 6 and 7), computed when the
 * seller submits and again when the file scan settles, and stored on the
 * product (Product.reviewChecks). The other five are for a person only.
 *
 * AUTO-CHECKS ONLY FLAG. Nothing in this module, or anything that reads it,
 * changes moderationStatus. Approval and rejection stay a human decision in
 * /api/admin/moderation/[productId], exactly as before. A ✅ here is not an
 * approval and a ⚠️ is not a rejection.
 *
 * Pure and client-safe: no Prisma, no Node APIs. The file-side facts it reads
 * come from lib/file-facts, which runs in the scan pipeline.
 */

export type ChecklistPointId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ChecklistPoint {
  id: ChecklistPointId;
  /** The label on the checklist. */
  label: string;
  /**
   * The sentence the seller reads when the founder ticks this point as
   * failed. Written to the seller, in Arabic, and never naming anyone.
   */
  rejection: string;
}

export const REVIEW_CHECKLIST: readonly ChecklistPoint[] = [
  {
    id: 1,
    label: "يطابق الوصف",
    rejection: "الملف لا يطابق عنوان المنتج ووصفه. ارفع الملف الذي يصفه الإعلان، أو عدّل الوصف ليطابقه.",
  },
  {
    id: 2,
    label: "محتوى كافٍ",
    rejection: "محتوى المنتج قليل مقارنة بما يُعرض للمشتري. أضف محتوى أكثر أو وضّح حجمه الحقيقي في الوصف.",
  },
  {
    id: 3,
    label: "الملف آمن ويفتح والعربي سليم",
    rejection: "الملف لا يفتح بشكل سليم أو لم يجتز فحص الأمان أو يظهر النص العربي فيه بشكل غير صحيح. أعد تصدير الملف وتأكد من فتحه قبل رفعه.",
  },
  {
    id: 4,
    label: "عمل البائع نفسه",
    rejection: "لم نتمكن من التأكد أن المحتوى من عملك. لا نقبل إلا المنتجات التي أعددتها بنفسك أو تملك حق بيعها.",
  },
  {
    id: 5,
    label: "محتوى لائق (لا ديني/سياسي/غير لائق)",
    rejection: "المنتج يحتوي على محتوى غير مسموح (ديني أو سياسي أو غير لائق). أزل هذا المحتوى ثم أعد إرسال المنتج.",
  },
  {
    id: 6,
    label: "لا إعلانات أو تواصل خارجي",
    rejection: "المنتج يحتوي على وسيلة تواصل أو إعلان خارجي (رقم أو بريد أو رابط أو حساب). أزلها من العنوان والوصف والملف؛ التواصل يتم داخل SaiFlow فقط.",
  },
  {
    id: 7,
    label: "نوع مسموح (لا حل واجبات أو بحوث جاهزة أو شهادات مزيفة)",
    rejection: "هذا النوع من المنتجات غير مسموح على SaiFlow (حل واجبات أو بحوث جاهزة أو شهادات).",
  },
  {
    id: 8,
    label: "وصف وغلاف صادقان",
    rejection: "الوصف أو صورة الغلاف لا يعكسان ما سيستلمه المشتري بصدق. عدّلهما ليطابقا المنتج الفعلي.",
  },
];

/** The points with automatic checks. Every other point is manual review. */
export const AUTO_CHECKED_POINTS: readonly ChecklistPointId[] = [3, 6, 7];

export const MANUAL_REVIEW_LABEL = "مراجعة يدوية";

/** The signature on every rejection message: the team, never a person. */
export const TEAM_SIGNATURE = "فريق SaiFlow";

export function isChecklistPointId(value: unknown): value is ChecklistPointId {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 8;
}

/* ------------------------------------------------------------------ */
/* Text checks (points 6 and 7)                                        */
/* ------------------------------------------------------------------ */

/** What the contact search can find, by code. Codes are what get stored. */
export const CONTACT_FLAGS = {
  phone: "رقم هاتف",
  email: "بريد إلكتروني",
  url: "رابط",
  handle: "حساب @",
  social: "واتساب/سناب/انستقرام/تيليجرام",
  phrase: "عبارة تواصل",
} as const;
export type ContactFlag = keyof typeof CONTACT_FLAGS;

export const BANNED_TYPE_FLAGS = {
  homework: "حل واجبات",
  ready_research: "بحوث جاهزة",
  research_writing: "كتابة بحث",
  exam_solving: "حل اختبار",
  certificate: "شهادة",
} as const;
export type BannedTypeFlag = keyof typeof BANNED_TYPE_FLAGS;

/**
 * Text as the patterns expect it: Arabic-Indic digits as ASCII, presentation
 * forms folded (NFKC), diacritics and tatweel removed, alef variants unified.
 * Applied to the title and description as typed and to text pulled from a
 * file, so "تَواصَل معنا" and "٠٥٥١٢٣٤٥٦٧" are found like their plain forms.
 */
export function normaliseForChecks(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا");
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_PATTERN =
  /\bhttps?:\/\/|\bwww\.[a-z0-9-]+|\b[a-z0-9-]+\.(?:com|net|org|sa|io|me|ly|co|app|link|store|shop|info|biz|xyz)\b|\bwa\.me\b|\bt\.me\b|\bbit\.ly\b/i;
const HANDLE = /(?:^|[^A-Za-z0-9_@.])@[A-Za-z0-9_.]{3,30}/;
const SOCIAL =
  /whats\s*app|snap\s*chat|insta\s*gram|\binsta\b|tele\s*gram|\btiktok\b|واتس|وتساب|سناب|انستا|انستقرام|انستغرام|انستجرام|تيليجرام|تيلجرام|تليجرام|تلغرام|تلجرام/i;
const CONTACT_PHRASES = /تواصل\s*معنا|تواصل\s*معي|عبر\s*الخاص|على\s*الخاص|بالخاص|راسلنا|راسلني/;
/** A run of digits and separators; counted as a phone when it holds 9–15 digits. */
const DIGIT_RUN = /\+?\d[\d\s\-().]{6,}\d/g;

export function findContactInfo(raw: string): ContactFlag[] {
  const text = normaliseForChecks(raw);
  const found = new Set<ContactFlag>();
  if (new RegExp(EMAIL.source).test(text)) found.add("email");
  // An email's domain must not also count as a link, nor its @ as a handle.
  const rest = text.replace(EMAIL, " ");
  if (URL_PATTERN.test(rest)) found.add("url");
  if (HANDLE.test(rest)) found.add("handle");
  if (SOCIAL.test(rest)) found.add("social");
  if (CONTACT_PHRASES.test(rest)) found.add("phrase");
  for (const match of rest.match(DIGIT_RUN) ?? []) {
    const digits = match.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15) {
      found.add("phone");
      break;
    }
  }
  return order(found, CONTACT_FLAGS);
}

const BANNED_PATTERNS: Record<BannedTypeFlag, RegExp> = {
  homework: /حل\s*(?:ال)?واجب/,
  ready_research: /(?:بحوث|ابحاث|بحث)\s*(?:ال)?جاهز/,
  research_writing: /كتابه?\s*(?:ال)?(?:بحث|بحوث|ابحاث)|كتابة\s*(?:ال)?(?:بحث|بحوث|ابحاث)/,
  exam_solving: /حل\s*(?:ال)?(?:اختبار|امتحان)/,
  certificate: /شهاد[ةه]|شهادات/,
};

export function findBannedTypes(raw: string): BannedTypeFlag[] {
  const text = normaliseForChecks(raw);
  const found = new Set<BannedTypeFlag>();
  for (const [flag, pattern] of Object.entries(BANNED_PATTERNS) as [BannedTypeFlag, RegExp][]) {
    if (pattern.test(text)) found.add(flag);
  }
  return order(found, BANNED_TYPE_FLAGS);
}

function order<K extends string>(found: Set<K>, labels: Record<K, string>): K[] {
  return (Object.keys(labels) as K[]).filter((key) => found.has(key));
}

/* ------------------------------------------------------------------ */
/* Stored results                                                      */
/* ------------------------------------------------------------------ */

/**
 * Facts about the file's bytes, written by the scan pipeline onto its
 * FileAsset row (lib/file-facts). Codes and counts only: never file contents.
 */
export interface FileContentFacts {
  /** The family the bytes were recognised as, or null when unrecognised. */
  kind: string | null;
  /** Whether the file could be read as what it claims to be. */
  opens: boolean;
  /** PDFs only: pages found. Null for other kinds or when it could not be counted. */
  pageCount: number | null;
  /** Whether enough text was pulled out of the file for the text checks to mean anything. */
  textChecked: boolean;
  contact: ContactFlag[];
  banned: BannedTypeFlag[];
}

export type Source = "title" | "description" | "file";

export const SOURCE_LABELS: Record<Source, string> = {
  title: "العنوان",
  description: "الوصف",
  file: "الملف",
};

/** One auto-check result as stored. `state` is all the card needs to draw ✅ or ⚠️. */
export interface StoredCheck {
  state: "ok" | "warn";
  /** A short Arabic reason, already written for the founder. */
  reason: string;
}

/** Product.reviewChecks. Versioned so a later shape can be told apart. */
export interface StoredReviewChecks {
  version: 1;
  computedAt: string;
  /** The file the file-side facts describe; a different current file makes them stale. */
  fileKey: string | null;
  points: { 3: StoredCheck; 6: StoredCheck; 7: StoredCheck };
}

export interface ReviewCheckInput {
  name: string;
  description: string | null;
  fileKey: string | null;
  fileScanStatus: string;
  fileScanKey: string | null;
  /** The facts on the FileAsset for `fileKey`, or null when the scan has not produced them. */
  facts: FileContentFacts | null;
  now?: Date;
}

const SCAN_STATE_REASON: Record<string, string> = {
  PENDING_SCAN: "بانتظار فحص الأمان",
  UNSAFE: "لم يجتز فحص الأمان",
  SCAN_ERROR: "تعذر إكمال فحص الأمان",
};

const ARABIC_NOTE = "سلامة العربي تُراجع يدويًا";

function pointThree(input: ReviewCheckInput): StoredCheck {
  if (!input.fileKey) return { state: "warn", reason: "لا يوجد ملف مرفق" };
  const current = input.fileScanKey === input.fileKey;
  const status = current ? input.fileScanStatus : "PENDING_SCAN";
  if (status !== "SAFE") {
    return { state: "warn", reason: SCAN_STATE_REASON[status] ?? SCAN_STATE_REASON.PENDING_SCAN };
  }
  const facts = input.facts;
  if (!facts) return { state: "warn", reason: `اجتاز فحص الأمان · لم يُتحقق من فتح الملف بعد` };
  if (!facts.opens) return { state: "warn", reason: "اجتاز فحص الأمان · لكن الملف لا يفتح بشكل سليم" };
  if (facts.kind === "pdf") {
    if (!facts.pageCount) return { state: "warn", reason: "اجتاز فحص الأمان · تعذر عدّ صفحات PDF" };
    return { state: "ok", reason: `آمن · يفتح · ${pageWord(facts.pageCount)} · ${ARABIC_NOTE}` };
  }
  return { state: "ok", reason: `آمن · يفتح · ${ARABIC_NOTE}` };
}

function pageWord(n: number): string {
  if (n === 1) return "صفحة واحدة";
  if (n === 2) return "صفحتان";
  return n <= 10 ? `${n} صفحات` : `${n} صفحة`;
}

function textPoint<F extends string>(
  input: ReviewCheckInput,
  find: (text: string) => F[],
  fileFlags: F[] | undefined,
  labels: Record<F, string>,
  clean: string
): StoredCheck {
  const hits: string[] = [];
  const describe = (flags: F[], source: Source) => {
    if (flags.length) hits.push(`${flags.map((f) => labels[f]).join("، ")} (${SOURCE_LABELS[source]})`);
  };
  describe(find(input.name), "title");
  describe(find(input.description ?? ""), "description");
  const fileChecked = Boolean(input.facts?.textChecked);
  if (fileChecked) describe(fileFlags ?? [], "file");

  if (hits.length) return { state: "warn", reason: `وُجد: ${hits.join(" · ")}` };
  if (!fileChecked) {
    const why = !input.facts ? "لم يُفحص نص الملف بعد" : "تعذر استخراج نص الملف";
    return { state: "warn", reason: `لا شيء في العنوان والوصف · ${why}` };
  }
  return { state: "ok", reason: clean };
}

export function computeReviewChecks(input: ReviewCheckInput): StoredReviewChecks {
  return {
    version: 1,
    computedAt: (input.now ?? new Date()).toISOString(),
    fileKey: input.fileKey,
    points: {
      3: pointThree(input),
      6: textPoint(input, findContactInfo, input.facts?.contact, CONTACT_FLAGS, "لا أرقام أو روابط أو حسابات في العنوان والوصف والملف"),
      7: textPoint(input, findBannedTypes, input.facts?.banned, BANNED_TYPE_FLAGS, "لا كلمات لنوع غير مسموح في العنوان والوصف والملف"),
    },
  };
}

/* ------------------------------------------------------------------ */
/* What the founder sees                                               */
/* ------------------------------------------------------------------ */

export interface ChecklistRow {
  id: ChecklistPointId;
  label: string;
  state: "ok" | "warn" | "manual";
  reason: string;
}

/** Narrow an untyped JSON column to StoredReviewChecks, or null. */
export function readStoredChecks(value: unknown): StoredReviewChecks | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<StoredReviewChecks>;
  if (v.version !== 1 || !v.points) return null;
  for (const id of AUTO_CHECKED_POINTS) {
    const point = (v.points as Record<number, StoredCheck | undefined>)[id];
    if (!point || (point.state !== "ok" && point.state !== "warn") || typeof point.reason !== "string") return null;
  }
  return v as StoredReviewChecks;
}

/**
 * The eight rows for one product. A product with no stored result (submitted
 * before this checklist existed) shows its auto points as not yet checked
 * rather than as passed. Stored results for a file the product no longer has
 * are shown as stale for the same reason.
 */
export function checklistRows(stored: unknown, currentFileKey: string | null): ChecklistRow[] {
  const checks = readStoredChecks(stored);
  const stale = checks !== null && checks.fileKey !== currentFileKey;
  return REVIEW_CHECKLIST.map((point) => {
    if (!AUTO_CHECKED_POINTS.includes(point.id)) {
      return { id: point.id, label: point.label, state: "manual", reason: MANUAL_REVIEW_LABEL };
    }
    if (!checks) return { id: point.id, label: point.label, state: "warn", reason: "لم يُفحص بعد" };
    if (stale) return { id: point.id, label: point.label, state: "warn", reason: "الملف تغيّر · بانتظار فحص جديد" };
    const result = checks.points[point.id as 3 | 6 | 7];
    return { id: point.id, label: point.label, state: result.state, reason: result.reason };
  });
}

/**
 * The seller's rejection message, built from the points the founder ticked.
 * Arabic, one line per point in checklist order, signed by the team. The
 * founder can edit it before sending; this is only the starting text.
 */
export function buildRejectionMessage(failed: readonly ChecklistPointId[]): string {
  const points = REVIEW_CHECKLIST.filter((point) => failed.includes(point.id));
  if (points.length === 0) return "";
  // The seller's email already names the product and says how to send it
  // back for review (lib/notify), so the message is the reasons and the
  // signature only.
  return [
    "لم نتمكن من اعتماد منتجك للأسباب التالية:",
    ...points.map((point) => `• ${point.rejection}`),
    "",
    TEAM_SIGNATURE,
  ].join("\n");
}
