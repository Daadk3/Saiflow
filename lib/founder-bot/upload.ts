/**
 * Put bytes into storage the way a browser upload would, then hand back the
 * key UploadThing assigned.
 *
 * The caller has already accepted the file with `decideUpload` against the
 * route config. The ACL and content disposition passed here are the ones that
 * decision read off that same config entry, so a deliverable stays private
 * and a cover stays a cover. This does not record provenance; the caller
 * writes the FileAsset row through `recordProvenance`, the only writer.
 */

import { UTApi } from "uploadthing/server";

import type { UploadDecision } from "@/lib/upload-accept";

type Accepted = Extract<UploadDecision, { ok: true }>;

export interface StoredUpload {
  key: string;
  ufsUrl: string;
  name: string;
  size: number;
  type: string;
}

export type UploadOutcome =
  | { ok: true; file: StoredUpload }
  | { ok: false; reason: "unconfigured" | "failed" | "size" };

let cached: UTApi | null = null;

function api(): UTApi | null {
  if (!process.env.UPLOADTHING_TOKEN) return null;
  if (!cached) cached = new UTApi();
  return cached;
}

export async function uploadAcceptedFile(file: File, decision: Accepted): Promise<UploadOutcome> {
  const utapi = api();
  if (!utapi) return { ok: false, reason: "unconfigured" };

  try {
    const result = await utapi.uploadFiles(file, {
      contentDisposition: decision.contentDisposition,
      ...(decision.acl ? { acl: decision.acl } : {}),
    });
    const data = result.data;
    if (!data?.key || !data.ufsUrl) return { ok: false, reason: "failed" };
    // The provider is not a second size authority we trust above the config,
    // but a result larger than the ceiling we just enforced is not attached.
    if (!Number.isFinite(data.size) || data.size <= 0 || data.size > decision.maxBytes) {
      return { ok: false, reason: "size" };
    }
    return {
      ok: true,
      file: {
        key: data.key,
        ufsUrl: data.ufsUrl,
        name: data.name,
        size: data.size,
        type: data.type,
      },
    };
  } catch (error) {
    // The name only. An UploadThing error can echo a URL.
    console.error("[founder-bot] upload failed", (error as Error)?.name);
    return { ok: false, reason: "failed" };
  }
}
