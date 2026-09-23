/**
 * Transactional notifications: what SaiFlow tells the founder and sellers,
 * and how.
 *
 *   founder  ← a creator opened a store
 *   founder  ← a product's file passed its check and awaits approval
 *   founder  ← a purchase was fulfilled
 *   seller   ← the product was approved
 *   seller   ← the product was rejected, with the stored reason
 *   seller   ← a purchase of their product was fulfilled
 *
 * NEVER IN THE WAY. Every export resolves to an outcome and never throws.
 * Callers fire it after the write that matters has been committed — the shop
 * row, the verdict transaction, the moderation event, the Order — so a mail
 * failure cannot undo, block or delay any of them. Routes run it after the
 * response (lib/after-response); the scan worker awaits it with a timeout,
 * since it is already running in the background.
 *
 * NEVER LOUD. A log line carries an event name, an outcome, a recipient
 * COUNT and a redacted id. Never an address, never a body.
 *
 * NEVER TRUSTING. Names and reasons are typed by people: they are escaped
 * into HTML, and headers cannot carry a line break.
 *
 * Arabic first, English beneath, in every message: mail has no request locale
 * to ask, and a seller may forward it to anyone.
 */

import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { getAdminEmails } from "@/lib/admin";
import { redactId } from "@/lib/redact-id";
import {
  adminDashboardUrl,
  adminProductReviewUrl,
  publicShopUrl,
  sellerProductEditUrl,
  sellerSalesUrl,
  sellerShopUrl,
} from "@/lib/notification-links";

/** The same verified sender the receipt and the report email use. */
export const NOTIFY_FROM = "Saiflow <noreply@saiflow.io>";

/** A hung provider must not hold a worker; the send is abandoned, not awaited forever. */
export const SEND_TIMEOUT_MS = 10_000;

export type NotifyOutcome =
  | { ok: true; recipients: number }
  | {
      ok: false;
      reason:
        | "unconfigured"
        | "no_recipients"
        | "nothing_to_send"
        | "provider_error"
        | "timeout"
        | "threw";
    };

export interface BilingualLine {
  ar: string;
  en: string;
}

export interface NotificationMessage {
  /** Short event name for the log line. */
  kind: string;
  /** An id for the log line; redacted before it is written. */
  ref: string;
  to: string[];
  subject: string;
  heading: BilingualLine;
  lines: BilingualLine[];
  link: { url: string; label: BilingualLine } | null;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A header value: one line, bounded. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
}

function renderHtml(message: NotificationMessage): string {
  const muted = 'style="color:#6b7280;font-size:13px"';
  const lines = message.lines
    .map(
      (line) =>
        `<p style="margin:0 0 10px">${escapeHtml(line.ar)}<br><span lang="en" dir="ltr" ${muted}>${escapeHtml(line.en)}</span></p>`
    )
    .join("");
  const link = message.link
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(message.link.url)}" style="display:inline-block;background:#14b8a6;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:10px;font-weight:bold">${escapeHtml(message.link.label.ar)} · ${escapeHtml(message.link.label.en)}</a></p>`
    : "";
  return (
    `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#f9fafb;font-family:-apple-system,'Segoe UI',Tahoma,Arial,sans-serif;color:#111827">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff">` +
    `<h2 style="margin:0 0 20px;font-size:20px">${escapeHtml(message.heading.ar)}<br><span lang="en" dir="ltr" style="font-weight:normal;color:#6b7280;font-size:14px">${escapeHtml(message.heading.en)}</span></h2>` +
    lines +
    link +
    `<p style="margin:32px 0 0;font-size:12px;color:#9ca3af">SaiFlow · ساي فلو</p>` +
    `</div></body></html>`
  );
}

function renderText(message: NotificationMessage): string {
  const parts = [message.heading.ar, message.heading.en, ""];
  for (const line of message.lines) parts.push(line.ar, line.en, "");
  if (message.link) parts.push(`${message.link.label.ar} / ${message.link.label.en}: ${message.link.url}`);
  return parts.join("\n");
}

/** Lower-cased, trimmed, de-duplicated, and only things shaped like an address. */
export function uniqueRecipients(candidates: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim().toLowerCase();
    if (!value || /\s/.test(value) || !value.includes("@")) continue;
    seen.add(value);
  }
  return [...seen];
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

