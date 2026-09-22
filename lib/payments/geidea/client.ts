/**
 * Geidea Checkout v2 — the server-side API client.
 *
 * SERVER-ONLY. It reads the merchant public key and the API password from
 * `lib/env`, whose server block throws if touched from a browser bundle, and
 * it refuses to load at all when a `window` exists. Nothing exported here is
 * safe to call from a client component, and nothing here should ever need to
 * be: the browser only ever receives a redirect URL.
 *
 * Two operations, both against `GEIDEA_API_BASE_URL`:
 *
 *   createSession  POST /payment-intent/api/v2/direct/session
 *   getOrder       GET  /pgw/api/v1/direct/order/{orderId}
 *
 * Both authenticate with HTTP Basic, username = merchant public key,
 * password = API password. The credentials are read at CALL time, never at
 * import, so this module can be imported in a build that has no Geidea
 * configuration, and they are never kept in a module-level variable that a
 * stack dump or a heap snapshot could surface.
 *
 * RESPONSES ARE DECODED, NOT TRUSTED. Every field the rest of SaiFlow will
 * read is checked for type and shape here and copied into a fresh object;
 * anything else in the body is dropped. A missing field, a wrong type, an id
 * that is not a UUID, a `responseCode` other than "000", or a body that is
 * not the JSON envelope at all: each throws before a value reaches a caller.
 * Fail closed means a purchase is never recorded on the strength of a reply
 * this module could not fully account for.
 *
 * NO LOGGING, on purpose. The request carries the Authorization header and
 * the response may carry buyer details; neither belongs in Vercel's logs.
 * Errors name the operation, an HTTP status, a JSON path or Geidea's short
 * response codes, and nothing else — never a header, a body or a credential.
 *
 * Nothing here decides whether a payment succeeded. `getOrder` returns the
 * status strings Geidea reports; what they mean for an Order is the callback
 * handler's decision, made in its own reviewed change.
 */

import { env } from "@/lib/env";
import {
  GeideaSignatureError,
  formatGeideaAmount,
  formatGeideaTimestamp,
  signCreateSession,
} from "@/lib/payments/geidea/signature";

if (typeof window !== "undefined") {
  throw new Error("lib/payments/geidea/client is server-only");
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type GeideaOperation = "createSession" | "getOrder";

/** One of the five GEIDEA_* variables is unset. Names the variable, never a value. */
export class GeideaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeideaConfigError";
  }
}

/** Our own input was invalid. Nothing was sent. */
export class GeideaRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeideaRequestError";
  }
}

/** No usable HTTP response: transport failure (status 0) or a non-2xx status. */
export class GeideaHttpError extends Error {
  readonly operation: GeideaOperation;
  readonly status: number;

  constructor(operation: GeideaOperation, status: number, detail: string) {
    super(
      status === 0
        ? `Geidea ${operation}: ${detail}`
        : `Geidea ${operation}: HTTP ${status}`
    );
    this.name = "GeideaHttpError";
    this.operation = operation;
    this.status = status;
  }
}

/**
 * A response arrived but cannot be used: not the documented shape
 * (`malformed`, with the JSON path that failed), a non-"000" response code
 * (`rejected`, with Geidea's short codes), or a field that does not match what
 * we sent (`mismatch`, with its path).
 */
export class GeideaResponseError extends Error {
  readonly operation: GeideaOperation;
  readonly kind: "malformed" | "rejected" | "mismatch";
  readonly path: string | null;
  readonly responseCode: string | null;
  readonly detailedResponseCode: string | null;
  readonly status: number | null;

