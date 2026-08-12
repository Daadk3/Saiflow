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
  /** Compression method. 0 is "stored", the only one we read data from. */
  method: number;
  /** Offset of the entry's local file header, already validated to exist. */
  localHeaderOffset: number;
}

export type ArchiveReadResult =
  | { ok: true; entries: ArchiveEntry[] }
  | { ok: false; reason: "malformed" | "unsupported" };

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_LOCATOR_SIG = 0x07064b50;
const EOCD_MIN = 22;
const CD_ENTRY_MIN = 46;
const LOCAL_HEADER_MIN = 30;

/**
 * Parse the central directory, refusing anything that is not exactly
 * self-consistent.
 *
 * THE ATTACK THIS DEFENDS AGAINST. A ZIP reader conventionally locates the
 * End Of Central Directory by scanning backwards from EOF for its signature
 * and taking the first hit. That is forgeable: append a second, well-formed
 * EOCD declaring zero entries and the reader reports an empty archive, while
 * every real extractor still sees the original contents. Applied to a policy
 * check, an archive containing `setup.exe` reads as empty and passes.
 *
 * Permissiveness is what makes that work, so this parser is deliberately
 * intolerant. A candidate EOCD is only accepted when the whole file agrees
 * with it:
 *
 *   - its comment length ends the record exactly at EOF
 *   - it is the ONLY candidate that does; ambiguity is refused, not resolved
 *   - the archive is single-disk and the two entry counts match
 *   - cdOffset + cdSize lands exactly on the EOCD
 *   - exactly the declared number of records parse, and consume exactly cdSize
 *   - every record points at a real local file header carrying the same name
 *
 * That last check is what makes forgery impractical: a lying directory would
 * have to be backed by matching local headers, at which point it is no longer
 * lying about the contents.
 *
 * ZIP64 is refused rather than interpreted — at a 128MB ceiling no genuine
 * deliverable needs it, and misreading a 64-bit offset is worse than saying no.
 */
