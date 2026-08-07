/**
 * AI provider abstraction — server-side only.
 *
 * Deliberately implemented with plain `fetch` against provider HTTP APIs
 * rather than a vendor SDK: it adds zero dependencies, keeps the surface
 * auditable, and makes swapping vendors a matter of one function.
 *
 * Configuration (all server-side, never exposed to the browser):
 *   AI_PROVIDER   "anthropic" | "openai" | "mock"   (default: "mock")
 *   AI_MODEL      model name, provider-specific
 *   AI_API_KEY    provider secret
 *
 * When no key is configured the mock provider is used so the whole feature —
 * UI, validation, rate limits, tests — is exercisable without a vendor
 * account. The mock returns clearly-labelled placeholder text and must never
 * be presented to a creator as real assistance.
 *
 * Never logs prompts, completions, secrets or personal data.
 */

const TIMEOUT_MS = 20_000; // comfortably under Vercel's 30s function limit

export type ProviderName = "anthropic" | "openai" | "mock";

export interface ProviderResult {
  /** Raw JSON text returned by the model — caller validates it with Zod. */
  json: string;
  model: string;
  provider: ProviderName;
  inputTokens?: number;
  outputTokens?: number;
}

export class ProviderTimeoutError extends Error {}
export class ProviderCallError extends Error {}

export function getProviderName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (raw === "anthropic" || raw === "openai") {
    // A provider is only usable with a key; otherwise fall back to the mock
    // rather than failing at request time.
    return process.env.AI_API_KEY ? raw : "mock";
  }
  return "mock";
}

export function getModelName(): string {
  const provider = getProviderName();
  if (provider === "mock") return "mock-1";
  return process.env.AI_MODEL ?? "unconfigured";
}

/** True only when a real vendor is configured with a key. */
export function isLiveProvider(): boolean {
  return getProviderName() !== "mock";
}

/**
 * Single entry point. Returns raw JSON text; validation is the caller's job.
 * At most one retry, and only for transport-level failures.
 */
export async function generateJson(opts: {
  system: string;
  user: string;
}): Promise<ProviderResult> {
  const provider = getProviderName();
  if (provider === "mock") return mockGenerate(opts.user);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callProvider(provider, opts);
    } catch (err) {
      if (err instanceof ProviderTimeoutError) throw err; // never retry a timeout
      lastError = err;
    }
  }
  throw new ProviderCallError(
    lastError instanceof Error ? lastError.name : "provider_failed"
  );
}

async function callProvider(
  provider: Exclude<ProviderName, "mock">,
  opts: { system: string; user: string }
): Promise<ProviderResult> {
  const key = process.env.AI_API_KEY;
  if (!key) throw new ProviderCallError("missing_key");
  const model = getModelName();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res =
      provider === "anthropic"
        ? await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              "x-api-key": key,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model,
              max_tokens: 2000,
              system: opts.system,
              messages: [{ role: "user", content: opts.user }],
            }),
          })
        : await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model,
              max_tokens: 2000,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: opts.system },
                { role: "user", content: opts.user },
              ],
            }),
          });

    if (!res.ok) {
      // Status only — never the provider's response body, which can echo input.
      throw new ProviderCallError(`http_${res.status}`);
    }

    const data = await res.json();
    if (provider === "anthropic") {
      return {
        json: extractJson(data?.content?.[0]?.text ?? ""),
        model,
        provider,
        inputTokens: data?.usage?.input_tokens,
        outputTokens: data?.usage?.output_tokens,
      };
    }
    return {
      json: extractJson(data?.choices?.[0]?.message?.content ?? ""),
      model,
      provider,
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderTimeoutError("timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Strips accidental code fences; returns the outermost JSON object. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start !== -1 && end > start ? body.slice(start, end + 1) : body;
}

/**
 * Deterministic placeholder used when no vendor is configured. Clearly marked
 * so it can never be mistaken for real assistance.
 */
function mockGenerate(user: string): ProviderResult {
  const isArabic = /[؀-ۿ]/.test(user);
  const tag = isArabic ? "[نموذج تجريبي]" : "[mock]";
  return {
    json: JSON.stringify({
      improvedTitle: `${tag} ${isArabic ? "عنوان مقترح" : "Suggested title"}`,
      shortSummary: `${tag} ${isArabic ? "ملخص قصير للمنتج الرقمي يوضح ما يحصل عليه المشتري." : "A short summary describing what the buyer receives."}`,
      fullDescription: `${tag} ${isArabic ? "وصف تجريبي لا يمثل مخرجات حقيقية. لم يتم ضبط مزوّد ذكاء اصطناعي بعد، لذا هذا نص بديل فقط لاختبار الواجهة والتحقق من الحقول." : "Placeholder description. No AI provider is configured, so this is stand-in text used only to exercise the interface and field validation."}`,
      keyBenefits: isArabic
        ? [`${tag} فائدة أولى`, `${tag} فائدة ثانية`, `${tag} فائدة ثالثة`]
        : [`${tag} First benefit`, `${tag} Second benefit`, `${tag} Third benefit`],
      targetAudience: `${tag} ${isArabic ? "الفئة المستهدفة" : "Intended audience"}`,
      faq: [
        {
          question: `${tag} ${isArabic ? "ما الذي أحصل عليه؟" : "What do I receive?"}`,
          answer: `${tag} ${isArabic ? "نص تجريبي." : "Placeholder answer."}`,
        },
        {
          question: `${tag} ${isArabic ? "كيف أستلم المنتج؟" : "How is it delivered?"}`,
          answer: `${tag} ${isArabic ? "نص تجريبي." : "Placeholder answer."}`,
        },
      ],
      cta: `${tag} ${isArabic ? "احصل عليه الآن" : "Get it now"}`,
      seoTitle: `${tag} ${isArabic ? "عنوان محرك البحث" : "SEO title"}`,
      seoDescription: `${tag} ${isArabic ? "وصف تجريبي لمحركات البحث لأغراض الاختبار فقط." : "Placeholder search description used for testing only."}`,
      suggestedCategory: "ebooks",
    }),
    model: "mock-1",
    provider: "mock",
  };
}
