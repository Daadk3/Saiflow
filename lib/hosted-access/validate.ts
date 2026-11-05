/**
 * Validation for a hosted-access product's private delivery details: the link
 * a buyer opens and the seller's short instructions.
 *
 * WHAT THIS PROTECTS AGAINST
 *
 *   - SSRF. SaiFlow never fetches, proxies or previews the link, on any path.
 *     The rules below are a second line: even if a later change did fetch it,
 *     a link to an IP literal, localhost or an internal name is refused, and
 *     only https on the default port is accepted.
 *   - Open redirects. SaiFlow never redirects to the link either: the
 *     delivery page renders it as an anchor the buyer clicks. A link back to
 *     SaiFlow's own hosts, and link shorteners that hide where they go, are
 *     refused so the stored value is always the real destination.
 *   - Secrets at rest. The access note is not a vault. A link carrying
 *     credentials (user:pass@, ?token=, ?api_key=) is refused, and so are
 *     instructions that look like they carry a password, an API key or token,
 *     a payment card, a bank account, or a patient or national identifier.
 *     These are heuristics and they are deliberately strict; the seller also
 *     certifies it, and an admin reads both fields before approving.
 *
 * Pure: no database, no network, no logging. Called on every write AND on
 * every read, so a row that predates a tightened rule fails closed.
 */

import { MAX_ACCESS_INSTRUCTIONS_LENGTH, MAX_ACCESS_URL_LENGTH } from "@/lib/hosted-access/limits";

export { MAX_ACCESS_INSTRUCTIONS_LENGTH, MAX_ACCESS_URL_LENGTH };

export type HostedUrlProblem =
  | "missing"
  | "too_long"
  | "malformed"
  | "not_https"
  | "credentials_in_url"
  | "non_default_port"
  | "ip_address"
  | "internal_host"
  | "saiflow_host"
  | "shortener"
  | "secret_in_url";

export type InstructionsProblem =
  | "too_long"
  | "contains_link"
  | "looks_like_password"
  | "looks_like_api_key"
  | "looks_like_payment_details"
  | "looks_like_personal_id";

export type Checked<T, P> = { ok: true; value: T } | { ok: false; problem: P };

/** SaiFlow's own hosts: a hosted product must live somewhere else. */
const SAIFLOW_HOSTS = ["saiflow.io", "saiflow.com", "saiflow.app"];

/** Shorteners hide the destination an admin approved. */
const SHORTENER_HOSTS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly",
  "cutt.ly", "rebrand.ly", "shorturl.at", "rb.gy", "t.ly", "tiny.cc", "s.id",
];

/** Names that are never public on the internet. */
const INTERNAL_SUFFIXES = [
  "localhost", "local", "internal", "intranet", "lan", "home", "corp",
  "private", "test", "example", "invalid", "onion", "arpa", "localdomain",
];

/** Query or fragment parameter names that carry a credential. */
const SECRET_PARAM = /^(?:api[-_]?key|apikey|key|token|access[-_]?token|id[-_]?token|refresh[-_]?token|auth|authorization|secret|client[-_]?secret|password|passwd|pass|pwd|sig|signature|session|sessionid|sid|jwt|x-amz-[a-z-]+|x-goog-[a-z-]+)$/i;

function hostMatches(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6
  // Dotted, decimal, octal or hex forms of IPv4 all parse as numbers here.
  return /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}$/i.test(host);
}

function hasSecretParam(params: URLSearchParams): boolean {
  for (const name of params.keys()) {
    if (SECRET_PARAM.test(name.trim())) return true;
  }
  return false;
}

/**
 * The one rule for a stored access link. Returns the normalised URL to store
 * (and, on read, to render), or why it is refused.
 */
