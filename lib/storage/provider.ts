/**
 * Server-side access to private storage objects.
 *
 * Deliverables are uploaded with `acl: "private"`, so they are not readable by
 * URL. Reading one requires a short-lived signed URL, and this module is the
 * only place allowed to mint one.
 *
 * Three rules the rest of the codebase depends on:
 *
 *   1. Bytes are fetched by KEY, never by the stored `fileUrl`. `fileUrl` is a
 *      string that once passed validation; the key is the identity the scan
 *      verdict binds to. Fetching by key means the bytes we hash and scan are
 *      definitionally the bytes that key names.
 *   2. The signed URL never leaves this module — not to a caller, not to a
 *      log, not to the database. `readPrivateObject` returns bytes, not links.
 *   3. Failure is failure. Nothing here falls back to an unsigned URL.
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
