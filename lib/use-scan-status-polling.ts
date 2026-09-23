"use client";

import { useEffect, useRef } from "react";
import { createScanPoller, type ScanPoller } from "@/lib/scan-status-polling";

/**
 * Keep a seller page's file state fresh while a check is in progress.
 *
 * `inProgress` is derived by the page from the data it last loaded (see
 * hasScanInProgress / isScanInProgress in lib/scan-status-polling); `refresh`
 * is the page's own read-only reload. The poller starts when `inProgress`
 * becomes true, stops the moment it becomes false, stops on unmount, and
 * gives up after SCAN_POLL_MAX_MS regardless.
 *
 * The latest `refresh` is kept in a ref so a page that re-creates the
 * function on every render (they all do) neither restarts the poller nor
 * resets its window.
 */
export function useScanStatusPolling(inProgress: boolean, refresh: () => unknown): void {
  const refreshRef = useRef(refresh);
  const pollerRef = useRef<ScanPoller | null>(null);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const poller = createScanPoller({
      refresh: () => refreshRef.current(),
      // A hidden tab is not looking: skip the reload and let the window run.
      isPaused: () =>
        typeof document !== "undefined" && document.visibilityState === "hidden",
    });
    pollerRef.current = poller;
    return () => {
      poller.stop();
      pollerRef.current = null;
    };
  }, []);

  useEffect(() => {
    pollerRef.current?.update(inProgress);
  }, [inProgress]);
}