  constructor(
    operation: GeideaOperation,
    kind: "malformed" | "rejected" | "mismatch",
    details: {
      path?: string;
      responseCode?: string;
      detailedResponseCode?: string;
      status?: number;
    } = {}
  ) {
    const codes =
      details.responseCode === undefined
        ? ""
        : details.detailedResponseCode === undefined
          ? details.responseCode
          : `${details.responseCode}/${details.detailedResponseCode}`;
    super(
      kind === "malformed"
        ? `Geidea ${operation}: malformed response at ${details.path ?? "$"}`
        : kind === "rejected"
          ? `Geidea ${operation}: rejected with responseCode ${codes}` +
            (details.status === undefined ? "" : ` (HTTP ${details.status})`)
          : `Geidea ${operation}: response does not match the request at ${details.path ?? "$"}`
    );
    this.name = "GeideaResponseError";
    this.operation = operation;
    this.kind = kind;
    this.path = details.path ?? null;
    this.responseCode = details.responseCode ?? null;
    this.detailedResponseCode = details.detailedResponseCode ?? null;
    this.status = details.status ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

interface GeideaConfig {
  merchantPublicKey: string;
  apiPassword: string;
  apiBaseUrl: string;
  hppBaseUrl: string;
  mode: "test" | "production";
}

const REQUIRED_VARS = [
  "GEIDEA_MERCHANT_PUBLIC_KEY",
  "GEIDEA_API_PASSWORD",
  "GEIDEA_API_BASE_URL",
  "GEIDEA_HPP_BASE_URL",
  "GEIDEA_ENV",
] as const;

function isSet(name: (typeof REQUIRED_VARS)[number]): boolean {
  const value = env[name];
  return typeof value === "string" && value.length > 0;
}

/** True when every credential, host and the mode are present. Never throws. */
export function isGeideaConfigured(): boolean {
  return REQUIRED_VARS.every(isSet);
}

/**
 * "test" or "production" exactly as configured, or null when GEIDEA_ENV is
 * unset. There is no default and nothing is inferred from the credentials:
 * a caller that sees null must treat Geidea as not configured.
 */
export function geideaMode(): "test" | "production" | null {
  return env.GEIDEA_ENV ?? null;
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Read the configuration for one call. Throws `GeideaConfigError` naming the
 * missing variables, so a half-configured deployment fails at the first call
 * with a message that says exactly what to set, and never with a 401 from
 * Geidea that says nothing.
 */
function readConfig(): GeideaConfig {
  const missing = REQUIRED_VARS.filter((name) => !isSet(name));
  if (missing.length > 0) {
    throw new GeideaConfigError(
      `Geidea is not configured: ${missing.join(", ")} not set`
    );
  }
  return {
    merchantPublicKey: env.GEIDEA_MERCHANT_PUBLIC_KEY as string,
    apiPassword: env.GEIDEA_API_PASSWORD as string,
    apiBaseUrl: trimTrailingSlashes(env.GEIDEA_API_BASE_URL as string),
    hppBaseUrl: trimTrailingSlashes(env.GEIDEA_HPP_BASE_URL as string),
    mode: env.GEIDEA_ENV as "test" | "production",
  };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * Injection points. Production code passes nothing. Tests pass a recording
 * `fetchImpl` so that no request can leave the process, and a fixed `now` so
 * the signed timestamp — and therefore the signature — is predictable.
 */
export interface GeideaClientDeps {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Abort the HTTP call after this long. The route budget on Vercel is 30s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const SESSION_PATH = "/payment-intent/api/v2/direct/session";
const ORDER_PATH = "/pgw/api/v1/direct/order";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY_CODE = /^[A-Z]{3}$/;
/** Geidea's response codes are short ("000", "100"); anything longer is not one. */
const SHORT_CODE = /^[0-9A-Za-z_-]{1,8}$/;

function basicAuthorization(config: GeideaConfig): string {
  const token = Buffer.from(
    `${config.merchantPublicKey}:${config.apiPassword}`,
    "utf8"
  ).toString("base64");
  return `Basic ${token}`;
}

/** Only an error's class name. Its message can carry a URL or an abort reason. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

/**
 * One HTTP exchange. Returns the parsed JSON body of a 2xx response and
 * throws for everything else. The Authorization header exists only inside
 * this function's `headers` object and is never copied anywhere.
 */
async function send(
  config: GeideaConfig,
  deps: GeideaClientDeps,
  operation: GeideaOperation,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {
    Authorization: basicAuthorization(config),
    Accept: "application/json",
  };
  const init: RequestInit = {
    method,
    headers,
    // Next.js patches fetch; a payment status must never come from a cache.
    cache: "no-store",
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetchImpl(`${config.apiBaseUrl}${path}`, init);
  } catch (error) {
    throw new GeideaHttpError(operation, 0, `no response (${errorName(error)})`);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new GeideaHttpError(
      operation,
      0,
      `unreadable response (${errorName(error)})`
    );
  }

  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    // Geidea answers some refusals with 4xx and its own codes in the body.
    // Those codes are the useful part; the status alone is the fallback.
    const codes = responseCodes(json);
    if (codes !== null) {
      throw new GeideaResponseError(operation, "rejected", {
        ...codes,
        status: response.status,
      });
    }
    throw new GeideaHttpError(operation, response.status, "");
  }
  if (json === undefined) {
    throw new GeideaResponseError(operation, "malformed", { path: "$" });
  }
  return json;
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(operation: GeideaOperation, path: string): GeideaResponseError {
  return new GeideaResponseError(operation, "malformed", { path });
}

/** `responseCode`, and `detailedResponseCode` when it is also a short code. */
function responseCodes(
  json: unknown
): { responseCode: string; detailedResponseCode?: string } | null {
  if (!isObject(json)) return null;
  const { responseCode, detailedResponseCode } = json;
  if (typeof responseCode !== "string" || !SHORT_CODE.test(responseCode)) {
    return null;
  }
  return typeof detailedResponseCode === "string" &&
    SHORT_CODE.test(detailedResponseCode)
    ? { responseCode, detailedResponseCode }
    : { responseCode };
}

/** The envelope every Geidea reply shares: an object whose responseCode is "000". */
function decodeEnvelope(json: unknown, operation: GeideaOperation): JsonObject {
  if (!isObject(json)) throw malformed(operation, "$");
  const codes = responseCodes(json);
  if (codes === null) throw malformed(operation, "$.responseCode");
  if (codes.responseCode !== "000") {
    throw new GeideaResponseError(operation, "rejected", codes);
  }
  return json;
}

function objectField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): JsonObject {
  const value = obj[key];
  if (!isObject(value)) throw malformed(operation, `${path}.${key}`);
  return value;
}

function stringField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw malformed(operation, `${path}.${key}`);
  }
  return value;
}

function optionalStringField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): string | null {
  const value = obj[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw malformed(operation, `${path}.${key}`);
  return value;
}

function numberField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw malformed(operation, `${path}.${key}`);
  }
  return value;
}

