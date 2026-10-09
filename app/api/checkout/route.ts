import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { isDeliverableSafe } from "@/lib/file-safety";
import { rateLimiters, getClientIp } from "@/lib/rate-limit";
import { redactId } from "@/lib/redact-id";
import {
  checkoutRedirectUrl,
  checkoutScriptUrl,
  createSession,
  geideaMode,
  isGeideaConfigured,
} from "@/lib/payments/geidea/client";
import type { SessionAppearance } from "@/lib/payments/geidea/client";
import { canonicalAmount } from "@/lib/payments/geidea/callback";
import {
  SESSION_CREATE_FAILED,
  attemptKey,
  bearerCookie,
  bearerHash,
  decide,
  newBearer,
  readBearer,
  releaseArgs,
  type CurrentAttempt,
  type Decision,
  type Expected,
  type Presentation as AttemptPresentation,
} from "@/lib/checkout/attempt";
import { normalizeBuyerEmail } from "@/lib/checkout/buyer-email";

/**
 * Checkout: the one place a purchase attempt begins.
 *
 * Every gate that existed before Geidea still runs first, in the same order:
 * pre-launch, a real product, moderation and shop visibility, an attached
 * file, and the reviewed deliverable-safety predicate. Only past all of them
 * does money enter the picture, and then nothing the browser sent is used
 * again: the body contributes `productId`, which selects the product, and
 * `buyerEmail`, which is only where the receipt goes (lib/checkout/buyer-email)
 * and decides nothing about money, the attempt or the file. The amount is the
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
 *
 * TWO PRESENTATIONS, ONE PURCHASE. By default Geidea's form opens on its own
 * hosted page and the reply is `{ url }`, exactly as before. SaiFlow's own
 * checkout page asks for `?presentation=dropin` instead, and receives what it
 * needs to embed Geidea's form: the session id, Geidea's library URL, the
 * session's expiry and the success path. The choice lives in the query
 * string so the body contract is untouched, and it selects presentation and
 * nothing else: the gates, the attempt row, the amount, the currency, the
 * reference, the environment and both Geidea URLs are identical either way,
 * and the verified callback remains the only thing that makes an Order.
 *
 * ONE CURRENT ATTEMPT PER BROWSER AND PRODUCT (lib/checkout/attempt). Every
 * new attempt is a separately payable Geidea session, so a reload, a retry,
 * a second tab or a fallback must never mint a second one while the first
 * could still take money. A request without the browser's HttpOnly bearer
 * is answered with a bearer and nothing else, so a session is only ever
 * created for a bearer the browser already held. A request bearing it, for
 * the same product, is answered from that browser's attempt: the same
 * session, re-checked against today's trusted values; or that attempt's
 * status page, for as long as its outcome is unknown; or, only when no
 * session id from it ever reached a browser, a replacement. The database's
 * unique `currentAttemptKey` holds this when requests race, and every
 * release and every stored session id is a conditional write whose count is
 * checked. The bearer chooses nothing about money.
 */

/** Flip only through the release process, with PRE_LAUNCH_MODE's own switch. */
const LIVE_GEIDEA_ALLOWED = false;

/** Every SaiFlow price is in riyals; the Geidea KSA rail settles in SAR. */
const CURRENCY = "SAR";

/**
 * TEST PHASE ONLY: where Geidea sends test-account callbacks. Preview
 * deployments sit behind Vercel Authentication, which Geidea cannot pass, so
 * test callbacks go to SaiFlow's separate relay project, which verifies its
 * own Vercel identity and forwards the unchanged body to this branch's
 * Preview through Trusted Sources. Fixed here, never configurable and never
 * from a request. The relay only delivers: the callback route still checks
 * Geidea's signature, the attempt row and Geidea's own order inquiry. A
 * production-account checkout keeps using this deployment's own URL.
 */
const TEST_CALLBACK_RELAY_URL = "https://project-w5bhm.vercel.app/api/geidea-callback";

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

type Presentation = "redirect" | "dropin";

/** Absent means the hosted page, as before; anything but these two is refused. */
function requestedPresentation(req: Request): Presentation | null {
  const value = new URL(req.url).searchParams.get("presentation");
  if (value === null) return "redirect";
  return value === "dropin" ? "dropin" : null;
}

