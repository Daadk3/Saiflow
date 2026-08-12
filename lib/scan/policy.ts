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
  readZipCentralDirectory,
  type ArchiveEntry,
} from "./archive";
import type { ScanFindings } from "./provider";
import { findPdfActiveContent, sniffFormat, type SniffedFormat } from "./sniff";

/** A deliverable family, after ZIP containers are told apart. */
export type ContentKind =
  | "pdf"
  | "epub"
  | "zip"
  | "image"
  | "audio"
  | "video";

export type PolicyVerdict =
  | { outcome: "ALLOW" }
  | { outcome: "REJECT"; reason: string };

export interface ContentPolicy {
  kind: ContentKind;
  restrictToExtensions: string[];
  /** EPUB only — see ScanRequest.allowHtml for why. */
  allowHtml: boolean;
}

const IMAGE_EXTENSIONS: Record<string, string[]> = {
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
  gif: [".gif"],
  webp: [".webp"],
  avif: [".avif"],
  heic: [".heic", ".heif"],
};

/** An EPUB is a ZIP carrying these two entries; a plain ZIP is not. */
export function isEpubLayout(entries: ArchiveEntry[]): boolean {
  const names = new Set(entries.map((e) => e.name));
  return names.has("mimetype") && names.has("META-INF/container.xml");
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
    if (dir.ok && isEpubLayout(dir.entries)) {
      return { kind: "epub", restrictToExtensions: [".epub"], allowHtml: true };
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

  if (policy.kind === "zip" || policy.kind === "epub") {
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
      // XHTML is the substance of an EPUB, but script never is.
      if (isScriptEntry(entry)) return { outcome: "REJECT", reason: "archive_script" };
    }

    if (isDecompressionBomb(dir.entries)) {
      return { outcome: "REJECT", reason: "archive_decompression_bomb" };
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
  if (!findings.clean) return { outcome: "REJECT", reason: "malware" };
  if (findings.containsExecutable) return { outcome: "REJECT", reason: "executable" };
  if (findings.containsScript) return { outcome: "REJECT", reason: "script" };
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
  if (findings.containsRestrictedFileFormat) {
    return { outcome: "REJECT", reason: "format_mismatch" };
  }
  // HTML is a rejection everywhere except inside an EPUB, where it is the
  // format itself.
  if (findings.containsHtml && !policy.allowHtml) {
    return { outcome: "REJECT", reason: "html_content" };
  }

  // The provider's content-verified format must agree with what we sniffed.
  // Disagreement means one of the two was fooled, which is reason enough.
  if (findings.verifiedFileFormat) {
    const verified = findings.verifiedFileFormat.toLowerCase();
    const normalised = verified.startsWith(".") ? verified : `.${verified}`;
    if (!policy.restrictToExtensions.includes(normalised)) {
      return { outcome: "REJECT", reason: "format_mismatch" };
    }
  }

  return { outcome: "ALLOW" };
}
