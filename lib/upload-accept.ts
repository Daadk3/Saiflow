/**
 * The same type and size decision the upload routes make.
 *
 * UploadThing's server runs `matchFileType` and then `fileSizeToBytes` on the
 * matched entry of the route config (`assertFilesMeetConfig` in
 * `uploadthing/dist/upload-builder`). This calls those two functions against
 * the same config objects (`lib/upload-config`), so a file the dashboard
 * would refuse is refused here too, and a ceiling raised or lowered there
 * moves with it. Nothing here reads bytes: content scanning stays with the
 * scan pipeline, exactly as it does for a browser upload.
 */

import { fileSizeToBytes, matchFileType } from "@uploadthing/shared";
import { Micro } from "effect";

export interface UploadEntry {
  maxFileSize: string;
  acl?: "public-read" | "private";
  contentDisposition?: "inline" | "attachment";
}

export type UploadDecision =
  | {
      ok: true;
      /** The ceiling of the matched type, in bytes, from UploadThing's own parser. */
      maxBytes: number;
      acl?: "public-read" | "private";
      /** The route's disposition, or UploadThing's own default when the route sets none. */
      contentDisposition: "inline" | "attachment";
    }
  | { ok: false; reason: "empty" | "type" | "size" };

/**
 * Would this file be accepted by `config`?
 *
 * `name` and `type` are what UploadThing matches on (declared type, then the
 * filename extension). `size` is compared with the matched entry's ceiling.
 */
export function decideUpload(
  config: Record<string, UploadEntry>,
  file: { name: string; size: number; type: string }
): UploadDecision {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, reason: "empty" };

  // The two `effect` copies (the repo's, and the one bundled inside
  // `@uploadthing/shared`) are nominally distinct. The values are plain data
  // and the runtimes interoperate; the cast changes no decision. Same bridge
  // as tests/upload-config.test.ts.
  const matched = Micro.runSyncExit(
    matchFileType({ name: file.name, size: file.size, type: file.type }, Object.keys(config) as never) as unknown as Micro.Micro<
      string,
      unknown,
      never
    >
  );
  if (!Micro.exitIsSuccess(matched)) return { ok: false, reason: "type" };

  const entry = config[matched.value];
  if (!entry?.maxFileSize) return { ok: false, reason: "type" };

  const ceiling = Micro.runSyncExit(
    fileSizeToBytes(entry.maxFileSize as never) as unknown as Micro.Micro<number, unknown, never>
  );
  if (!Micro.exitIsSuccess(ceiling)) return { ok: false, reason: "type" };
  if (file.size > ceiling.value) return { ok: false, reason: "size" };

  return {
    ok: true,
    maxBytes: ceiling.value,
    acl: entry.acl,
    contentDisposition: entry.contentDisposition ?? "inline",
  };
}
