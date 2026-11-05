/**
 * What SaiFlow will accept, decided from bytes.
 *
 * Three layers, and it is worth being precise about which does what, because
 * they fail differently:
 *
 *   OURS      — `sniffFormat` establishes the family from the leading bytes.
 *               This is the only layer that closes the original hole: the
 *               upload route's type check reads the browser's claim and the
 *               filename, both attacker-controlled, so an executable named
 *               `guide.pdf` passed it. Here it does not.
 *   OURS      — structural policy: PDF active content, archive contents.
 *               These are SaiFlow rules, not threat signatures, so we enforce
 *               them ourselves rather than hoping a scanner shares our opinion.
 *   PROVIDER  — malware signatures, and content-verified format via
 *               VerifiedFileFormat / ContainsRestrictedFileFormat.
 *
 * Unresolved limitation, stated rather than papered over: PDF tokens inside
 * compressed object streams are not visible to a byte-level search, so a clean
 * structural result is not proof of an inert PDF. That is why the provider's
 * allowScripts/allowInvalidFiles run alongside it, and why neither layer is
 * treated as sufficient on its own.
 */

import {
  hasPathTraversal,
  isDecompressionBomb,
  isExecutableEntry,
  isNestedArchive,
  isScriptEntry,
  readStoredEntryBytes,
  readZipCentralDirectory,
  type ArchiveEntry,
} from "./archive";
import {
  inspectLocalHtmlApp,
  isPermittedBrowserScript,
  localHtmlEntryRejection,
  localHtmlMarker,
} from "./local-html-app";
import type { ScanFindings } from "./provider";
import { findPdfActiveContent, sniffFormat, type SniffedFormat } from "./sniff";

/** A deliverable family, after ZIP containers are told apart. */
export type ContentKind =
  | "pdf"
  | "epub"
  | "zip"
  | "local_html_app"
  | "image"
  | "audio"
  | "video";

/**
 * Three outcomes, because two were not enough to tell the truth.
 *
 * REJECT means we know something is wrong with the file. UNVERIFIABLE means
 * the scan completed but could not establish one of the things we require —
 * we learned nothing bad, and nothing sufficient either. Collapsing the second
 * into the first would brand a creator's legitimate upload as unsafe on the
 * strength of a gap in the provider's format coverage.
 *
 * Neither can produce SAFE. The difference is what is recorded, and whether
 * the file can be looked at again.
 */
export type PolicyVerdict =
  | { outcome: "ALLOW" }
  | { outcome: "REJECT"; reason: string }
  | { outcome: "UNVERIFIABLE"; reason: string };

export interface ContentPolicy {
  kind: ContentKind;
  restrictToExtensions: string[];
  /**
   * EPUB, and the named local HTML app archive. A plain ZIP stays false.
   * See ScanRequest.allowHtml.
   */
  allowHtml: boolean;
  /**
   * Named local HTML app archive only, after the member rules in
   * lib/scan/local-html-app.ts. Absent or false for every other kind,
   * including EPUB. See ScanRequest.allowScripts.
   */
  allowScripts?: boolean;
}

const IMAGE_EXTENSIONS: Record<string, string[]> = {
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  gif: [".gif"],
  webp: [".webp"],
  avif: [".avif"],
  heic: [".heic", ".heif"],
};

/** What an EPUB's `mimetype` entry must contain, byte for byte. */
const EPUB_MIMETYPE = "application/epub+zip";

/**
 * Whether an archive really is an EPUB.
 *
 * Testing for the presence of two entry NAMES is not enough, and the
 * difference matters: EPUB is the one policy that permits HTML, so anything
 * that can pose as an EPUB gets that exemption. A generic ZIP carrying two
 * empty files called `mimetype` and `META-INF/container.xml` would previously
 * have been classified as an ebook and allowed to contain HTML.
 *
 * OCF requires the `mimetype` entry to come FIRST, be STORED uncompressed, and
 * contain exactly `application/epub+zip`. All three are checked here against
 * the archive's actual bytes, so posing as an EPUB now requires being one.
 */
export function isEpubLayout(entries: ArchiveEntry[], bytes: Uint8Array): boolean {
  const first = entries[0];
  if (!first || first.name !== "mimetype") return false;
  if (first.method !== 0 || first.encrypted) return false;
  if (first.compressedSize !== EPUB_MIMETYPE.length) return false;
  if (!entries.some((e) => e.name === "META-INF/container.xml")) return false;

  const data = readStoredEntryBytes(bytes, first, EPUB_MIMETYPE.length);
  if (!data || data.byteLength !== EPUB_MIMETYPE.length) return false;

  const declared = new TextDecoder("utf-8", { fatal: false }).decode(data);
  return declared === EPUB_MIMETYPE;
}

