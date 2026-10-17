import { getTranslations } from "next-intl/server";
import { DashboardSkeleton } from "@/components/ui/DashboardSkeleton";

/**
 * Shown while a server-rendered dashboard page (such as My purchases or the
 * Founder Dashboard) is being prepared, instead of a blank screen.
 */
export default async function DashboardLoading() {
  const t = await getTranslations("dashboard.home");
  return <DashboardSkeleton label={t("loadingDashboard")} variant="list" />;
}