const TIMED_OUT = Symbol("timed_out");

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function report(message: NotificationMessage, outcome: NotifyOutcome, detail = ""): NotifyOutcome {
  const summary = outcome.ok ? `ok recipients=${outcome.recipients}` : `failed:${outcome.reason}`;
  const line = `[notify] event=${message.kind} outcome=${summary} ref=${redactId(message.ref)}${detail ? ` detail=${detail}` : ""}`;
  if (outcome.ok || outcome.reason === "no_recipients" || outcome.reason === "unconfigured" || outcome.reason === "nothing_to_send") {
    console.log(line);
  } else {
    console.warn(line);
  }
  return outcome;
}

/**
 * Send one message. Resolves to an outcome; never throws; never logs an
 * address. Unconfigured mail and an empty recipient list are quiet skips.
 */
export async function sendNotification(
  message: NotificationMessage,
  options: { timeoutMs?: number } = {}
): Promise<NotifyOutcome> {
  const to = uniqueRecipients(message.to);
  if (to.length === 0) return report(message, { ok: false, reason: "no_recipients" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return report(message, { ok: false, reason: "unconfigured" });

  try {
    const client = new Resend(apiKey);
    const result = await withTimeout(
      client.emails.send({
        from: NOTIFY_FROM,
        to,
        subject: headerSafe(message.subject),
        html: renderHtml(message),
        text: renderText(message),
      }),
      options.timeoutMs ?? SEND_TIMEOUT_MS
    );
    if (result === TIMED_OUT) return report(message, { ok: false, reason: "timeout" });
    // The SDK resolves with { data, error } on API-level failures; it does not throw.
    if (result.error) {
      const { name, statusCode } = result.error as { name?: string; statusCode?: number };
      return report(message, { ok: false, reason: "provider_error" }, `${name ?? "error"}:${statusCode ?? ""}`);
    }
    return report(message, { ok: true, recipients: to.length });
  } catch (error) {
    return report(message, { ok: false, reason: "threw" }, (error as Error)?.name ?? "Error");
  }
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const MEMBER_SELECT = {
  shopUsers: { select: { user: { select: { email: true } } } },
} as const;

type ShopWithMembers = {
  name: string;
  slug: string;
  shopUsers: Array<{ user: { email: string | null } }>;
};

function memberEmails(shop: ShopWithMembers | null | undefined): string[] {
  return uniqueRecipients((shop?.shopUsers ?? []).map((membership) => membership?.user?.email));
}

function formatAmount(amount: unknown): string {
  const numeric = Number(String(amount));
  return Number.isFinite(numeric) ? numeric.toFixed(2) : String(amount);
}

function formatWhen(date: Date): string {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Riyadh",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

const isTest = (environment: string) => environment !== "PRODUCTION";
const TEST_MARK = "[اختبار] ";
const TEST_LINE: BilingualLine = {
  ar: "هذه عملية اختبار وليست إيرادًا فعليًا.",
  en: "This is a test payment, not real revenue.",
};

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/** A creator opened a store → founder. Call after the shop row exists. */
export async function notifyAdminsStoreCreated(shop: {
  id: string;
  name: string;
  slug: string;
}): Promise<NotifyOutcome> {
  return sendNotification({
    kind: "store_created",
    ref: shop.id,
    to: getAdminEmails(),
    subject: `متجر جديد على SaiFlow: ${shop.name}`,
    heading: { ar: "أنشأ صانع محتوى متجرًا جديدًا", en: "A creator opened a new store" },
    lines: [
      { ar: `المتجر: ${shop.name}`, en: `Store: ${shop.name}` },
      { ar: `المعرّف: ${shop.slug}`, en: `Handle: ${shop.slug}` },
    ],
    link: { url: publicShopUrl(shop.slug), label: { ar: "عرض المتجر", en: "View the store" } },
  });
}

/**
 * A product's file is SAFE and the product still awaits a decision → founder.
 *
 * Called with the ids of the products that ONE committed transaction just
 * bound to a SAFE verdict: the scan worker's, when its verdict propagated to
 * attached products, or a reconciliation's, when it copied an existing
 * verdict onto a newly attached product. A product leaves PENDING_SCAN for
 * a given file exactly once, so the two callers can never both name it and
 * the founder hears about each attachment once.
 *
 * The rows are re-read at send time and only those still SAFE for their
 * current file and still PENDING are announced: a decision or a file
 * replacement in the meantime silently cancels the email. `boundTo` is
 * the file key the announcement was made for; a product that has since
 * moved on to another file is left to that file's own announcement.
 */
export async function notifyAdminsProductReadyForReview(
  productIds: string[],
  boundTo?: string
): Promise<NotifyOutcome[]> {
  const ids = [...new Set(productIds.filter((id) => typeof id === "string" && id.length > 0))];
  const ref = ids.map((id) => redactId(id)).join(",");
  if (ids.length === 0) {
    return [{ ok: false, reason: "nothing_to_send" }];
  }
  let rows: Array<{
    id: string;
    name: string;
    fileKey: string | null;
    fileScanKey: string | null;
    shop: { name: string; slug: string };
  }>;
  try {
    rows = await prisma.product.findMany({
      where: { id: { in: ids }, moderationStatus: "PENDING", fileScanStatus: "SAFE" },
      select: {
        id: true,
        name: true,
        fileKey: true,
        fileScanKey: true,
        shop: { select: { name: true, slug: true } },
      },
    });
  } catch (error) {
    console.warn(
      `[notify] event=ready_for_review outcome=failed:threw ref=${ref} detail=${(error as Error)?.name ?? "Error"}`
    );
    return [{ ok: false, reason: "threw" }];
  }
  // SAFE must be SAFE for the file the product currently sells — and, when
  // the caller said which file it meant, for that file.
  const products = rows.filter(
    (row) =>
      row.fileKey !== null &&
      row.fileScanKey === row.fileKey &&
      (boundTo === undefined || row.fileKey === boundTo)
  );
  if (products.length === 0) {
    console.log(`[notify] event=ready_for_review outcome=failed:nothing_to_send ref=${ref}`);
    return [{ ok: false, reason: "nothing_to_send" }];
  }
  const outcomes: NotifyOutcome[] = [];
  for (const product of products) {
    outcomes.push(
      await sendNotification({
        kind: "ready_for_review",
        ref: product.id,
        to: getAdminEmails(),
        subject: `منتج بانتظار المراجعة: ${product.name}`,
        heading: {
          ar: "اجتاز الملف الفحص، والمنتج بانتظار اعتمادك",
          en: "The file passed its check; the product awaits your approval",
        },
        lines: [
          { ar: `المنتج: ${product.name}`, en: `Product: ${product.name}` },
          { ar: `المتجر: ${product.shop.name}`, en: `Store: ${product.shop.name}` },
        ],
        link: { url: adminProductReviewUrl(product.id), label: { ar: "مراجعة المنتج الآن", en: "Review now" } },
      })
    );
  }
  return outcomes;
}

/** A moderation decision → the shop's members. Call after the decision is committed. */
export async function notifyProductModerated(input: {
  productId: string;
  action: "APPROVED" | "REJECTED";
  reason: string | null;
}): Promise<NotifyOutcome> {
  const kind = input.action === "APPROVED" ? "product_approved" : "product_rejected";
  let product: { name: string; slug: string; shop: ShopWithMembers } | null;
  try {
    product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { name: true, slug: true, shop: { select: { name: true, slug: true, ...MEMBER_SELECT } } },
    });
  } catch (error) {
    console.warn(`[notify] event=${kind} outcome=failed:threw ref=${redactId(input.productId)} detail=${(error as Error)?.name ?? "Error"}`);
    return { ok: false, reason: "threw" };
  }
  if (!product) {
    console.log(`[notify] event=${kind} outcome=failed:nothing_to_send ref=${redactId(input.productId)}`);
    return { ok: false, reason: "nothing_to_send" };
  }

  const to = memberEmails(product.shop);
  if (input.action === "APPROVED") {
    return sendNotification({
      kind,
      ref: input.productId,
      to,
      subject: `تمت الموافقة على منتجك: ${product.name}`,
      heading: { ar: "منتجك معتمد الآن", en: "Your product is approved" },
      lines: [
        { ar: `المنتج: ${product.name}`, en: `Product: ${product.name}` },
        {
          ar: "اعتمدنا منتجك. يظهر للعامة عندما يكون ملفه قد اجتاز الفحص.",
          en: "We approved your product. It goes public once its file has passed the check.",
        },
      ],
      link: { url: sellerShopUrl(product.shop.slug), label: { ar: "لوحة متجرك", en: "Your store dashboard" } },
    });
  }
  return sendNotification({
    kind,
    ref: input.productId,
    to,
    subject: `لم تتم الموافقة على منتجك: ${product.name}`,
    heading: { ar: "منتجك يحتاج إلى تعديل", en: "Your product needs changes" },
    lines: [
      { ar: `المنتج: ${product.name}`, en: `Product: ${product.name}` },
      { ar: `السبب: ${input.reason ?? "—"}`, en: `Reason: ${input.reason ?? "—"}` },
      {
        ar: "راجع السبب أعلاه وعدّل المنتج من لوحة متجرك.",
        en: "Read the reason above and edit the product from your store dashboard.",
      },
    ],
    link: {
      url: sellerProductEditUrl(product.shop.slug, product.slug),
      label: { ar: "تعديل المنتج", en: "Edit the product" },
    },
  });
}

/**
 * A purchase was fulfilled → the shop's members and the founder. Call after
 * the Order is committed. Carries the product, the gross amount and the
 * environment; never the buyer, never a payment payload, never a bearer.
 */
export async function notifySaleFulfilled(input: {
  orderId: string;
  productId: string;
  productName: string;
  amount: unknown;
  currency: string;
  environment: string;
  at?: Date;
}): Promise<{ seller: NotifyOutcome; admins: NotifyOutcome }> {
  let shop: ShopWithMembers | null = null;
  try {
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { shop: { select: { name: true, slug: true, ...MEMBER_SELECT } } },
    });
    shop = (product as { shop?: ShopWithMembers } | null)?.shop ?? null;
  } catch (error) {
    console.warn(`[notify] event=sale outcome=lookup_failed ref=${redactId(input.orderId)} detail=${(error as Error)?.name ?? "Error"}`);
  }

  const test = isTest(input.environment);
  const mark = test ? TEST_MARK : "";
  const amount = `${formatAmount(input.amount)} ${input.currency}`;
  const when = formatWhen(input.at ?? new Date());
  const testLines = test ? [TEST_LINE] : [];

  const seller = await sendNotification({
    kind: "sale_seller",
    ref: input.orderId,
    to: memberEmails(shop),
    subject: `${mark}بيع جديد: ${input.productName}`,
    heading: { ar: "تمت عملية بيع جديدة في متجرك", en: "You made a sale" },
    lines: [
      { ar: `المنتج: ${input.productName}`, en: `Product: ${input.productName}` },
      { ar: `قيمة البيع: ${amount}`, en: `Sale amount: ${amount}` },
      { ar: `رقم الطلب: ${redactId(input.orderId)}`, en: `Order ref: ${redactId(input.orderId)}` },
      { ar: `التاريخ: ${when}`, en: `Date: ${when}` },
      ...testLines,
    ],
    link: { url: sellerSalesUrl(), label: { ar: "عرض المبيعات", en: "View sales" } },
  });

  const admins = await sendNotification({
    kind: "sale_admin",
    ref: input.orderId,
    to: getAdminEmails(),
    subject: `${mark}عملية بيع: ${input.productName}`,
    heading: { ar: "تمت عملية بيع", en: "A sale was completed" },
    lines: [
      { ar: `المنتج: ${input.productName}`, en: `Product: ${input.productName}` },
      { ar: `المتجر: ${shop?.name ?? "—"}`, en: `Store: ${shop?.name ?? "—"}` },
      { ar: `المبلغ: ${amount}`, en: `Amount: ${amount}` },
      { ar: `رقم الطلب: ${redactId(input.orderId)}`, en: `Order ref: ${redactId(input.orderId)}` },
      { ar: `التاريخ: ${when}`, en: `Date: ${when}` },
      ...testLines,
    ],
    link: { url: adminDashboardUrl(), label: { ar: "لوحة الإدارة", en: "Admin dashboard" } },
  });

  return { seller, admins };
}