/**
 * Resolve the policy for a file from its bytes alone.
 *
 * Returns null when the family cannot be established, which is a rejection:
 * a deliverable whose type we cannot read from its own bytes never becomes
 * SAFE.
 */
export function resolveContentPolicy(bytes: Uint8Array): ContentPolicy | null {
  const format: SniffedFormat = sniffFormat(bytes);

  if (format === "unknown") return null;
  if (format === "pdf") {
    return { kind: "pdf", restrictToExtensions: [".pdf"], allowHtml: false };
  }
  if (format === "zip") {
    const dir = readZipCentralDirectory(bytes);
    // A malformed or ZIP64 container gets the strict ZIP policy; the
    // structural pass below rejects it outright.
    if (dir.ok && isEpubLayout(dir.entries, bytes)) {
      // EPUB wins even if a local-HTML marker was also packed inside. The
      // marker must not turn an ebook into the script-allowing archive type.
      return { kind: "epub", restrictToExtensions: [".epub"], allowHtml: true };
    }
    if (dir.ok && localHtmlMarker(dir.entries, bytes) === "valid") {
      return {
        kind: "local_html_app",
        restrictToExtensions: [".zip"],
        allowHtml: true,
        allowScripts: true,
      };
    }
    return { kind: "zip", restrictToExtensions: [".zip"], allowHtml: false };
  }
  if (format === "audio") {
    return {
      kind: "audio",
      restrictToExtensions: [".mp3", ".wav", ".m4a", ".flac", ".ogg"],
      allowHtml: false,
    };
  }
  if (format === "video") {
    return {
      kind: "video",
      restrictToExtensions: [".mp4", ".mov", ".webm", ".mkv", ".avi"],
      allowHtml: false,
    };
  }

  return {
    kind: "image",
    restrictToExtensions: IMAGE_EXTENSIONS[format] ?? [],
    allowHtml: false,
  };
}

/**
 * SaiFlow's own structural policy, evaluated before the provider is called.
 *
 * Running first is deliberate: a file we already refuse never costs a scan.
 */
export function structuralVerdict(
  bytes: Uint8Array,
  policy: ContentPolicy
): PolicyVerdict {
  if (policy.kind === "pdf") {
    const found = findPdfActiveContent(bytes);
    if (found.length > 0) return { outcome: "REJECT", reason: found[0] };
    return { outcome: "ALLOW" };
  }

  if (policy.kind === "zip" || policy.kind === "epub" || policy.kind === "local_html_app") {
    const dir = readZipCentralDirectory(bytes);
    if (!dir.ok) {
      return {
        outcome: "REJECT",
        reason: dir.reason === "unsupported" ? "archive_unsupported" : "archive_malformed",
      };
    }

    for (const entry of dir.entries) {
      // Encrypted entries cannot be inspected by us or by the scanner, so an
      // archive containing one can never be shown to be safe.
      if (entry.encrypted) return { outcome: "REJECT", reason: "archive_encrypted" };
      if (hasPathTraversal(entry)) return { outcome: "REJECT", reason: "archive_path_traversal" };
      if (entry.symlink) return { outcome: "REJECT", reason: "archive_symlink" };
      if (isNestedArchive(entry)) return { outcome: "REJECT", reason: "archive_nested" };
      if (isExecutableEntry(entry)) return { outcome: "REJECT", reason: "archive_executable" };
      // XHTML is the substance of an EPUB, but script never is. The local
      // HTML app is the one archive that may carry classic `.js` files; every
      // other script extension is still rejected, and a plain ZIP rejects
      // `.js` too.
      if (isScriptEntry(entry) && !(policy.kind === "local_html_app" && isPermittedBrowserScript(entry))) {
        return { outcome: "REJECT", reason: "archive_script" };
      }
      if (policy.kind === "local_html_app") {
        const member = localHtmlEntryRejection(entry);
        if (member) return { outcome: "REJECT", reason: member };
      }
    }

    if (isDecompressionBomb(dir.entries)) {
      return { outcome: "REJECT", reason: "archive_decompression_bomb" };
    }

    // A ZIP that uses the marker name without the exact contract does not
    // become a plain ZIP with a free pass, and a hand-built local-HTML policy
    // cannot be applied to bytes that are not that archive.
    if (policy.kind === "zip" && localHtmlMarker(dir.entries, bytes) === "invalid") {
      return { outcome: "REJECT", reason: "archive_type_marker" };
    }
    if (policy.kind === "local_html_app") {
      if (localHtmlMarker(dir.entries, bytes) !== "valid") {
        return { outcome: "REJECT", reason: "archive_type_marker" };
      }
      const active = inspectLocalHtmlApp(bytes, dir.entries);
      if (active) return { outcome: "REJECT", reason: active };
    }
    return { outcome: "ALLOW" };
  }

  // Images, audio and video carry no container policy of their own; the family
  // was already established from magic bytes, and the provider covers the rest.
  return { outcome: "ALLOW" };
}

