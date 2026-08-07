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

import { LISTING_JSON_SCHEMA } from "@/lib/ai/schema";

const TIMEOUT_MS = 25_000; // under the route's 30s Vercel function limit

/**
 * Output budget. On OpenAI reasoning models (the GPT-5 family) hidden
 * reasoning tokens are billed against this same allowance, so a budget sized
 * only for the visible answer can be spent entirely on reasoning and return
 * empty content with `finish_reason: "length"`. The listing itself needs
 * roughly 1200 tokens; the rest is headroom for reasoning.
 */
const MAX_OUTPUT_TOKENS = 4000;

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

export class ProviderCallError extends Error {
  /**
   * Whether trying again could plausibly succeed. A 400 means the request
   * itself is wrong, so repeating it verbatim only doubles the creator's wait
   * for a guaranteed second failure.
   */
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

/** Rate limiting and server faults are transient; everything else is not. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Resolves the API key, accepting either the provider's conventional variable
 * name or the generic one.
 *
 * Reading only `AI_API_KEY` would mean an operator who sets `OPENAI_API_KEY` —
 * the name OpenAI's own documentation and tooling use — gets a silent fallback
 * to the mock: the flag is on, the key is present, and the assistant still
 * returns placeholder text with nothing explaining why. Accepting both names
 * removes a configuration trap rather than documenting it.
 */
function getApiKey(provider: Exclude<ProviderName, "mock">): string | undefined {
  const specific =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  return specific || process.env.AI_API_KEY || undefined;
}

export function getProviderName(): ProviderName {
  const raw = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (raw === "anthropic" || raw === "openai") {
    // A provider is only usable with a key; otherwise fall back to the mock
    // rather than failing at request time.
    return getApiKey(raw) ? raw : "mock";
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
      // A rejected request will be rejected identically the second time.
      if (err instanceof ProviderCallError && !err.retryable) throw err;
      lastError = err;
    }
  }
  throw new ProviderCallError(
    lastError instanceof Error ? lastError.message : "provider_failed"
  );
}

async function callProvider(
  provider: Exclude<ProviderName, "mock">,
  opts: { system: string; user: string }
): Promise<ProviderResult> {
  const key = getApiKey(provider);
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
              // GPT-5 reasoning models reject `max_tokens` outright with a 400
              // and require this field instead.
              max_completion_tokens: MAX_OUTPUT_TOKENS,
              // Writing a listing from facts the creator supplied is a
              // formatting task, not a reasoning one. Low effort keeps the
              // creator's wait and the per-generation cost down.
              reasoning_effort: "low",
              // Schema-constrained decoding: the model cannot return a shape
              // other than this one. Zod still enforces the length limits,
              // which strict mode does not support.
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "listing_suggestions",
                  strict: true,
                  schema: LISTING_JSON_SCHEMA,
                },
              },
              // `temperature` is deliberately absent: reasoning models reject
              // it, and the default is what we want anyway.
              messages: [
                { role: "system", content: opts.system },
                { role: "user", content: opts.user },
              ],
            }),
          });

    if (!res.ok) {
      // Status only — never the provider's response body, which can echo input.
      throw new ProviderCallError(`http_${res.status}`, isRetryableStatus(res.status));
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

    const choice = data?.choices?.[0];

    // The model may decline on safety grounds. A refusal is prose, not the
    // schema, so surface it as a failed call rather than letting it fall
    // through and fail confusingly as malformed JSON.
    if (choice?.message?.refusal) {
      throw new ProviderCallError("refused", false);
    }

    // Reasoning tokens share the output budget, so an exhausted allowance
    // yields truncated or empty content. Name it precisely — "invalid JSON"
    // would send the next reader looking in the wrong place.
    if (choice?.finish_reason === "length") {
      throw new ProviderCallError("truncated", false);
    }

    return {
      json: extractJson(choice?.message?.content ?? ""),
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
