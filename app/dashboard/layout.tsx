import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { extractRouterConfig } from "uploadthing/server";
import { ourFileRouter } from "@/app/api/uploadthing/core";

/**
 * Every dashboard page gets the upload routes' settings (accepted types and
 * sizes) in its HTML, so an upload button is ready the moment the page
 * loads. Without this each button fetched them itself after mounting, and on
 * a page with two buttons (edit store: cover and logo) one could stay stuck
 * on "Preparing…" with no file-type filter until another upload happened.
 *
 * Only the routes' public settings are included (the same data GET
 * /api/uploadthing serves); no token or key. Authorization is unchanged:
 * the middleware guards /dashboard and every upload route checks the
 * uploader's shop on the server.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NextSSRPlugin routerConfig={extractRouterConfig(ourFileRouter)} />
      {children}
    </>
  );
}