/**
 * Reconcile provider findings with the policy.
 *
 * `clean` alone is never enough: it reports signature matches, while most of
 * what disqualifies a marketplace deliverable is a legitimate feature being
 * present at all.
 */
export function verdictFromFindings(
  findings: ScanFindings,
  policy: ContentPolicy
): PolicyVerdict {
  // A named detection is the only thing that earns the word malware.
  // CleanResult alone cannot: Cloudmersive also returns it false for a file
  // that fails restrictFileTypes, so reading it first recorded format failures
  // as malware and hid every specific reason below.
  if (findings.virusNames.length > 0) return { outcome: "REJECT", reason: "malware" };
  if (findings.containsExecutable) return { outcome: "REJECT", reason: "executable" };
  // Script stays a rejection except for the named local HTML app, whose
  // structural pass has already constrained `.js` to classic browser files.
  if (findings.containsScript && policy.allowScripts !== true) {
    return { outcome: "REJECT", reason: "script" };
  }
  if (findings.containsMacros) return { outcome: "REJECT", reason: "macros" };
  if (findings.containsPasswordProtectedFile) {
    return { outcome: "REJECT", reason: "password_protected" };
  }
  if (findings.containsUnsafeArchive) return { outcome: "REJECT", reason: "unsafe_archive" };
  if (findings.containsOleEmbeddedObject) {
    return { outcome: "REJECT", reason: "ole_embedded_object" };
  }
  if (findings.containsXmlExternalEntities) return { outcome: "REJECT", reason: "xxe" };
  if (findings.containsInsecureDeserialization) {
    return { outcome: "REJECT", reason: "insecure_deserialization" };
  }
  if (findings.containsInvalidFile) return { outcome: "REJECT", reason: "malformed_file" };
  // restrictFileTypes is the container extension. For this archive that is
  // `.zip`, and Cloudmersive applies that whitelist to members too, so inner
  // `.html` / `.css` / `.js` set ContainsRestrictedFileFormat even when
  // VerifiedFileFormat is still `.zip`. That is the whitelist, not a
  // container disagreement. Waived only for a local HTML app whose container
  // verified as `.zip` and whose other threat flags are clear. Structural
  // inspection has already allowed those members; run.ts settles a structural
  // rejection before the provider is asked. A verified format that is not
  // `.zip`, and every other policy, still rejects here.
  if (findings.containsRestrictedFileFormat && !localHtmlZipWhitelist(findings, policy)) {
    return { outcome: "REJECT", reason: "format_mismatch" };
  }
  // HTML is a rejection except where the policy names it: EPUB, and the
  // local HTML app archive. A plain ZIP does not get either exemption.
  if (findings.containsHtml && !policy.allowHtml) {
    return { outcome: "REJECT", reason: "html_content" };
  }

  // Not clean, and not explained by a flag this policy already accepts.
  // Deliberately before the format checks below, so an unexplained `!clean`
  // can never reach UNVERIFIABLE or ALLOW. It only stops claiming to know why.
  //
  // The local HTML app is the one exception. Cloudmersive's CleanResult
  // follows ContainsHtml, ContainsScript, and the ZIP-whitelist flag above,
  // which are the same inner members inspectLocalHtmlApp already allowed.
  // A bare CleanResult:false, with none of those flags, stays a rejection.
  // EPUB's HTML allowance does not explain an unclean result.
  if (!findings.clean && !localHtmlCleanIsExplained(findings, policy)) {
    return { outcome: "REJECT", reason: "not_clean_unattributed" };
  }

  // Reached only after every threat check above has passed, so a file that is
  // both unverifiable AND carries a threat is still REJECTED on the threat —
  // ordering matters more than the branch itself.
  //
  // The provider could not content-verify this format. Cloudmersive returns a
  // null format for families outside its verification coverage, which
  // includes formats SaiFlow legitimately sells, so this is an ordinary
  // outcome for an honest file rather than evidence against it.
  //
  // Deliberately NOT folded into formatMatchesPolicy below. "The format is not
  // what it claims" and "nobody could tell us what the format is" are
  // different facts about a file, and a marketplace that records them as the
  // same thing tells its creators something untrue.
  if (findings.verifiedFileFormat === null) {
    return { outcome: "UNVERIFIABLE", reason: "format_not_verified" };
  }

  // The provider's content-verified format must agree with what we sniffed.
  // Disagreement means one of the two was fooled, which is reason enough.
  if (!formatMatchesPolicy(findings.verifiedFileFormat, policy)) {
    return { outcome: "REJECT", reason: "format_mismatch" };
  }

  return { outcome: "ALLOW" };
}

/**
 * The real local HTML app policy, not a neighbouring kind that happens to
 * allow HTML. EPUB allows HTML and may verify as `.zip`; it does not get
 * these exceptions.
 */