/**
 * SaiFlow's embedded checkout, in Geidea's documented appearance fields only:
 * the drop-in presentation, compact, in SaiFlow's accent, asking the buyer
 * for nothing but payment, and handing control straight back to SaiFlow
 * instead of showing Geidea's own receipt. No logo: none of SaiFlow's current
 * image assets suits a payment form, and the page around the frame already
 * carries the brand.
 */
const DROPIN_APPEARANCE: SessionAppearance = {
  uiMode: "dropin",
  showEmail: false,
  showAddress: false,
  showPhone: false,
  receiptPage: false,
  merchant: { name: "SaiFlow" },
  styles: { headerColor: "#14b8a6", hideGeideaLogo: true, hppProfile: "compressed" },
};

/** Geidea's ISO expiry carries seven fractional digits; Date wants at most three. */
function parseExpiry(value: string, fallback: Date): Date {
  const parsed = new Date(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/** SaiFlow's status page for one attempt: the success page, by its reference. */
function statusPathFor(merchantReferenceId: string): string {
  return `/success?ref=${encodeURIComponent(merchantReferenceId)}`;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
}

/** Prisma's unique-constraint violation; on attempt creation only currentAttemptKey can collide. */
function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === "P2002";
}

/** Prisma's foreign-key violation: here, a product deleted between its read and the attempt's insert. */
function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === "P2003";
}

type HeldAttempt = CurrentAttempt & { id: string; buyerEmail: string | null };

/** This browser's current attempt for this product, if it has one. */
async function currentAttempt(key: string): Promise<HeldAttempt | null> {
  return prisma.paymentSession.findUnique({
    where: { currentAttemptKey: key },
    select: {
      id: true,
      merchantReferenceId: true,
      clientTokenHash: true,
      productId: true,
      provider: true,
      environment: true,
      amount: true,
      currency: true,
      status: true,
      presentation: true,
      providerSessionId: true,
      failureReason: true,
      expiresAt: true,
      createdAt: true,
      buyerEmail: true,
      order: { select: { id: true } },
    },
  });
}

/**
 * The answer for a browser whose current attempt stands: the same session,
 * or that attempt's status page. Never a new session. A status path goes
 * only to the bearer the attempt was made for.
 */
function answerExisting(
  held: HeldAttempt,
  decision: Exclude<Decision, { kind: "replace" }>,
  presentation: Presentation,
  scriptUrl: string | null,
  cookie: string
): NextResponse {
  const statusPath = statusPathFor(held.merchantReferenceId);
  const fields = { attempt: held.id, ref: redactId(held.merchantReferenceId) };
  switch (decision.kind) {
    case "resume":
      log("log", "attempt_resumed", { ...fields, presentation });
      return NextResponse.json(
        presentation === "dropin"
          ? {
              sessionId: decision.sessionId,
              scriptUrl,
              expiresAt: decision.expiresAt.toISOString(),
              successPath: statusPath,
            }
          : { url: checkoutRedirectUrl(decision.sessionId) },
        { headers: { "Set-Cookie": cookie } }
      );
    case "paid":
      log("log", "attempt_paid", fields);
      return NextResponse.json({ error: "already_paid", statusPath }, { status: 409 });
    case "pending":
      log("log", "attempt_pending", fields);
      return NextResponse.json({ error: "attempt_pending", statusPath }, { status: 409 });
    case "open":
      log("log", "attempt_open", { ...fields, reason: decision.reason });
      return NextResponse.json(
        decision.reason === "bearer" ? { error: "attempt_open" } : { error: "attempt_open", statusPath },
        { status: 409 }
      );
  }
}

/**
 * The answer when this browser's attempt changed under the request: a
 * callback claimed it, or another of the browser's own requests released or
 * created it first. Whatever the attempt is now decides, and nothing new is
 * started from here.
 */
