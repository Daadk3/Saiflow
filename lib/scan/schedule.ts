import { after } from "next/server";
import { redactId } from "@/lib/redact-id";
import { scanFileAsset } from "./run";

/**
 * Schedule a scan of exactly one stored object, to run once the current
 * response has been sent.
 *
 * WHY `after`. It is Next's supported post-response hook. On Vercel it is
 * backed by the platform's `waitUntil`, so the invocation is kept alive until
 * the task settles, bounded by the route's `maxDuration`; in `next dev` it
 * runs the same way. Every route that calls this exports `maxDuration = 300`,
 * the scan worker's own budget, because the scan moves the file twice.
 *
 * WHY NOT a fetch to the worker route. A fetch fired and not awaited can be
 * dropped when the function is frozen; one that is awaited ties this route's
 * budget to the worker's. Invoking the worker directly needs no network hop,
 * no shared secret and no Cron, so Preview and Production run the same path.
 * Cron stays as the sweeper for anything this misses.
 *
 * Quota-safe by construction: the worker claims atomically, so if the
 * sweeper reaches the same key first this attempt is SKIPPED_NOT_CLAIMED and
 * spends nothing. A settled file is skipped the same way.
 *
 * Returns false when there is no request scope to attach to (scripts, tests).
 * That is a downgrade to sweeper-only, never an unsafe state.
 */
export function scheduleScan(key: string): boolean {
  try {
    after(async () => {
      try {
        const report = await scanFileAsset(key);
        console.log(
          `[scan] scheduled key=${redactId(key)} outcome=${report.outcome}${
            report.reason ? ` reason=${report.reason}` : ""
          }`
        );
      } catch (error) {
        console.error("[scan] scheduled scan failed", (error as Error)?.name);
      }
    });
    return true;
  } catch (error) {
    console.warn("[scan] could not schedule a scan", (error as Error)?.name);
    return false;
  }
}
