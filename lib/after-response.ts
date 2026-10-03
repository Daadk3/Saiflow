import { after } from "next/server";

/**
 * Run work after the response has been sent, so its duration cannot show in
 * how long the request took. On Vercel the function stays alive until the
 * task settles.
 *
 * A wrapper rather than a direct `after` call so tests can run the task
 * themselves: outside a request, Next's `after` refuses to schedule.
 */
export function afterResponse(task: () => Promise<void>): void {
  after(task);
}
