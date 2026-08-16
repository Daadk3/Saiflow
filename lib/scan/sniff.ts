/**
 * Format detection from bytes.
 *
 * Everything the client tells us about a file's type is a hint: the browser's
 * MIME string and the filename extension both come from the uploader. This
 * module ignores both and reads the leading bytes instead.
 *
 * It is not a general-purpose file identifier — it recognises exactly the
 * families SaiFlow accepts, and answers "unknown" for everything else. Unknown
 * is a rejection, not a shrug: a deliverable whose type we cannot establish
 * from its own bytes never becomes SAFE.
 */

/** The format families SaiFlow accepts. */
export type SniffedFormat =
  | "pdf"
  | "zip" // also EPUB, which is a ZIP container
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "heic"
  | "audio"
  | "video"
  | "unknown";

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
};

const startsWith = (bytes: Uint8Array, sig: number[]): boolean => {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
};

/**
 * ISO base media files (MP4, MOV, HEIC, AVIF) share a `ftyp` box whose major
 * brand at offset 8 distinguishes them.
 */
function isoBrand(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 4, 4) !== "ftyp") return null;
  return ascii(bytes, 8, 4).toLowerCase();
}

export function sniffFormat(bytes: Uint8Array): SniffedFormat {
  if (bytes.length < 12) return "unknown";

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  // Local file header. Empty and spanned archives use PK\x05\x06 / PK\x07\x08,
  // which are not valid deliverables and are left unknown on purpose.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";

  if (ascii(bytes, 0, 4) === "RIFF") {
    const kind = ascii(bytes, 8, 4);
    if (kind === "WEBP") return "webp";
    if (kind === "WAVE") return "audio";
  }

  const brand = isoBrand(bytes);
  if (brand) {
    if (brand.startsWith("avif") || brand.startsWith("avis")) return "avif";
    if (
      brand.startsWith("heic") ||
      brand.startsWith("heix") ||
      brand.startsWith("heif") ||
      brand.startsWith("mif1") ||
      brand.startsWith("msf1")
    ) {
      return "heic";
    }
    if (brand.startsWith("m4a")) return "audio";
    // isom, mp42, qt, M4V and friends.
    return "video";
  }

  if (ascii(bytes, 0, 3) === "ID3") return "audio";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio"; // MPEG frame sync
  if (ascii(bytes, 0, 4) === "fLaC") return "audio";
  if (ascii(bytes, 0, 4) === "OggS") return "audio";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video"; // Matroska / WebM

  return "unknown";
}

/**
 * Active-content indicators inside a PDF.
 *
 * A clean antivirus verdict does not mean a PDF is inert: JavaScript, launch
 * actions and embedded payloads are all legitimate PDF features that a
 * marketplace deliverable has no reason to use. This is a byte-level token
 * search — the document is never parsed, rendered or executed.
 *
 * Deliberately conservative about false positives: it matches the object
 * syntax (`/JavaScript`, `/Launch`), not the words, so a PDF *about*
 * JavaScript does not trip it. Compressed object streams can hide these
 * tokens, so absence is not proof of safety — which is why this runs
 * alongside the provider's own checks rather than instead of them.
 */
export function findPdfActiveContent(bytes: Uint8Array): string[] {
  const markers: Record<string, string> = {
    "/JavaScript": "pdf_javascript",
    "/JS": "pdf_javascript",
    "/Launch": "pdf_launch_action",
    "/OpenAction": "pdf_open_action",
    "/AA": "pdf_additional_actions",
    "/EmbeddedFile": "pdf_embedded_file",
    "/RichMedia": "pdf_rich_media",
  };

  // Latin-1 keeps a 1:1 byte-to-char mapping, so offsets stay meaningful and
  // no multi-byte decoding can merge or split a token.
  const text = new TextDecoder("latin1").decode(bytes);
  const found = new Set<string>();

  for (const [token, reason] of Object.entries(markers)) {
    // Preceded by a delimiter and followed by a non-name character, so /JS
    // does not match /JSON and /AA does not match /AArdvark.
    const pattern = new RegExp(`${token.replace("/", "\\/")}(?![A-Za-z0-9])`);
    if (pattern.test(text)) found.add(reason);
  }

  return [...found];
}
