import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-page-guard";

/**
 * Authorization root for every Founder Dashboard route.
 *
 * The site middleware only enforces *authentication* on /dashboard/* — any
 * signed-in seller passes it. This layout is the admin boundary, and because
 * it wraps the whole segment, every current and future child route inherits
 * the check by construction rather than by a developer remembering it.
 *
 * Not the only check: Next.js can render a page without re-running this
 * layout, so every admin page that reads data calls requireAdminPage itself
 * too (lib/admin-page-guard).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founder Dashboard",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();
  return <>{children}</>;
}
