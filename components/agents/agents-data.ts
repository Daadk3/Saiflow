/**
 * Static catalog for /agents. Copy and order follow the approved mockup
 * (Arabic first, English second). No prices, checkout, or database rows.
 */

export type AgentCategoryId = "support" | "sales" | "finance" | "productivity";

export type AgentCategory = {
  id: "all" | AgentCategoryId;
  ar: string;
  en: string;
};

export type Agent = {
  id: string;
  image: string;
  category: AgentCategoryId;
  /** Accent used for the role label and the card button in dark mode. */
  accent: string;
  /** Darker accent so the role label stays readable on a light card. */
  accentInk: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  featured?: boolean;
  statusAr: string;
  statusEn: string;
  actionAr: string;
  actionEn: string;
};

export const CATEGORIES: readonly AgentCategory[] = [
  { id: "all", ar: "الكل", en: "All" },
  { id: "support", ar: "خدمة العملاء", en: "Support" },
  { id: "sales", ar: "المبيعات والتسويق", en: "Sales & Marketing" },
  { id: "finance", ar: "المال والإدارة", en: "Finance & Admin" },
  { id: "productivity", ar: "الإنتاجية", en: "Productivity" },
];

export const AGENTS: readonly Agent[] = [
  {
    id: "customer-service",
    image: "/agents/01-customer-service.png",
    category: "support",
    accent: "#1FB3B3",
    accentInk: "#0f766e",
    nameAr: "موظف خدمة العملاء الذكي",
    nameEn: "Customer Service",
    descAr: "يرد على عملائك بلطف ويحيل الصعب إليك.",
    descEn: "Answers kindly, hands tough cases to you.",
    featured: true,
    statusAr: "الأول",
    statusEn: "First",
    actionAr: "أبلغني عند الإطلاق",
    actionEn: "Notify me",
  },
  {
    id: "content-writer",
    image: "/agents/02-content-writer.png",
    category: "sales",
    accent: "#8B5CF6",
    accentInk: "#6d28d9",
    nameAr: "كاتب المحتوى",
    nameEn: "Content Writer",
    descAr: "يكتب منشوراتك بصوت علامتك التجارية.",
    descEn: "Writes posts in your brand voice.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "sales",
    image: "/agents/03-sales.png",
    category: "sales",
    accent: "#FB7185",
    accentInk: "#be123c",
    nameAr: "مساعد المبيعات",
    nameEn: "Sales",
    descAr: "يقترح العروض ويتابع العملاء المهتمين.",
    descEn: "Suggests offers, follows up on leads.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "bookkeeping",
    image: "/agents/04-bookkeeping.png",
    category: "finance",
    accent: "#22C55E",
    accentInk: "#15803d",
    nameAr: "مساعد المحاسبة",
    nameEn: "Bookkeeping",
    descAr: "ينظّم المصاريف والفواتير ويلخّص أرقامك.",
    descEn: "Tidies expenses, invoices and totals.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "social-media",
    image: "/agents/05-social-media.png",
    category: "sales",
    accent: "#FB923C",
    accentInk: "#c2410c",
    nameAr: "مدير السوشال ميديا",
    nameEn: "Social Media",
    descAr: "يخطط جدول النشر ويقترح الأفكار.",
    descEn: "Plans posts, ideas and hashtags.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "appointments",
    image: "/agents/06-appointments.png",
    category: "productivity",
    accent: "#3B82F6",
    accentInk: "#1d4ed8",
    nameAr: "منسّق المواعيد",
    nameEn: "Appointment Booking",
    descAr: "يرتّب الحجوزات ويجهّز رسائل التذكير.",
    descEn: "Organises bookings and reminders.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "research",
    image: "/agents/07-research.png",
    category: "productivity",
    accent: "#FACC15",
    accentInk: "#a16207",
    nameAr: "الباحث الذكي",
    nameEn: "Research",
    descAr: "يجمع المعلومات ويلخّصها بوضوح.",
    descEn: "Finds information and sums it up.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
  {
    id: "personal-assistant",
    image: "/agents/08-personal-assistant.png",
    category: "productivity",
    accent: "#E879F9",
    accentInk: "#a21caf",
    nameAr: "المساعد الشخصي",
    nameEn: "Personal Assistant",
    descAr: "يرتّب مهامك ويكتب رسائلك اليومية.",
    descEn: "Sorts tasks and drafts your messages.",
    statusAr: "ضمن الخطة",
    statusEn: "Planned",
    actionAr: "عرض الوكيل",
    actionEn: "View agent",
  },
];

export const TRUST_POINTS = [
  "بالعربية والإنجليزية",
  "شراء مرة واحدة",
  "بدون برمجة",
] as const;

export const HOW_STEPS = [
  {
    n: "١",
    color: "#00FFB3",
    title: "حمّل حزمة الوكيل",
    body: "تعليمات جاهزة، وقالب لمعلومات نشاطك، ودليل إعداد بالصور.",
    en: "Download the kit: instructions, knowledge template, setup guide.",
  },
  {
    n: "٢",
    color: "#A78BFA",
    title: "املأ معلومات نشاطك",
    body: "الأسئلة الشائعة، الأسعار، التوصيل، الاسترجاع وساعات العمل.",
    en: "Fill in your FAQs, prices, delivery, returns and hours.",
  },
  {
    n: "٣",
    color: "#FB923C",
    title: "الصقه وابدأ",
    body: "في ChatGPT Projects أو Claude Projects أو Gemini Gems، ويبدأ العمل.",
    en: "Paste into ChatGPT Projects, Claude Projects or Gemini Gems.",
  },
] as const;
