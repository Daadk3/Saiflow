"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { allowedGroups, type UploadEndpoint } from "@/lib/upload-labels";

/**
 * The words on an UploadThing button, in the page's language: "Choose file"
 * when ready, "Uploading 42%" while it works, and a clean list of what the
 * endpoint accepts (lib/upload-labels). Pass the result as `content`.
 */
export function useUploadContent(endpoint: UploadEndpoint) {
  const t = useTranslations("upload");
  const allowed = useMemo(
    () =>
      allowedGroups(endpoint)
        .map((group) => {
          const names = group.labels.map((label) => (label === "audio" || label === "video" ? t(label) : label));
          return t("allowed", { types: names.join(t("separator")), size: group.maxSize });
        })
        .join(" · "),
    [endpoint, t]
  );

  return useMemo(
    () => ({
      button: ({ ready, isUploading, uploadProgress }: { ready: boolean; isUploading: boolean; uploadProgress: number }) =>
        isUploading ? t("uploading", { progress: Math.round(uploadProgress) }) : ready ? t("choose") : t("loading"),
      allowedContent: () => allowed,
    }),
    [allowed, t]
  );
}
