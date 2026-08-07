import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authOptions } from "../../auth/authOptions";
import { isAiAssistantEnabled } from "@/lib/ai/flag";
import { listingInputSchema, listingOutputSchema, type AiErrorCode } from "@/lib/ai/schema";
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from "@/lib/ai/prompt";
import {
  generateJson,
  getModelName,
  getProviderName,
  isLiveProvider,
  ProviderTimeoutError,
} from "@/lib/ai/provider";
import { canGenerate } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

function fail(code: AiErrorCode, status: number) {
  // Only the code — provider messages can echo creator input and are never
  // returned to the client.
  return NextResponse.json({ error: code }, { status });
}

export async function POST(req: Request) {
  const started = Date.now();

  // 1 — authenticated session
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return fail("UNAUTHENTICATED", 401);

  // 2 — feature flag (defaults off)
  if (!isAiAssistantEnabled(session.user.email)) return fail("FEATURE_DISABLED", 403);

  // 3 — validate input
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("INVALID_INPUT", 400);
  }
  const parsed = listingInputSchema.safeParse(body);
  if (!parsed.success) return fail("INVALID_INPUT", 400);
  const input = parsed.data;

  // 4 — resolve the user server-side; never trust a client-supplied id
  const user = await prisma.user.findFirst({
    where: { email: { equals: session.user.email, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return fail("UNAUTHENTICATED", 401);

  // 5 — the caller must belong to the shop they are generating for
  const membership = await prisma.shopUser.findFirst({
    where: { userId: user.id, shopId: input.shopId },
    select: { id: true },
  });
  if (!membership) return fail("FORBIDDEN", 403);

  // 6 — durable, database-backed usage cap (AI calls are billable)
  const isSection = Boolean(input.section);
  const { allowed, usage } = await canGenerate(user.id, isSection);
  if (!allowed) return fail("RATE_LIMITED", 429);

  // Hash of the creator's input — enough to spot repeats, never the text.
  const inputHash = createHash("sha256")
    .update(
      [input.title, input.shortDescription, input.targetAudience, input.details].join(" ")
    )
    .digest("hex");

  const provider = getProviderName();
  const model = getModelName();

  try {
    const result = await generateJson({
      system: buildSystemPrompt(input.language),
      user: buildUserPrompt(input),
    });

    // 7 — model output is untrusted: parse and validate, never repair
    let candidate: unknown;
    try {
      candidate = JSON.parse(result.json);
    } catch {
      await recordFailure(user.id, input, inputHash, provider, model, "INVALID_OUTPUT", started);
      return fail("INVALID_OUTPUT", 502);
    }
    const output = listingOutputSchema.safeParse(candidate);
    if (!output.success) {
      await recordFailure(user.id, input, inputHash, provider, model, "INVALID_OUTPUT", started);
      return fail("INVALID_OUTPUT", 502);
    }

    // 8 — record the generation. NOTHING is written to Product: suggestions
    // only travel back to the form, and the creator saves manually.
    const generation = await prisma.aiGeneration.create({
      data: {
        userId: user.id,
        shopId: input.shopId,
        provider: result.provider,
        model: result.model,
        promptVersion: PROMPT_VERSION,
        language: input.language,
        status: "SUCCEEDED",
        section: input.section ?? null,
        inputHash,
        output: output.data,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        latencyMs: Date.now() - started,
      },
      select: { id: true },
    });

    return NextResponse.json({
      generationId: generation.id,
      suggestions: output.data,
      /** False when no vendor is configured — the UI must say so plainly. */
      isLive: isLiveProvider(),
      usage: {
        fullRemaining: isSection ? usage.fullRemaining : usage.fullRemaining - 1,
        sectionRemaining: isSection ? usage.sectionRemaining - 1 : usage.sectionRemaining,
      },
    });
  } catch (err) {
    const timedOut = err instanceof ProviderTimeoutError;
    const code: AiErrorCode = timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
    await recordFailure(user.id, input, inputHash, provider, model, code, started);
    // Error name only — never the provider payload.
    console.error(`[ai/listing] ${code}`);
    return fail(code, timedOut ? 504 : 502);
  }
}

async function recordFailure(
  userId: string,
  input: { shopId: string; language: string; section?: string },
  inputHash: string,
  provider: string,
  model: string,
  errorCode: AiErrorCode,
  started: number
) {
  try {
    await prisma.aiGeneration.create({
      data: {
        userId,
        shopId: input.shopId,
        provider,
        model,
        promptVersion: PROMPT_VERSION,
        language: input.language,
        status: "FAILED",
        section: input.section ?? null,
        inputHash,
        errorCode,
        latencyMs: Date.now() - started,
      },
    });
  } catch {
    // Never let audit-write failure mask the original error.
  }
}
