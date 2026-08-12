/**
 * Cloudmersive Advanced Virus Scan.
 *
 * Contract verified against the current API reference before implementation:
 *   POST https://api.cloudmersive.com/virus/scan/file/advanced
 *   auth   — `Apikey` request header
 *   body   — multipart/form-data, file field `inputFile`
 *   options— boolean request headers, each defaulting to false
 *   result — VirusScanAdvancedResult, PascalCase JSON
 *
 * No field below is invented; every one is named in that reference.
 *
 * Chosen partly because it is stateless — Cloudmersive documents that payloads
 * are not retained after the transaction, which is a hard requirement for a
 * marketplace handling sellers' unreleased paid work.
 */

import type {
  ScanFindings,
  ScanProvider,
  ScanProviderResult,
  ScanRequest,
} from "./provider";

const ENDPOINT = "https://api.cloudmersive.com/virus/scan/file/advanced";
const REQUEST_TIMEOUT_MS = 120_000;

/** Reads the key at call time so a key added later needs no redeploy of this module. */
function apiKey(): string | undefined {
  return process.env.CLOUDMERSIVE_API_KEY?.trim() || undefined;
}

const bool = (value: boolean) => (value ? "true" : "false");

/**
 * Coerce one response field to a boolean, treating anything unexpected as
 * "threat present".
 *
 * This is the fail-closed rule applied at field level: if the provider omits a
 * flag or returns something we do not understand, the safe reading is that the
 * threat may be there, not that it is absent.
 */
function threatFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.toLowerCase() !== "false";
  return true;
}

function parseFindings(payload: unknown): ScanFindings | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as Record<string, unknown>;

  // CleanResult is the one field we refuse to guess: without an explicit
  // boolean there is no verdict at all, so the caller must treat it as an
  // error rather than as a threat or a pass.
  if (typeof raw.CleanResult !== "boolean") return null;

  const viruses = Array.isArray(raw.FoundViruses)
    ? raw.FoundViruses.flatMap((v) => {
        if (typeof v !== "object" || v === null) return [];
        const name = (v as Record<string, unknown>).VirusName;
        return typeof name === "string" ? [name] : [];
      })
    : [];

  return {
    clean: raw.CleanResult,
    verifiedFileFormat:
      typeof raw.VerifiedFileFormat === "string" ? raw.VerifiedFileFormat : null,
    containsExecutable: threatFlag(raw.ContainsExecutable),
    containsInvalidFile: threatFlag(raw.ContainsInvalidFile),
    containsScript: threatFlag(raw.ContainsScript),
    containsPasswordProtectedFile: threatFlag(raw.ContainsPasswordProtectedFile),
    containsRestrictedFileFormat: threatFlag(raw.ContainsRestrictedFileFormat),
    containsMacros: threatFlag(raw.ContainsMacros),
    containsXmlExternalEntities: threatFlag(raw.ContainsXmlExternalEntities),
    containsInsecureDeserialization: threatFlag(raw.ContainsInsecureDeserialization),
    containsHtml: threatFlag(raw.ContainsHtml),
    containsUnsafeArchive: threatFlag(raw.ContainsUnsafeArchive),
    containsOleEmbeddedObject: threatFlag(raw.ContainsOleEmbeddedObject),
    virusNames: viruses,
  };
}

export const cloudmersiveProvider: ScanProvider = {
  id: "cloudmersive",

  isConfigured() {
    return Boolean(apiKey());
  },

  async scan(request: ScanRequest): Promise<ScanProviderResult> {
    const key = apiKey();
    if (!key) return { ok: false, failure: "unconfigured" };

    const form = new FormData();
    // Copy into a fresh buffer so the Blob owns exactly these bytes — the same
    // bytes the caller hashes.
    form.append(
      "inputFile",
      new Blob([request.bytes.slice()]),
      request.fileName || "upload.bin"
    );

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Apikey: key,
          // Every threat class is blocked unless SaiFlow has an explicit reason
          // to permit it. allowHtml is the single exception, for EPUB.
          allowExecutables: bool(false),
          allowInvalidFiles: bool(false),
          allowScripts: bool(false),
          allowPasswordProtectedFiles: bool(false),
          allowMacros: bool(false),
          allowXmlExternalEntities: bool(false),
          allowInsecureDeserialization: bool(false),
          allowHtml: bool(request.allowHtml),
          restrictFileTypes: request.restrictToExtensions.join(","),
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      return { ok: false, failure: timedOut ? "timeout" : "network" };
    }

    if (response.status === 429) return { ok: false, failure: "rate_limited" };
    if (response.status === 413) return { ok: false, failure: "too_large" };
    if (response.status >= 500) return { ok: false, failure: "server_error" };
    if (!response.ok) {
      // 4xx other than the above — bad request, bad key, quota exhausted.
      // Terminal rather than retryable, and never SAFE.
      return { ok: false, failure: "bad_response" };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, failure: "bad_response" };
    }

    const findings = parseFindings(payload);
    if (!findings) return { ok: false, failure: "bad_response" };

    return { ok: true, findings };
  },
};
