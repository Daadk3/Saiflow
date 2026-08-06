import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/authOptions";
import { isAdminEmail } from "@/lib/admin";

/**
 * Authorization root for every Founder Dashboard route.
 *
 * The site middleware only enforces *authentication* on /dashboard/* — any
 * signed-in seller passes it. This layout is the admin boundary, and because
 * it wraps the whole segment, every current and future child route inherits
 * the check by construction rather than by a developer remembering it.
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
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) redirect("/login");
  if (!isAdminEmail(session.user.email)) redirect("/dashboard");

  return <>{children}</>;
}