function isLocalHtmlAppPolicy(policy: ContentPolicy): boolean {
  return policy.kind === "local_html_app" && policy.allowHtml === true && policy.allowScripts === true;
}

/**
 * Threat flags that are never explained by inner HTML, CSS, or JS.
 *
 * Kept in step with the named rejections in `verdictFromFindings`. Script,
 * HTML, and the restricted-format flag are absent on purpose: under this
 * policy those three are the members the structural pass already allowed.
 */
function localHtmlThreatFree(findings: ScanFindings): boolean {
  return (
    findings.virusNames.length === 0 &&
    !findings.containsExecutable &&
    !findings.containsMacros &&
    !findings.containsPasswordProtectedFile &&
    !findings.containsUnsafeArchive &&
    !findings.containsOleEmbeddedObject &&
    !findings.containsXmlExternalEntities &&
    !findings.containsInsecureDeserialization &&
    !findings.containsInvalidFile
  );
}

/** Container content-verified as the `.zip` this policy asked for. */
function localHtmlContainerVerified(findings: ScanFindings, policy: ContentPolicy): boolean {
  return isLocalHtmlAppPolicy(policy) && formatMatchesPolicy(findings.verifiedFileFormat, policy);
}

/**
 * ContainsRestrictedFileFormat caused by the top-level `.zip` whitelist
 * seeing inner HTML, CSS, or JS. Not a waiver for a container that verified
 * as something else, and not a waiver when any other threat flag is set.
 */
function localHtmlZipWhitelist(findings: ScanFindings, policy: ContentPolicy): boolean {
  return (
    findings.containsRestrictedFileFormat &&
    localHtmlContainerVerified(findings, policy) &&
    localHtmlThreatFree(findings)
  );
}

/**
 * CleanResult:false fully explained by flags this policy allows.
 *
 * At least one of ContainsHtml, ContainsScript, or the ZIP-whitelist flag
 * must be set. None of them set means the provider declined the file and
 * did not say why, which stays `not_clean_unattributed`.
 */
function localHtmlCleanIsExplained(findings: ScanFindings, policy: ContentPolicy): boolean {
  if (!localHtmlContainerVerified(findings, policy) || !localHtmlThreatFree(findings)) return false;
  return (
    findings.containsHtml ||
    findings.containsScript ||
    findings.containsRestrictedFileFormat
  );
}

/**
 * Formats SaiFlow ever accepts. A verified format outside this set is
 * unrecognised, and unrecognised is a rejection rather than a shrug.
 */
const RECOGNISED_FORMATS = new Set([
  ".pdf", ".epub", ".zip",
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif",
  ".mp3", ".wav", ".m4a", ".flac", ".ogg",
  ".mp4", ".mov", ".webm", ".mkv", ".avi",
]);

/**
 * Aliases, stated explicitly rather than guessed at.
 *
 * Two cases are real and neither is cosmetic:
 *   - `.jpg`/`.jpeg` and `.heic`/`.heif` name the same format.
 *   - An EPUB *is* a ZIP container, so a content-based verifier may reasonably
 *     report `.zip` for one. Accepting that under EPUB policy is safe because
 *     our own structural pass already proved the EPUB layout — `mimetype` plus
 *     `META-INF/container.xml` — before this policy was chosen. The reverse is
 *     NOT allowed: plain-ZIP policy does not accept `.epub`.
 */
const FORMAT_ALIASES: Record<string, string[]> = {
  ".jpg": [".jpg", ".jpeg"],
  ".jpeg": [".jpg", ".jpeg"],
  ".heic": [".heic", ".heif"],
  ".heif": [".heic", ".heif"],
  ".epub": [".epub", ".zip"],
};

/** Lowercase, with a leading dot. */
export function normaliseFormat(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

/**
 * Whether the provider's content-verified format is compatible with the policy
 * we selected from the bytes.
 */
export function formatMatchesPolicy(
  verifiedFileFormat: string | null,
  policy: Pick<ContentPolicy, "restrictToExtensions">
): boolean {
  // No content-verified format means nothing independently confirms what the
  // bytes are, so nothing can match. Refused before any lookup: this is the
  // single line that keeps a nullable field from becoming a way to skip the
  // format check, and it is why `null` can only ever produce a REJECT.
  if (verifiedFileFormat === null) return false;

  const verified = normaliseFormat(verifiedFileFormat);
  if (!RECOGNISED_FORMATS.has(verified)) return false;

  const accepted = new Set<string>();
  for (const ext of policy.restrictToExtensions) {
    const normalised = normaliseFormat(ext);
    accepted.add(normalised);
    for (const alias of FORMAT_ALIASES[normalised] ?? []) accepted.add(alias);
  }

  return accepted.has(verified);
}
