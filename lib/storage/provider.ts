/**
 * Server-side access to private storage objects.
 *
 * Deliverables are uploaded with `acl: "private"`, so they are not readable by
 * URL. Reading one requires a short-lived signed URL, and this module is the
 * only place allowed to mint one.
 *
 * There are exactly two ways out of here, and they have deliberately different
 * contracts:
 *
 *   SCAN PATH — `readPrivateObject`. Returns BYTES. The signed URL it mints
 *     never leaves the function: not to a caller, not to a log, not to the
 *     database. Nothing about scanning requires a URL to escape, so none does.
 *
 *   DELIVERY PATH — `createDeliveryUrl`. Returns a short-lived URL, precisely
 *     because its whole purpose is to hand bytes to a human who is entitled to
 *     them. It mints and validates; it decides nothing. Every caller MUST have
 *     already passed an authorisation gate (who is asking) AND a safety gate
 *     (`isDeliverableSafe`, or an audited, explicit admin override) before it
 *     is called. This function cannot check either, and does not try to.
 *
 * So the invariant is not "no signed URL ever leaves this module" — it is:
 *
 *   the scan path never exposes a signed URL, and the delivery path exposes
 *   one only downstream of an upstream authorisation and safety decision.
 *
 * Two further rules apply to both:
 *
 *   1. Objects are addressed by KEY, never by the stored `fileUrl`. `fileUrl`
 *      is a string that once passed validation; the key is the identity the
 *      scan verdict binds to. Working from the key means the bytes we hash,
 *      scan and later deliver are definitionally the bytes that key names.
 *   2. Failure is failure. Nothing here falls back to an unsigned URL, and no
 *      error path returns a URL.
 *
 * This module must never be imported by a client component: it reads the
 * UploadThing token.
 */

import { UTApi } from "uploadthing/server";

/**
 * Largest object the scan pipeline will move.
 *
 * The scanner transfers each file twice — storage to this function, then this
 * function to the provider — inside one serverless invocation. 128MB is the
 * ceiling every upload route now enforces, so a file above this is either a
 * legacy object or a configuration mistake; either way it is refused rather
 * than truncated.
 */
export const MAX_SCANNABLE_BYTES = 128 * 1024 * 1024;

/** How long a minted signed URL stays valid. Long enough to fetch, no longer. */
const SIGNED_URL_TTL_SECONDS = 120;

export type StorageReadFailure =
  | "storage_unconfigured"
  | "sign_failed"
  | "fetch_failed"
  | "too_large"
  | "empty";

export type StorageReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: StorageReadFailure };

let cachedApi: UTApi | null = null;

function api(): UTApi | null {
  if (cachedApi) return cachedApi;
  if (!process.env.UPLOADTHING_TOKEN) return null;
  cachedApi = new UTApi();
  return cachedApi;
}

/** Whether private reads are possible at all in this environment. */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.UPLOADTHING_TOKEN);
}

/**
 * Read a private object's bytes by key.
 *
 * Fails closed on every error path. A caller must treat `ok: false` as "no
 * bytes", never as "assume fine" — the scan pipeline maps each reason to
 * SCAN_ERROR, which is not SAFE.
 */
