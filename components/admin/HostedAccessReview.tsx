import type { AdminHostedAccessView } from "@/lib/hosted-access/admin";

/**
 * The admin's view of a hosted-access product's private link and buyer
 * instructions, for review before approval. Server-rendered on an admin-only
 * page. The link is shown as text and as an anchor that opens in a new tab
 * without a referrer; SaiFlow itself never fetches or previews it.
 */
export function HostedAccessReview({
  access,
  t,
}: {
  access: AdminHostedAccessView | null;
  t: (key: string) => string;
}) {
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-[#0f0f0f] p-5">
      <h2 className="mb-1 text-sm font-semibold text-cyan-300">{t("hostedAccess.admin.title")}</h2>
      <p className="mb-3 text-xs text-gray-500">{t("hostedAccess.admin.privateNote")}</p>
      {access === null ? (
        <p className="text-sm text-red-300">{t("hostedAccess.admin.missing")}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-xs font-medium text-gray-400">{t("hostedAccess.admin.link")}</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-200" dir="ltr">
              {access.accessUrl}
            </p>
            {access.host && (
              <p className="mt-1 text-xs text-gray-500" dir="ltr">
                {access.host}
              </p>
            )}
            {access.urlOk ? (
              <a
                href={access.accessUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                className="mt-2 inline-block text-xs text-teal-400 hover:underline"
              >
                {t("hostedAccess.admin.open")}
              </a>
            ) : (
              <p className="mt-2 text-xs text-red-300">{t("hostedAccess.admin.linkRefused")}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400">{t("hostedAccess.admin.instructions")}</p>
            <p dir="auto" className="mt-1 whitespace-pre-wrap text-gray-300 [unicode-bidi:plaintext]">
              {access.instructions || t("hostedAccess.admin.noInstructions")}
            </p>
            {!access.instructionsOk && (
              <p className="mt-2 text-xs text-red-300">{t("hostedAccess.admin.instructionsRefused")}</p>
            )}
          </div>
          <ul className="list-disc space-y-1 ps-5 text-xs text-gray-500">
            <li>{t("hostedAccess.admin.check1")}</li>
            <li>{t("hostedAccess.admin.check2")}</li>
            <li>{t("hostedAccess.admin.check3")}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