export function readZipCentralDirectory(bytes: Uint8Array): ArchiveReadResult {
  const len = bytes.byteLength;
  if (len < EOCD_MIN) return { ok: false, reason: "malformed" };

  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  const u32 = (o: number) => view.getUint32(o, true);
  const u16 = (o: number) => view.getUint16(o, true);

  // Collect EVERY candidate whose declared comment length ends precisely at
  // EOF. A forged trailing record and the genuine one cannot both satisfy this
  // unless the file is genuinely ambiguous, which is itself a rejection.
  const searchFloor = Math.max(0, len - (0xffff + EOCD_MIN));
  const candidates: number[] = [];
  for (let i = len - EOCD_MIN; i >= searchFloor; i--) {
    if (u32(i) !== EOCD_SIG) continue;
    const commentLen = u16(i + 20);
    if (i + EOCD_MIN + commentLen === len) candidates.push(i);
  }

  if (candidates.length === 0) return { ok: false, reason: "malformed" };
  if (candidates.length > 1) return { ok: false, reason: "malformed" };

  const eocd = candidates[0];

  // ZIP64 locator immediately precedes a ZIP64 EOCD.
  if (eocd >= 20 && u32(eocd - 20) === ZIP64_EOCD_LOCATOR_SIG) {
    return { ok: false, reason: "unsupported" };
  }

  const diskNumber = u16(eocd + 4);
  const cdStartDisk = u16(eocd + 6);
  const entriesThisDisk = u16(eocd + 8);
  const totalEntries = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdOffset = u32(eocd + 16);

  // ZIP64 sentinels: the real values live in the ZIP64 record we refuse.
  if (
    totalEntries === 0xffff ||
    entriesThisDisk === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    return { ok: false, reason: "unsupported" };
  }

  // Split archives are not a deliverable format.
  if (diskNumber !== 0 || cdStartDisk !== 0) return { ok: false, reason: "unsupported" };
  if (entriesThisDisk !== totalEntries) return { ok: false, reason: "malformed" };

  // The directory must end exactly where the EOCD begins. This alone defeats
  // the appended-EOCD forgery, whose cdOffset/cdSize describe a region that
  // stops short of its own record.
  if (cdOffset + cdSize !== eocd) return { ok: false, reason: "malformed" };
  if (cdSize === 0 && totalEntries !== 0) return { ok: false, reason: "malformed" };
  if (totalEntries === 0 && cdSize !== 0) return { ok: false, reason: "malformed" };

  /**
   * A zero-entry directory is only believable when nothing precedes it.
   *
   * The `cdOffset + cdSize === eocd` rule above is not sufficient on its own:
   * a forged trailing EOCD can point at ITSELF, so `eocd + 0 === eocd` holds
   * trivially. Appending one to a real archive also pushes the genuine EOCD
   * away from EOF, leaving the forgery as the sole candidate — and the archive
   * then reads as empty, skipping every per-entry check.
   *
   * A genuinely empty ZIP is 22 bytes: the EOCD and nothing else. Anything
   * else claiming zero entries has content in front of it that the directory
   * refuses to describe, which is the signature of this attack.
   */
  if (totalEntries === 0) {
    return eocd === 0
      ? { ok: true, entries: [] }
      : { ok: false, reason: "malformed" };
  }

  const cdEnd = cdOffset + cdSize;
  const entries: ArchiveEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (p + CD_ENTRY_MIN > cdEnd) return { ok: false, reason: "malformed" };
    if (u32(p) !== CD_SIG) return { ok: false, reason: "malformed" };

    const flags = u16(p + 8);
    const method = u16(p + 10);
    const compressedSize = u32(p + 20);
    const uncompressedSize = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const externalAttrs = u32(p + 38);
    const localOffset = u32(p + 42);

    const nameStart = p + CD_ENTRY_MIN;
    const next = nameStart + nameLen + extraLen + commentLen;
    // Every record must lie wholly inside the declared directory.
    if (next > cdEnd) return { ok: false, reason: "malformed" };
    if (nameLen === 0) return { ok: false, reason: "malformed" };

    // Entry names are UTF-8 when bit 11 is set and CP437 otherwise. Decoding
    // as UTF-8 either way is fine here: we only test the name for traversal and
    // extension, and a mis-decoded byte cannot turn a safe name into "..".
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLen);
    const name = new TextDecoder("utf-8", { fatal: false }).decode(nameBytes);

    // The record must be backed by a real local file header carrying the same
    // name. A directory that lies about the contents has to lie here too.
    if (localOffset + LOCAL_HEADER_MIN > cdOffset) return { ok: false, reason: "malformed" };
    if (u32(localOffset) !== LOCAL_SIG) return { ok: false, reason: "malformed" };
    const localNameLen = u16(localOffset + 26);
    if (localNameLen !== nameLen) return { ok: false, reason: "malformed" };
    const localNameStart = localOffset + LOCAL_HEADER_MIN;
    if (localNameStart + localNameLen > cdOffset) return { ok: false, reason: "malformed" };
    for (let b = 0; b < nameLen; b++) {
      if (bytes[localNameStart + b] !== nameBytes[b]) {
        return { ok: false, reason: "malformed" };
      }
    }

    // High 16 bits are the unix mode when the archive was made on unix.
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    const symlink = (unixMode & 0xf000) === 0xa000;

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      encrypted: (flags & 0x1) === 1,
      symlink,
      method,
      localHeaderOffset: localOffset,
    });

    p = next;
  }

  // The records must consume the declared directory exactly — no slack in
  // which an extra, unparsed record could hide.
  if (p !== cdEnd) return { ok: false, reason: "malformed" };

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

/**
 * The bytes of a STORED (uncompressed) entry, or null.
 *
 * Deliberately narrow. It exists for one job — confirming an EPUB's `mimetype`
 * entry really says `application/epub+zip` — and refuses anything else:
 * compressed, encrypted, oversized, or out of bounds. Nothing is inflated, so
 * there is no decompression to attack.
 *
 * The local header's own extra-field length is read here rather than the
 * directory's, because the two are allowed to differ and the data sits after
 * the local one.
 */
export function readStoredEntryBytes(
  bytes: Uint8Array,
  entry: ArchiveEntry,
  maxLen = 1024
): Uint8Array | null {
  if (entry.method !== 0 || entry.encrypted) return null;
  if (entry.compressedSize > maxLen) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = entry.localHeaderOffset;
  if (base + LOCAL_HEADER_MIN > bytes.byteLength) return null;

  const nameLen = view.getUint16(base + 26, true);
  const extraLen = view.getUint16(base + 28, true);
  const start = base + LOCAL_HEADER_MIN + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) return null;

  return bytes.subarray(start, end);
}
