import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isDeliverableSafe } from "@/lib/file-safety";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { redactId } from "@/lib/redact-id";
import {
  createSession,
  geideaMode,
  isGeideaConfigured,
} from "@/lib/payments/geidea/client";
import { canonicalAmount } from "@/lib/payments/geidea/callback";

/**
 * Checkout: the one place a purchase attempt begins.
 *
 * Every gate that existed before Geidea still runs first, in the same order:
 * pre-launch, a real product, moderation and shop visibility, an attached
 * file, and the reviewed deliverable-safety predicate. Only past all of them
 * does money enter the picture, and then nothing the browser sent is used
 * again: the body contributes `productId` and nothing else. The amount is the
 * row's price, the currency is the row's and must be SAR, the environment is
 * the deployment's GEIDEA_ENV, and both Geidea URLs are built from the
 * deployment's own configured origin.
 *
 * A PaymentSession row is written BEFORE Geidea is asked for a session and
 * carries what was intended: product, amount, currency, environment, a fresh
 * merchant reference. It is an attempt, never a purchase; the callback route
 * checks Geidea's answer against this row and is the only thing that can
 * turn it into an Order. The redirect back to the success page proves
 * nothing, and the success page will read SaiFlow's own Order state by the
 * reference carried in the return URL.
 *
 * TEST PHASE: while `LIVE_GEIDEA_ALLOWED` is false, a deployment configured
 * for a production Geidea account is refused here, whatever its credentials.
 * PRE_LAUNCH_MODE gates independently, first, and stays on.
 */

/** Flip only through the release process, with PRE_LAUNCH_MODE's own switch. */
const LIVE_GEIDEA_ALLOWED = false;

/** Every SaiFlow price is in riyals; the Geidea KSA rail settles in SAR. */
const CURRENCY = "SAR";

/** Geidea sessions expire 15 minutes after creation. Used until Geidea states its own. */
const SESSION_LIFETIME_MS = 15 * 60 * 1000;

/** The cookie the language switcher writes; see i18n.ts. Arabic-first default. */
const LOCALE_COOKIE = "NEXT_LOCALE";

type Language = "en" | "ar";

/**
 * The hosted page's language, from the visitor's locale cookie. Presentation
 * only: it decides nothing about money, and an unrecognised value falls back
 * to the site's Arabic default.
 */