async function answerCurrent(
  key: string,
  expected: Expected,
  presentation: Presentation,
  scriptUrl: string | null,
  cookie: string
): Promise<NextResponse> {
  const current = await currentAttempt(key);
  if (current === null) {
    return NextResponse.json({ error: "attempt_pending" }, { status: 409 });
  }
  const decision = decide(current, expected, new Date());
  return answerExisting(
    current,
    decision.kind === "replace" ? { kind: "pending" } : decision,
    presentation,
    scriptUrl,
    cookie
  );
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

  const presentation = requestedPresentation(req);
  if (presentation === null) {
    return NextResponse.json({ error: "invalid_presentation" }, { status: 400 });
  }

  try {
    const { productId, buyerEmail: submittedEmail } = await req.json();

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // Where the receipt goes. Required, so every purchase can reach its
    // buyer again after the success page is closed. Checked with the same
    // rule the checkout page applied before asking.
    const buyerEmail = normalizeBuyerEmail(submittedEmail);
    if (buyerEmail === null) {
      return NextResponse.json({ error: "invalid_email" }, { status: 400 });
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
    // The embedded form loads Geidea's library from the configured hosted-page
    // host. Resolved before anything is recorded, so a host that cannot serve
    // it over https refuses cleanly rather than leaving an attempt behind.
    let scriptUrl: string | null = null;
    if (presentation === "dropin") {
      try {
        scriptUrl = checkoutScriptUrl();
      } catch (error) {
        log("error", "refused", { reason: "script_url", product: product.id, ...errorFields(error) });
        return NextResponse.json(
          { error: "payment_unavailable", message: "Payments are not yet available." },
          { status: 503 }
        );
      }
    }

    // THE BROWSER'S CHECKOUT IDENTITY COMES FIRST. A request that does not
    // already hold a bearer is given one and nothing else: no attempt, no
    // Geidea session. Two first requests racing from two tabs therefore
    // start nothing payable between them, and the session the browser later
    // asks for belongs to a bearer it already held, which every tab, reload
    // and retry presents again. The bearer only says whose attempt to look
    // at; it never sets an amount, an outcome or a right to a file.
    const heldBearer = readBearer(req.headers.get("cookie"));
    const secureCookie = origin.protocol === "https:";
    if (heldBearer === null) {
      log("log", "identity_issued", { product: product.id });
      return NextResponse.json(
        { error: "identity_required" },
        { status: 428, headers: { "Set-Cookie": bearerCookie(newBearer(), secureCookie) } }
      );
    }

    // This browser's current attempt for this product. Everything compared
    // below came from the product row and the deployment.
    const presented: AttemptPresentation = presentation === "dropin" ? "DROPIN" : "REDIRECT";
    const tokenHash = bearerHash(heldBearer);
    const key = attemptKey(tokenHash, product.id);
    const cookie = bearerCookie(heldBearer, secureCookie);
    const expected: Expected = {
      tokenHash,
      productId: product.id,
      environment,
      amount,
      currency: CURRENCY,
      presentation: presented,
    };

    const held = await currentAttempt(key);
    if (held !== null) {
      const decision = decide(held, expected, new Date());
      if (decision.kind !== "replace") {
        if (decision.kind === "resume" && held.buyerEmail !== buyerEmail) {
          // The buyer corrected their address before paying. Receipt only:
          // conditional on the attempt still being this browser's current
          // one and unpaid, and nothing else about it changes.
          await prisma.paymentSession.updateMany({
            where: { id: held.id, currentAttemptKey: key, status: { not: "PAID" } },
            data: { buyerEmail },
          });
        }
        return answerExisting(held, decision, presentation, scriptUrl, cookie);
      }
      // No session id from it ever reached a browser. Released in one
      // conditional statement that matches only while it is still current and
      // still in exactly that state: a callback that claimed it, or another
      // request that got here first, leaves nothing to match, and then the
      // attempt as it is now is the answer. Nothing is started on a release
      // that did not happen.
      const released = await prisma.paymentSession.updateMany(releaseArgs(held.id, key, decision.when));
      if (released.count !== 1) {
        log("log", "attempt_release_refused", { attempt: held.id, product: product.id });
        return answerCurrent(key, expected, presentation, scriptUrl, cookie);
      }
      log("log", "attempt_superseded", {
        attempt: held.id,
        ref: redactId(held.merchantReferenceId),
        product: product.id,
      });
    }

    const merchantReferenceId = randomUUID();
    const callbackUrl =
      environment === "TEST" ? TEST_CALLBACK_RELAY_URL : new URL("/api/webhooks/geidea", origin).toString();
    const returnUrl = new URL("/success", origin);
    // The reference lets the success page ask SaiFlow for the attempt's own
    // Order state. The redirect itself proves nothing and is trusted for
    // nothing.
    returnUrl.searchParams.set("ref", merchantReferenceId);

    // The attempt, recorded before Geidea knows anything. The callback route
    // will check Geidea's answer against these values, never against itself.
    // It is current for this browser and product from the moment it exists.
    let attempt: { id: string };
    try {
      attempt = await prisma.paymentSession.create({
        data: {
          merchantReferenceId,
          provider: "GEIDEA",
          productId: product.id,
          amount: product.price,
          currency: CURRENCY,
          environment,
          status: "CREATED",
          // The receipt address, collected on SaiFlow's checkout page before
          // the session was asked for. The callback never reads one from
          // Geidea; fulfilment copies this one onto the Order.
          buyerEmail,
          expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS),
          clientTokenHash: tokenHash,
          currentAttemptKey: key,
          presentation: presented,
        },
        select: { id: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Another request from this browser, for this product, made the
        // current attempt first. Answer from that one; never a second.
        return answerCurrent(key, expected, presentation, scriptUrl, cookie);
      }
      if (isForeignKeyViolation(error)) {
        // The product was deleted after it was read. The database refused
        // the attempt rather than keep one without its product.
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
      throw error;
    }

    let created;
    try {
      created = await createSession({
        amount,
        currency: CURRENCY,
        merchantReferenceId,
        callbackUrl,
        returnUrl: returnUrl.toString(),
        language: hostedPageLanguage(req),
        ...(presentation === "dropin" ? { appearance: DROPIN_APPEARANCE } : {}),
      });
    } catch (error) {
      // The attempt closes as failed. Conditional on CREATED so that nothing
      // that somehow moved it already is overwritten. No Order exists or can.
      // No session id reached the browser, so nothing can pay it: it stops
      // being current, and the buyer's next try may start a new attempt.
      await prisma.paymentSession.updateMany({
        where: { id: attempt.id, status: "CREATED" },
        data: { status: "FAILED", failureReason: SESSION_CREATE_FAILED, currentAttemptKey: null },
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

    // Stored before any reply carries it, and only while the attempt is still
    // CREATED. If it is not, it was replaced while Geidea was asked (a
    // release closes a CREATED attempt in the same statement), and this
    // session id goes to no browser at all: nothing can pay it. The browser
    // is answered from the attempt that is current now.
    const expiresAt = parseExpiry(
      created.session.expiryDate,
      new Date(Date.now() + SESSION_LIFETIME_MS)
    );
    const stored = await prisma.paymentSession.updateMany({
      where: { id: attempt.id, status: "CREATED" },
      data: {
        providerSessionId: created.session.sessionId,
        status: "SESSION_CREATED",
        expiresAt,
      },
    });
    if (stored.count !== 1) {
      log("warn", "session_withheld", { attempt: attempt.id, product: product.id });
      return answerCurrent(key, expected, presentation, scriptUrl, cookie);
    }
    log("log", "session_created", {
      attempt: attempt.id,
      ref: redactId(merchantReferenceId),
      product: product.id,
      environment,
      presentation,
    });

    // The bearer goes back with the session, so this browser's next request
    // for this product finds this attempt instead of starting another.
    if (presentation === "dropin") {
      // What the embedded form needs and nothing more. The success path
      // carries only the reference the hosted page would otherwise hand the
      // buyer on return; the success page, and the status endpoint behind
      // it, remain the only things that say whether anything was paid.
      return NextResponse.json(
        {
          sessionId: created.session.sessionId,
          scriptUrl,
          expiresAt: expiresAt.toISOString(),
          successPath: statusPathFor(merchantReferenceId),
        },
        { headers: { "Set-Cookie": cookie } }
      );
    }
    return NextResponse.json({ url: created.redirectUrl }, { headers: { "Set-Cookie": cookie } });
  } catch (error) {
    // Never the message: it could quote a body or a URL.
    log("error", "unhandled", { error: error instanceof Error ? error.name : "Error" });
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