export async function readPrivateObject(
  key: string,
  opts: { maxBytes?: number } = {}
): Promise<StorageReadResult> {
  const utapi = api();
  if (!utapi) return { ok: false, reason: "storage_unconfigured" };

  const maxBytes = opts.maxBytes ?? MAX_SCANNABLE_BYTES;

  let signedUrl: string;
  try {
    // Signed locally by the SDK — no round trip to UploadThing. The value is
    // held in this scope only and is never returned, logged or stored.
    const signed = await utapi.generateSignedURL(key, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
    signedUrl = signed.ufsUrl;
  } catch {
    // Deliberately swallows the cause: an UploadThing error can echo the URL
    // it was signing.
    return { ok: false, reason: "sign_failed" };
  }

  try {
    const res = await fetch(signedUrl, {
      method: "GET",
      signal: AbortSignal.timeout(60_000),
    });
    // A key that is not in our account signs fine but does not resolve, so
    // this is also the "not ours" path.
    if (!res.ok) return { ok: false, reason: "fetch_failed" };

    // Trust the header only to reject early; the real check is on the bytes.
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) return { ok: false, reason: "too_large" };

    const buffer = new Uint8Array(await res.arrayBuffer());
    if (buffer.byteLength === 0) return { ok: false, reason: "empty" };
    if (buffer.byteLength > maxBytes) return { ok: false, reason: "too_large" };

    return { ok: true, bytes: buffer };
  } catch {
    return { ok: false, reason: "fetch_failed" };
  }
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

/**
 * TTL bounds for a delivery URL.
 *
 * A signed URL is a bearer credential: for as long as it is valid, anyone
 * holding the string can fetch the object, with no session and no further
 * check. The only thing limiting the damage of one being forwarded, logged by
 * an intermediary, or left in a browser history is how quickly it expires.
 *
 * The default is sized for "click the link, get the file". The maximum is the
 * longest window this codebase is willing to let a leaked URL stay live, and
 * it is far below the seven days the storage provider itself permits.
 */
export const DEFAULT_DELIVERY_TTL_SECONDS = 60;
export const MIN_DELIVERY_TTL_SECONDS = 30;
export const MAX_DELIVERY_TTL_SECONDS = 300;

/**
 * The key shape a delivery URL may be minted for.
 *
 * Deliberately the same shape `extractAssetKey` in lib/validations.ts enforces
 * when parsing a key out of an asset URL, and deliberately NOT imported from
 * there: this module sits underneath the validation layer and must not depend
 * on it. The duplication is safe in the only direction that matters — if the
 * two ever drift, a key this module does not recognise is refused, which is a
 * refusal to deliver rather than a permission to.
 */
const DELIVERY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type DeliveryUrlFailure =
  | "storage_unconfigured"
  | "invalid_key"
  | "invalid_ttl"
  | "sign_failed";

export type DeliveryUrlResult =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: DeliveryUrlFailure };

/**
 * Mint a short-lived signed URL for a private object.
 *
 * THIS FUNCTION AUTHORISES NOTHING. It proves only that a key is well formed
 * and a TTL is sane, then signs. Deciding *whether* this caller may have this
 * object — and whether the object is safe to hand over at all — happens above
 * it, and a caller that skips either has defeated the entire scan pipeline.
 *
 * Reads no bytes: the URL is signed locally by the SDK with no network round
 * trip, so nothing is transferred and nothing is buffered. That also means
 * signing does NOT prove the object exists — a well-formed key for a deleted
 * object signs happily and then fails to resolve. Existence is the consumer's
 * problem, not a safety property.
 *
 * Out-of-range TTLs are REFUSED rather than clamped. Clamping would silently
 * repair a caller that asked for a day-long credential, and quietly turning a
 * value we do not accept into one we do is the exact coercion this codebase
 * refuses elsewhere. A misconfigured caller should fail visibly in review, not
 * be corrected in production.
 */
export async function createDeliveryUrl(
  key: string,
  opts: { ttlSeconds?: number } = {}
): Promise<DeliveryUrlResult> {
  // Input is validated before configuration is consulted, so a malformed key
  // is rejected identically whether or not storage happens to be wired up.
  if (typeof key !== "string" || !DELIVERY_KEY_PATTERN.test(key)) {
    return { ok: false, reason: "invalid_key" };
  }

  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_DELIVERY_TTL_SECONDS;
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < MIN_DELIVERY_TTL_SECONDS ||
    ttlSeconds > MAX_DELIVERY_TTL_SECONDS
  ) {
    return { ok: false, reason: "invalid_ttl" };
  }

  const utapi = api();
  if (!utapi) return { ok: false, reason: "storage_unconfigured" };

  try {
    const signed = await utapi.generateSignedURL(key, {
      expiresIn: ttlSeconds,
    });
    return {
      ok: true,
      url: signed.ufsUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  } catch {
    // Swallows the cause on purpose, exactly as the scan path does: an
    // UploadThing error can echo back the URL it was in the middle of signing,
    // and an error object that reaches a log is a credential that reaches a log.
    return { ok: false, reason: "sign_failed" };
  }
}