function optionalNumberField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): number | null {
  const value = obj[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw malformed(operation, `${path}.${key}`);
  }
  return value;
}

/**
 * An id that will be interpolated into a URL. Restricting it to the UUID
 * alphabet is what makes that interpolation safe: no slash, no query, no
 * fragment can ride along in a value Geidea returned.
 */
function uuidField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): string {
  const value = stringField(obj, key, path, operation);
  if (!UUID.test(value)) throw malformed(operation, `${path}.${key}`);
  return value;
}

function currencyField(
  obj: JsonObject,
  key: string,
  path: string,
  operation: GeideaOperation
): string {
  const value = stringField(obj, key, path, operation);
  if (!CURRENCY_CODE.test(value)) throw malformed(operation, `${path}.${key}`);
  return value;
}

/* ------------------------------------------------------------------ */
/* createSession                                                       */
/* ------------------------------------------------------------------ */

export interface CreateSessionInput {
  /** Two decimals at most; a number or a decimal string such as a Prisma Decimal's toString(). */
  amount: number | string;
  /** ISO 4217, upper case: "SAR". */
  currency: string;
  /** Our own reference for this attempt. Geidea requires a UUID. */
  merchantReferenceId: string;
  /** Where Geidea posts the result. Must be https. */
  callbackUrl: string;
  /** Where the buyer is sent afterwards. Must be https. */
  returnUrl: string;
  /** Hosted page language. */
  language: "en" | "ar";
}

