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
 * Threat flags that must be present and must be real booleans.
 *
 * Earlier this parser coerced: a missing flag was read as "threat present",
 * and the string `"false"` was accepted as false. Both were wrong in the same
 * way — they invented a verdict out of a payload we did not actually
 * understand. A response we cannot parse is not a scan result, so it becomes
 * SCAN_ERROR and the file stays unsellable until a real answer arrives.
 */
const REQUIRED_THREAT_FLAGS = [
  "ContainsExecutable",
  "ContainsInvalidFile",
  "ContainsScript",
  "ContainsPasswordProtectedFile",
  "ContainsRestrictedFileFormat",
  "ContainsMacros",
  "ContainsXmlExternalEntities",
  "ContainsInsecureDeserialization",
  "ContainsHtml",
  "ContainsUnsafeArchive",
  "ContainsOleEmbeddedObject",
] as const;

/**
 * Parse strictly. Returns null — meaning "no usable verdict" — unless every
 * required field is present with exactly the expected type.
 *
 * DOCUMENTED POLICY, because the distinction matters:
 *   - a payload we cannot parse  -> SCAN_ERROR (we never got a verdict)
 *   - a payload we can parse that disagrees with policy -> UNSAFE
 * Neither can ever produce SAFE.
 */
function parseFindings(payload: unknown): ScanFindings | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Record<string, unknown>;

  if (typeof raw.CleanResult !== "boolean") return null;

  for (const flag of REQUIRED_THREAT_FLAGS) {
    if (typeof raw[flag] !== "boolean") return null;
  }

  // VerifiedFileFormat is NULLABLE BY CONTRACT, and treating it as required
  // was a real defect rather than extra caution.
  //
  // Cloudmersive documents null for two ordinary outcomes: the format is not
  // supported for contents verification, and a virus or malware was found.
  // Rejecting null as unparseable therefore turned genuine malware detections
  // into SCAN_ERROR — a scanner outage as far as any operator could tell —
  // and burned the retry budget on them. Every field in this response is
  // documented as optional, so an absent value carries the same meaning as an
  // explicit null and is normalised to it.
  //
  // This does NOT loosen the verdict. `null` means "no content-verified
  // format", and formatMatchesPolicy refuses null before it looks anything up,
  // so a null can only ever reach a REJECT. A WRONG-TYPED value is still a
  // parse failure: a number or an object is not a documented response, and
  // guessing at one is how a payload we do not understand becomes a verdict.
  let verifiedFileFormat: string | null;
  if (raw.VerifiedFileFormat === undefined || raw.VerifiedFileFormat === null) {
    verifiedFileFormat = null;
  } else if (typeof raw.VerifiedFileFormat === "string") {
    const trimmed = raw.VerifiedFileFormat.trim();
    // A blank string is not a format. Treated as "not verified" rather than as
    // a parse failure, which lands in the same place: REJECT, never SAFE.
    verifiedFileFormat = trimmed === "" ? null : trimmed;
  } else {
    return null;
  }

  // FoundViruses may be absent, explicitly null, or an array.
  //
  // Cloudmersive sends `null` — not an empty array, and not omission — when a
  // scan finds nothing, so this IS the ordinary clean-scan case. The previous
  // guard accepted only "absent or array" and so rejected every clean response
  // as unparseable, which is what produced provider_bad_response_terminal on
  // the first real scan in Preview.
  //
  // Accepting null cannot weaken the verdict. FoundViruses supplies virus
  // NAMES for the audit trail only; the malware decision is CleanResult, still
  // required above as a strict boolean, and verdictFromFindings rejects on
  // !clean before it reads anything else. A wrong-typed value is still refused.
  if (
    raw.FoundViruses !== undefined &&
    raw.FoundViruses !== null &&
    !Array.isArray(raw.FoundViruses)
  ) {
    return null;
  }
  const viruses = Array.isArray(raw.FoundViruses)
    ? raw.FoundViruses.flatMap((v) => {
        if (typeof v !== "object" || v === null) return [];
        const name = (v as Record<string, unknown>).VirusName;
        return typeof name === "string" ? [name] : [];
      })
    : [];

  const flag = (name: (typeof REQUIRED_THREAT_FLAGS)[number]) => raw[name] as boolean;

  return {
    clean: raw.CleanResult,
    verifiedFileFormat,
    containsExecutable: flag("ContainsExecutable"),
    containsInvalidFile: flag("ContainsInvalidFile"),
    containsScript: flag("ContainsScript"),
    containsPasswordProtectedFile: flag("ContainsPasswordProtectedFile"),
    containsRestrictedFileFormat: flag("ContainsRestrictedFileFormat"),
    containsMacros: flag("ContainsMacros"),
    containsXmlExternalEntities: flag("ContainsXmlExternalEntities"),
    containsInsecureDeserialization: flag("ContainsInsecureDeserialization"),
    containsHtml: flag("ContainsHtml"),
    containsUnsafeArchive: flag("ContainsUnsafeArchive"),
    containsOleEmbeddedObject: flag("ContainsOleEmbeddedObject"),
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
    // No defensive copy: the Blob constructor already copies, and at a 128MB
    // ceiling a redundant slice() would add another full-size buffer to peak
    // memory for no benefit.
    form.append(
      "inputFile",
      // Cast rather than copy. TypeScript widens Uint8Array's backing store to
      // ArrayBufferLike, which BlobPart does not accept; the runtime value is
      // always ArrayBuffer-backed. Satisfying the type by re-slicing would add
      // a second full-size buffer to peak memory at the 128MB ceiling.
      new Blob([request.bytes as unknown as BlobPart]),
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
      //
      // The status is carried so the three causes are distinguishable after
      // the fact: 400 reads as a malformed request, 401/403 as a key problem,
      // 402 as billing. Without it every one of them persists as the same
      // opaque string, which is precisely what left the first real production
      // failure undiagnosable. The status is the ONLY thing taken from the
      // response here — no body is read, no header is inspected.
      return {
        ok: false,
        failure: "bad_response",
        detail: { kind: "http", status: response.status },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A 2xx whose body is not JSON: an HTML error page, an empty body, a
      // truncated response. The category is recorded; the body is not read
      // again to characterise it, and the parse error is still discarded —
      // its message can quote the payload.
      return {
        ok: false,
        failure: "bad_response",
        detail: { kind: "json_parse" },
      };
    }

    const findings = parseFindings(payload);
    if (!findings) {
      // Valid JSON that is not a scan result we recognise. Only the category
      // is recorded: naming the offending field would start quoting the
      // payload, and a field name is a short step from a field value.
      return {
        ok: false,
        failure: "bad_response",
        detail: { kind: "schema" },
      };
    }

    return { ok: true, findings };
  },
};