function hostedPageLanguage(req: Request): Language {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(ar|en)(?:;|$)`));
  return match ? (match[1] as Language) : "ar";
}

/**
 * The origin every Geidea URL is built on. NEXTAUTH_URL is set per
 * deployment (production domain, preview host, localhost), which is what a
 * callback needs: it must reach THIS deployment's database. It is never taken
 * from the request. https is required except on localhost, where Geidea
 * itself will refuse the callback URL, which is the correct outcome.
 */
function trustedOrigin(): URL | null {
  const raw = env.NEXTAUTH_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  return url;
}

type LogFields = Record<string, string | number | null | undefined>;

/**
 * Identifiers, reasons and short codes only. Never a credential, body or URL,
 * and never a bearer in full: the merchant reference opens the purchased file
 * on the success channel, so it is logged redacted.
 */
function log(level: "log" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const text = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console[level](`[Checkout] ${event}${text.length > 0 ? ` ${text}` : ""}`);
}

/** What a Geidea client error may contribute to a log line: its class, status and short codes. */
function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: "Error" };
  const e = error as { status?: unknown; responseCode?: unknown; detailedResponseCode?: unknown };
  return {
    error: error.name,
    status: typeof e.status === "number" ? e.status : undefined,
    responseCode: typeof e.responseCode === "string" ? e.responseCode : undefined,
    detailedResponseCode: typeof e.detailedResponseCode === "string" ? e.detailedResponseCode : undefined,
  };
}

/** Geidea's ISO expiry carries seven fractional digits; Date wants at most three. */
function parseExpiry(value: string, fallback: Date): Date {
  const parsed = new Date(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function POST(req: Request) {
  // Pre-launch gate: defense in depth alongside the disabled BuyButton.
  // Returns 503 with a machine-readable error code so the client can show
  // a localized message rather than display the English fallback below.
  if (env.PRE_LAUNCH_MODE) {
    return NextResponse.json(
      {
        error: "pre_launch",
        message: "Saiflow is in pre-launch. Payments are not yet available.",
      },
      { status: 503 }
    );
  }

  // Abuse limit, before the body is even read: a limited caller learns
  // nothing about any product, writes no attempt row, and costs no provider
  // call. Fifteen per ten minutes per address allows a buyer's retries.
  if (!rateLimiters.checkout(getClientIp(req)).success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    const { productId } = await req.json();

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // Get the product from database.
    //
    // No `select`, so every scalar column is loaded — which includes the three
    // the safety gate below reads: fileKey, fileScanStatus and fileScanKey.
    // Narrowing this to a select would need all three added explicitly, or the
    // gate silently starts deciding on undefined.
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { shop: true },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    // Unpublished/unapproved products and deactivated shops must not be
    // purchasable, even by direct API call with a known product id.
    if (!product.isActive || product.moderationStatus !== "APPROVED" || !product.shop.isActive) {
      return NextResponse.json(
        { error: "This product is not available for purchase." },
        { status: 400 }
      );
    }

    // Check if product has a file uploaded
    if (!product.fileUrl) {
      return NextResponse.json(
        { error: "This product is not available for purchase. No file has been uploaded." },
        { status: 400 }
      );
    }

    /**
     * THE SALE GATE. Stage C computed a scan verdict; this is where it finally
     * decides something.
     *
     * `isDeliverableSafe` is the single reviewed authority and is called
     * directly — never re-derived, and never reduced to a `fileScanStatus`
     * check. It requires all three of: a non-null current `fileKey`, a SAFE
     * verdict, and that verdict being bound to THAT key. So a file still
     * queued, one whose scan errored, one the scanner rejected, and one whose
     * SAFE verdict belongs to a since-replaced upload all refuse here, as does
     * any status a later migration might add.
     *
     * Nothing a buyer sends reaches this decision: the only input from the
     * request is `productId`, and every field read below comes from the row.
     *
     * REPLACES A HEAD LIVENESS PROBE, which had to go rather than merely being
     * redundant. It fetched `product.fileUrl`, and since Stage B that URL names
     * a PRIVATE object — a HEAD against it answers 403, so the probe refused
     * every modern deliverable with "the file is no longer accessible". Left in
     * place behind this gate it would have blocked exactly the products that
     * pass it.
     *
     * What is genuinely lost with it: proof that the object resolves RIGHT NOW.
     * A SAFE verdict proves the bytes were fetched by key and scanned, not that
     * a seller has not deleted them since. That gap is recorded rather than
     * papered over — re-probing would mean minting a signed URL during
     * checkout, which this route must never do.
     */
    if (!isDeliverableSafe(product)) {
      // Machine-readable code plus an English fallback, matching the
      // `pre_launch` convention already used above. Deliberately says nothing
      // about WHICH state failed: a buyer has no business learning whether a
      // seller's file is unscanned or was rejected as malware.
      return NextResponse.json(
        {
          error: "file_not_ready",
          message:
            "This product is not available for purchase. Its file has not completed safety checks.",
        },
        { status: 400 }
      );
    }

    // Payments unconfigured => same behavior as pre-launch: unavailable.
    // GEIDEA_ENV has no default, so a deployment that never said which
    // account it is against is unconfigured, whatever credentials it holds.
    const configuredMode = geideaMode();
    if (!isGeideaConfigured() || configuredMode === null) {
      return NextResponse.json(
        { error: "pre_launch", message: "Payments are not yet available." },
        { status: 503 }
      );
    }

    // TEST PHASE. A production Geidea account is refused outright, so a
    // credentials swap alone can never start taking real money.
    if (!LIVE_GEIDEA_ALLOWED && configuredMode !== "test") {
      log("error", "refused", { reason: "live_geidea_not_allowed", product: product.id });
      return NextResponse.json(
        { error: "pre_launch", message: "Payments are not yet available." },
        { status: 503 }
      );
    }
    const environment = configuredMode === "production" ? "PRODUCTION" : "TEST";

    // Trusted money. The row's price, canonicalised exactly as the signature
    // and the callback comparison will render it; the row's currency, which
    // this rail requires to be SAR. A price the formatter refuses (zero, or
    // more than two decimals) is a product that cannot be sold, not a
    // rounding to attempt.
    const amount = canonicalAmount(product.price);
    if (amount === null || product.currency !== CURRENCY) {
      log("warn", "refused", { reason: "price_or_currency", product: product.id });
      return NextResponse.json(
        { error: "not_available", message: "This product is not available for purchase." },
        { status: 400 }
      );
    }

    // Both Geidea URLs come from the deployment's own origin, never from
    // the request. No origin, no checkout: a callback that could not reach
    // this deployment would leave every payment unfulfilled.
    const origin = trustedOrigin();
    if (origin === null) {
      log("error", "refused", { reason: "site_url", product: product.id });
      return NextResponse.json(
        { error: "pre_launch", message: "Payments are not yet available." },
        { status: 503 }
      );
    }
    const merchantReferenceId = randomUUID();
    const callbackUrl = new URL("/api/webhooks/geidea", origin).toString();
    const returnUrl = new URL("/success", origin);
    // The reference lets the success page ask SaiFlow for the attempt's own
    // Order state. The redirect itself proves nothing and is trusted for
    // nothing.
    returnUrl.searchParams.set("ref", merchantReferenceId);

    // The attempt, recorded before Geidea knows anything. The callback route
    // will check Geidea's answer against these values, never against itself.
    const attempt = await prisma.paymentSession.create({
      data: {
        merchantReferenceId,
        provider: "GEIDEA",
        productId: product.id,
        amount: product.price,
        currency: CURRENCY,
        environment,
        status: "CREATED",
        // The current checkout is a guest flow and sends no email; the
        // callback never reads one from Geidea. Null until a later step
        // collects it before the redirect.
        buyerEmail: null,
        expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
      },
      select: { id: true },
    });

    let created;
    try {
      created = await createSession({
        amount,
        currency: CURRENCY,
        merchantReferenceId,
        callbackUrl,
        returnUrl: returnUrl.toString(),
        language: hostedPageLanguage(req),
      });
    } catch (error) {
      // The attempt closes as failed. Conditional on CREATED so that nothing
      // that somehow moved it already is overwritten. No Order exists or can.
      await prisma.paymentSession.updateMany({
        where: { id: attempt.id, status: "CREATED" },
        data: { status: "FAILED", failureReason: "session_create_failed" },
      });
      log("warn", "session_create_failed", {
        attempt: attempt.id,
        ref: redactId(merchantReferenceId),
        product: product.id,
        ...errorFields(error),
      });
      return NextResponse.json(
        {
          error: "payment_unavailable",
          message: "The payment service could not start a checkout session. Please try again.",
        },
        { status: 502 }
      );
    }

    // Conditional on CREATED: if a callback for this session has somehow
    // already settled the attempt, this must not move it back.
    await prisma.paymentSession.updateMany({
      where: { id: attempt.id, status: "CREATED" },
      data: {
        providerSessionId: created.session.sessionId,
        status: "SESSION_CREATED",
        expiresAt: parseExpiry(
          created.session.expiryDate,
          new Date(Date.now() + SESSION_LIFETIME_MS)
        ),
      },
    });
    log("log", "session_created", {
      attempt: attempt.id,
      ref: redactId(merchantReferenceId),
      product: product.id,
      environment,
    });

    return NextResponse.json({ url: created.redirectUrl });
  } catch (error) {
    // Never the message: it could quote a body or a URL.
    log("error", "unhandled", { error: error instanceof Error ? error.name : "Error" });
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