export function validateHostedUrl(input: unknown): Checked<string, HostedUrlProblem> {
  if (typeof input !== "string" || input.trim() === "") return { ok: false, problem: "missing" };
  const raw = input.trim();
  if (raw.length > MAX_ACCESS_URL_LENGTH) return { ok: false, problem: "too_long" };
  // No whitespace or control characters anywhere: a URL that needs them is
  // not one a buyer should be handed.
  if (/[\s\u0000-\u001f\u007f\\]/.test(raw)) return { ok: false, problem: "malformed" };
  if (!/^https:\/\//i.test(raw)) {
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? { ok: false, problem: "not_https" } : { ok: false, problem: "malformed" };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: "malformed" };
  }
  if (url.protocol !== "https:") return { ok: false, problem: "not_https" };
  if (url.username !== "" || url.password !== "") return { ok: false, problem: "credentials_in_url" };
  if (url.port !== "") return { ok: false, problem: "non_default_port" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return { ok: false, problem: "malformed" };
  if (isIpLiteral(host)) return { ok: false, problem: "ip_address" };
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) {
    return { ok: false, problem: "internal_host" };
  }
  if (INTERNAL_SUFFIXES.includes(tld) || hostMatches(host, ["localhost"])) {
    return { ok: false, problem: "internal_host" };
  }
  if (hostMatches(host, SAIFLOW_HOSTS)) return { ok: false, problem: "saiflow_host" };
  if (hostMatches(host, SHORTENER_HOSTS)) return { ok: false, problem: "shortener" };

  if (hasSecretParam(url.searchParams)) return { ok: false, problem: "secret_in_url" };
  // A fragment shaped like a query (#access_token=…) is how some sign-in
  // flows hand over a token; refused the same way.
  if (url.hash.length > 1 && url.hash.includes("=") && hasSecretParam(new URLSearchParams(url.hash.slice(1)))) {
    return { ok: false, problem: "secret_in_url" };
  }

  return { ok: true, value: url.toString() };
}

