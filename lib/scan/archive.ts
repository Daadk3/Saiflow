/**
 * Minimal ZIP central-directory reader.
 *
 * Reads structure only: entry names, sizes, flags. Nothing is decompressed and
 * nothing is executed, so a malicious archive cannot do anything here beyond
 * being badly formed — which is itself a rejection.
 *
 * Why not delegate entirely to the scanner: the provider tells us whether an
 * archive is *unsafe*, but SaiFlow additionally has policy about what an
 * archive may legitimately contain at launch (no nested archives, no traversal,
 * no symlinks). That is our rule, not a threat signature, so we enforce it.
 */

/** One central-directory entry, reduced to what policy cares about. */
export interface ArchiveEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  /** General-purpose bit 0 — the entry's data is encrypted. */
  encrypted: boolean;
  /** Unix mode says symlink (S_IFLNK), read from the external attributes. */
  symlink: boolean;
}

export type ArchiveReadResult =
  | { ok: true; entries: ArchiveEntry[] }
  | { ok: false; reason: "malformed" | "unsupported" };

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;

/**
 * Parse the central directory.
 *
 * ZIP64 archives are reported as `unsupported` rather than guessed at: at a
 * 128MB ceiling a genuine deliverable has no reason to be ZIP64, and refusing
 * is safer than misreading offsets.
 */
export function readZipCentralDirectory(bytes: Uint8Array): ArchiveReadResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The EOCD sits at the end, after a comment of up to 65535 bytes.
  const minEocd = 22;
  if (bytes.byteLength < minEocd) return { ok: false, reason: "malformed" };

  let eocd = -1;
  const searchFloor = Math.max(0, bytes.byteLength - (0xffff + minEocd));
  for (let i = bytes.byteLength - minEocd; i >= searchFloor; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "malformed" };

  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_EOCD_LOCATOR_SIG) {
    return { ok: false, reason: "unsupported" };
  }

  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset >= bytes.byteLength) return { ok: false, reason: "malformed" };
  // 0xffff / 0xffffffff are the ZIP64 sentinels.
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    return { ok: false, reason: "unsupported" };
  }

  const entries: ArchiveEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > bytes.byteLength) return { ok: false, reason: "malformed" };
    if (view.getUint32(p, true) !== CD_SIG) return { ok: false, reason: "malformed" };

    const flags = view.getUint16(p + 8, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const externalAttrs = view.getUint32(p + 38, true);

    const nameStart = p + 46;
    if (nameStart + nameLen > bytes.byteLength) return { ok: false, reason: "malformed" };

    // Entry names are UTF-8 when bit 11 is set and CP437 otherwise. Decoding
    // as UTF-8 either way is fine here: we only test the name for traversal and
    // extension, and a mis-decoded byte cannot turn a safe name into "..".
    const name = new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.subarray(nameStart, nameStart + nameLen)
    );

    // High 16 bits are the unix mode when the archive was made on unix.
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    const symlink = (unixMode & 0xf000) === 0xa000;

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (flags & 0x1) === 1,
      symlink,
    });

    p = nameStart + nameLen + extraLen + commentLen;
  }

  return { ok: true, entries };
}

/** Entry names that escape the extraction directory. */
export function hasPathTraversal(entry: ArchiveEntry): boolean {
  const name = entry.name.replace(/\\/g, "/");
  if (name.startsWith("/")) return true;
  if (/^[A-Za-z]:/.test(name)) return true; // absolute windows path
  return name.split("/").includes("..");
}

const ARCHIVE_EXTENSIONS = [
  ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".cab", ".iso",
  ".dmg", ".tgz", ".lz", ".lzma", ".arj", ".z",
];

/** A nested archive — refused at launch because we do not scan recursively. */
export function isNestedArchive(entry: ArchiveEntry): boolean {
  const lower = entry.name.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const EXECUTABLE_EXTENSIONS = [
  ".exe", ".dll", ".com", ".scr", ".msi", ".bat", ".cmd", ".pif",
  ".app", ".pkg", ".deb", ".rpm", ".jar", ".apk", ".so", ".dylib",
];

const SCRIPT_EXTENSIONS = [
  ".js", ".mjs", ".cjs", ".vbs", ".ps1", ".sh", ".bash", ".zsh", ".py",
  ".rb", ".pl", ".php", ".jse", ".wsf", ".hta", ".lnk",
];

export function isExecutableEntry(entry: ArchiveEntry): boolean {
  const lower = entry.name.toLowerCase();
  return EXECUTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isScriptEntry(entry: ArchiveEntry): boolean {
  const lower = entry.name.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Decompression-bomb indicator.
 *
 * A ratio this extreme has no legitimate use in a sold deliverable, and the
 * absolute floor keeps small, highly-compressible text files from tripping it.
 */
export function isDecompressionBomb(entries: ArchiveEntry[]): boolean {
  const MIN_ABSOLUTE_BYTES = 32 * 1024 * 1024;
  const MAX_RATIO = 200;

  let compressed = 0;
  let uncompressed = 0;
  for (const e of entries) {
    compressed += e.compressedSize;
    uncompressed += e.uncompressedSize;
  }
  if (uncompressed < MIN_ABSOLUTE_BYTES) return false;
  if (compressed === 0) return true;
  return uncompressed / compressed > MAX_RATIO;
}
