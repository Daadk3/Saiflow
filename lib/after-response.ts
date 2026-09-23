import { after } from "next/server";

/**
 * Run a side task once the response has been sent.
 *
 * On Vercel, `after` hands the task to the platform and the response goes out
 * immediately; the function stays alive until the task settles. Outside a
 * request scope (tests, scripts) `after` throws, and the task runs inline
 * instead. In both cases the caller's response cannot depend on the task: its
 * result is discarded and a failure is logged, never rethrown. The task is
 * expected to report its own outcome (lib/notify does).
 */
export async function runAfterResponse(task: () => Promise<unknown>): Promise<"deferred" | "inline"> {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.warn("[after-response] task failed", (error as Error)?.name ?? "Error");
    }
  };
  try {
    after(guarded);
    return "deferred";
  } catch {
    await guarded();
    return "inline";
  }
}