/** The fields of Geidea's session object that SaiFlow reads. Nothing else survives decoding. */
export interface GeideaSession {
  sessionId: string;
  amount: number;
  currency: string;
  status: string;
  expiryDate: string;
  merchantReferenceId: string | null;
}

export interface CreateSessionResult {
  session: GeideaSession;
  /** The hosted checkout page for this session, on GEIDEA_HPP_BASE_URL. */
  redirectUrl: string;
  /** The timestamp that was signed and sent, for the caller's own record. */
  timestamp: string;
}

interface ValidatedCreateSessionInput {
  amount: string;
  currency: string;
  merchantReferenceId: string;
  callbackUrl: string;
  returnUrl: string;
  language: "en" | "ar";
}

function httpsUrl(name: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new GeideaRequestError(`${name} must be an https URL`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GeideaRequestError(`${name} must be an https URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new GeideaRequestError(`${name} must be an https URL`);
  }
  return value;
}

/**
 * Everything is checked before a byte is sent, and the error says which
 * field, never its value. The amount goes through the same formatter the
 * signature uses, so the body and the signature cannot disagree about it.
 */
function validateCreateSessionInput(
  input: CreateSessionInput
): ValidatedCreateSessionInput {
  if (input === null || typeof input !== "object") {
    throw new GeideaRequestError("createSession input must be an object");
  }

  let amount: string;
  try {
    amount = formatGeideaAmount(input.amount);
  } catch (error) {
    throw new GeideaRequestError(
      error instanceof GeideaSignatureError ? error.message : "amount is invalid"
    );
  }
  if (typeof input.currency !== "string" || !CURRENCY_CODE.test(input.currency)) {
    throw new GeideaRequestError(
      "currency must be a 3-letter uppercase ISO 4217 code"
    );
  }
  if (
    typeof input.merchantReferenceId !== "string" ||
    !UUID.test(input.merchantReferenceId)
  ) {
    throw new GeideaRequestError("merchantReferenceId must be a UUID");
  }
  const callbackUrl = httpsUrl("callbackUrl", input.callbackUrl);
  const returnUrl = httpsUrl("returnUrl", input.returnUrl);
  if (input.language !== "en" && input.language !== "ar") {
    throw new GeideaRequestError('language must be "en" or "ar"');
  }

  return {
    amount,
    currency: input.currency,
    merchantReferenceId: input.merchantReferenceId,
    callbackUrl,
    returnUrl,
    language: input.language,
  };
}

function checkoutRedirectUrlFor(config: GeideaConfig, sessionId: string): string {
  if (typeof sessionId !== "string" || !UUID.test(sessionId)) {
    throw new GeideaRequestError("sessionId must be a UUID");
  }
  return `${config.hppBaseUrl}/hpp/checkout/?${sessionId}`;
}

/** The hosted checkout page for an existing session id. */
export function checkoutRedirectUrl(sessionId: string): string {
  return checkoutRedirectUrlFor(readConfig(), sessionId);
}

/**
 * Create a hosted-checkout session.
 *
 * The body carries the amount as a JSON number and the signature over its
 * two-decimal rendering; Geidea normalises to two decimals on its side, so
 * the two agree. The reply is decoded and then checked against what was
 * sent: a session for a different amount, currency or reference is refused
 * as a `mismatch`, because a redirect to the wrong session is not something
 * to discover at the callback.
 */
export async function createSession(
  input: CreateSessionInput,
  deps: GeideaClientDeps = {}
): Promise<CreateSessionResult> {
  const config = readConfig();
  const request = validateCreateSessionInput(input);
  const timestamp = formatGeideaTimestamp((deps.now ?? (() => new Date()))());
  const signature = signCreateSession(
    {
      merchantPublicKey: config.merchantPublicKey,
      amount: request.amount,
      currency: request.currency,
      merchantReferenceId: request.merchantReferenceId,
      timestamp,
    },
    config.apiPassword
  );

  const body = {
    amount: Number(request.amount),
    currency: request.currency,
    timestamp,
    merchantReferenceId: request.merchantReferenceId,
    signature,
    callbackUrl: request.callbackUrl,
    returnUrl: request.returnUrl,
    language: request.language,
    paymentOperation: "Pay",
  };

  const json = await send(config, deps, "createSession", "POST", SESSION_PATH, body);
  const envelope = decodeEnvelope(json, "createSession");
  const raw = objectField(envelope, "session", "$", "createSession");
  const session: GeideaSession = {
    sessionId: uuidField(raw, "id", "$.session", "createSession"),
    amount: numberField(raw, "amount", "$.session", "createSession"),
    currency: currencyField(raw, "currency", "$.session", "createSession"),
    status: stringField(raw, "status", "$.session", "createSession"),
    expiryDate: stringField(raw, "expiryDate", "$.session", "createSession"),
    merchantReferenceId: optionalStringField(
      raw,
      "merchantReferenceId",
      "$.session",
      "createSession"
    ),
  };

  if (Math.abs(session.amount - Number(request.amount)) > 1e-6) {
    throw new GeideaResponseError("createSession", "mismatch", { path: "$.session.amount" });
  }
  if (session.currency !== request.currency) {
    throw new GeideaResponseError("createSession", "mismatch", { path: "$.session.currency" });
  }
  if (
    session.merchantReferenceId !== null &&
    session.merchantReferenceId !== request.merchantReferenceId
  ) {
    throw new GeideaResponseError("createSession", "mismatch", {
      path: "$.session.merchantReferenceId",
    });
  }

  return {
    session,
    redirectUrl: checkoutRedirectUrlFor(config, session.sessionId),
    timestamp,
  };
}

/* ------------------------------------------------------------------ */
/* getOrder                                                            */
/* ------------------------------------------------------------------ */

/** The fields of Geidea's order object that SaiFlow reads. Nothing else survives decoding. */
export interface GeideaOrder {
  orderId: string;
  status: string;
  detailedStatus: string | null;
  amount: number;
  currency: string;
  merchantReferenceId: string | null;
  totalRefundedAmount: number | null;
}

/**
 * Fetch an order by Geidea's order id, for reconciling a purchase whose
 * callback was late or lost. The id is validated as a UUID before it is
 * placed in the URL path, and the reply's own id must match it.
 */
export async function getOrder(
  orderId: string,
  deps: GeideaClientDeps = {}
): Promise<GeideaOrder> {
  const config = readConfig();
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    throw new GeideaRequestError("orderId must be a UUID");
  }

  const json = await send(config, deps, "getOrder", "GET", `${ORDER_PATH}/${orderId}`);
  const envelope = decodeEnvelope(json, "getOrder");
  const raw = objectField(envelope, "order", "$", "getOrder");
  const order: GeideaOrder = {
    orderId: uuidField(raw, "orderId", "$.order", "getOrder"),
    status: stringField(raw, "status", "$.order", "getOrder"),
    detailedStatus: optionalStringField(raw, "detailedStatus", "$.order", "getOrder"),
    amount: numberField(raw, "amount", "$.order", "getOrder"),
    currency: currencyField(raw, "currency", "$.order", "getOrder"),
    merchantReferenceId: optionalStringField(
      raw,
      "merchantReferenceId",
      "$.order",
      "getOrder"
    ),
    totalRefundedAmount: optionalNumberField(
      raw,
      "totalRefundedAmount",
      "$.order",
      "getOrder"
    ),
  };

  if (order.orderId.toLowerCase() !== orderId.toLowerCase()) {
    throw new GeideaResponseError("getOrder", "mismatch", { path: "$.order.orderId" });
  }

  return order;
}
