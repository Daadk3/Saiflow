import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/api/auth/authOptions";
import { isAdminEmail } from "@/lib/admin";

/**
 * The Founder Dashboard's admin check, for a server page or layout: the
 * signed-out go to /login, signed-in non-admins to /dashboard. Returns the
 * admin's email.
 *
 * WHY EVERY ADMIN PAGE CALLS IT, NOT ONLY THE LAYOUT. Next.js renders layouts
 * and pages as separate segments, and on a client navigation it can render a
 * page without re-running a layout it believes is already shown ("partial
 * rendering"). A layout's check is therefore not a guarantee for the data a
 * page loads; Next.js's own guidance is to check close to the data. The
 * layout keeps its check (it still covers any future child), and each admin
 * page that reads data checks again before reading it
 * (tests/security-auth-access.test.ts).
 */
export async function requireAdminPage(): Promise<string> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/login");
  if (!isAdminEmail(email)) redirect("/dashboard");
  return email;
}