/** Luhn check, for spotting a payment card number among digits. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const PASSWORD_PATTERNS = [
  /\b(?:password|passcode|passwd|pwd|pin|username|user\s*name)\s*[:=]/i,
  /(?:كلمة\s*(?:السر|المرور)|الرقم\s*السري|رمز\s*(?:الدخول|المرور))\s*[:=]?\s*\S/,
];

const API_KEY_PATTERNS = [
  /\b(?:api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|bearer|client[\s_-]?secret)\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}/, // OpenAI / Anthropic style
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub token
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // A long unbroken run of letters and digits with both: what a key looks like.
  /(?=[A-Za-z0-9_\-+/]*\d)(?=[A-Za-z0-9_\-+/]*[A-Za-z])[A-Za-z0-9_\-+/]{32,}/,
];

const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/;
const CVV = /\b(?:cvv|cvc|cvv2|security\s*code)\b/i;
/** Saudi national ID / iqama (10 digits from 1 or 2), and medical record numbers. */
const NATIONAL_ID = /(?<!\d)[12]\d{9}(?!\d)/;
const MEDICAL_RECORD = /\b(?:mrn|medical\s*record(?:\s*(?:no|number|#))?|patient\s*(?:id|no|number|#))\b\s*[:#=]?\s*\d/i;
const MEDICAL_RECORD_AR = /(?:رقم\s*(?:الملف\s*الطبي|المريض|الهوية)|الملف\s*الطبي\s*رقم)\s*[:#=]?\s*\d/;

function containsCardNumber(text: string): boolean {
  for (const match of text.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true;
  }
  return false;
}

/**
 * The buyer-facing access instructions. Optional; returns null when empty.
 * Plain text only: the delivery page renders it as text, never as HTML.
 */
export function validateAccessInstructions(input: unknown): Checked<string | null, InstructionsProblem> {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, problem: "too_long" };
  // Control characters other than newline and tab are dropped, not stored.
  const text = input.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (text === "") return { ok: true, value: null };
  if (text.length > MAX_ACCESS_INSTRUCTIONS_LENGTH) return { ok: false, problem: "too_long" };

  // The link has one validated home; a second link here would bypass it.
  if (/\b(?:https?|ftp|javascript|data|file):/i.test(text) || /\bwww\./i.test(text)) {
    return { ok: false, problem: "contains_link" };
  }
  if (PASSWORD_PATTERNS.some((p) => p.test(text))) return { ok: false, problem: "looks_like_password" };
  if (API_KEY_PATTERNS.some((p) => p.test(text))) return { ok: false, problem: "looks_like_api_key" };
  if (containsCardNumber(text) || CVV.test(text) || IBAN.test(text)) {
    return { ok: false, problem: "looks_like_payment_details" };
  }
  if (NATIONAL_ID.test(text) || MEDICAL_RECORD.test(text) || MEDICAL_RECORD_AR.test(text)) {
    return { ok: false, problem: "looks_like_personal_id" };
  }
  return { ok: true, value: text };
}

/** Seller-facing wording for each refusal, English and Arabic. */
export const HOSTED_ACCESS_PROBLEM_MESSAGES: Record<HostedUrlProblem | InstructionsProblem, { en: string; ar: string }> = {
  missing: { en: "Add the link buyers will open to use your hosted product.", ar: "أضف الرابط الذي سيفتحه المشتري لاستخدام منتجك المستضاف." },
  too_long: { en: "That is too long. Keep the link under 2,048 characters and the instructions under 1,000.", ar: "النص طويل جدًا. يجب ألا يتجاوز الرابط 2048 حرفًا والتعليمات 1000 حرف." },
  malformed: { en: "That doesn't look like a valid link. Paste the full https:// address.", ar: "هذا لا يبدو رابطًا صالحًا. الصق العنوان كاملًا بدءًا من https://." },
  not_https: { en: "The link must start with https://.", ar: "يجب أن يبدأ الرابط بـ https://." },
  credentials_in_url: { en: "The link must not contain a username or password.", ar: "يجب ألا يحتوي الرابط على اسم مستخدم أو كلمة مرور." },
  non_default_port: { en: "Use a normal https:// link without a port number.", ar: "استخدم رابط https:// عاديًا بدون رقم منفذ." },
  ip_address: { en: "Use a domain name, not an IP address.", ar: "استخدم اسم نطاق وليس عنوان IP." },
  internal_host: { en: "The link must be a public internet address.", ar: "يجب أن يكون الرابط عنوانًا عامًا على الإنترنت." },
  saiflow_host: { en: "The link must point to where your product is hosted, not to SaiFlow.", ar: "يجب أن يشير الرابط إلى مكان استضافة منتجك، وليس إلى SaiFlow." },
  shortener: { en: "Use the full link, not a link shortener.", ar: "استخدم الرابط الكامل وليس رابطًا مختصرًا." },
  secret_in_url: { en: "The link must not contain a key, token or password. Buyers should sign in on your site instead.", ar: "يجب ألا يحتوي الرابط على مفتاح أو رمز أو كلمة مرور. يجب أن يسجّل المشتري الدخول في موقعك بدلًا من ذلك." },
  contains_link: { en: "Don't put links in the instructions. Use the access link field.", ar: "لا تضع روابط في التعليمات. استخدم حقل رابط الوصول." },
  looks_like_password: { en: "Don't share passwords or logins in the instructions.", ar: "لا تشارك كلمات المرور أو بيانات الدخول في التعليمات." },
  looks_like_api_key: { en: "Don't share API keys, tokens or secrets in the instructions.", ar: "لا تشارك مفاتيح API أو الرموز أو الأسرار في التعليمات." },
  looks_like_payment_details: { en: "Don't include card, bank or payment details in the instructions.", ar: "لا تضع بيانات بطاقات أو حسابات بنكية أو دفع في التعليمات." },
  looks_like_personal_id: { en: "Don't include ID numbers, medical record numbers or patient data in the instructions.", ar: "لا تضع أرقام هوية أو أرقام ملفات طبية أو بيانات مرضى في التعليمات." },
};

/** Whether a stored access record is complete and still passes both rules. */
export function hostedAccessReady(access: { accessUrl: string; instructions: string | null } | null | undefined): boolean {
  if (!access) return false;
  return validateHostedUrl(access.accessUrl).ok && validateAccessInstructions(access.instructions).ok;
}
