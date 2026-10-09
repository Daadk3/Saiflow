/**
 * The browser-wide lock every checkout request runs under, or no request.
 *
 * WHY. Two tabs of one browser that both ask for checkout before either
 * holds a checkout identity are each issued a different one. If the second
 * tab's identity cookie lands after the first tab has already asked again,
 * each tab then creates its own payable Geidea session under its own
 * identity, and the database cannot tell they are one buyer. Only a lock
 * shared by every tab of the browser, held from the first request to the
 * reply that creates or resumes the session, keeps the second tab from
 * asking at all until the first is done.
 *
 * SO IT FAILS CLOSED. A checkout request runs while holding that lock, or it
 * is never sent. A browser without the Web Locks API, or one that refuses
 * or fails the lock request, gets no checkout request from this page; the
 * page explains that checkout cannot start safely in this browser.
 *
 * Pure apart from the lock manager it is given, so every case is tested as
 * behaviour with stand-ins for the browser's.
 */

/** What became of a checkout task: run while holding the lock, or never run. */
export type LockOutcome<T> = { held: true; value: T } | { held: false };

/** The one Web Locks method used. */
interface LockRequester {
  request(name: string, options: { mode: "exclusive" }, callback: () => Promise<void>): unknown;
}

function isLockRequester(value: unknown): value is LockRequester {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { request?: unknown }).request === "function"
  );
}

/**
 * Run `task` while holding the exclusive lock `name`, or not at all.
 *
 * Resolves `{ held: false }` without calling `task` when `locks` is not a
 * lock manager, when asking for the lock throws, and when the request ends,
 * refused or not, without the lock ever being granted. Resolves
 * `{ held: true, value }` once `task`, started only after the lock was
 * granted, has finished; the lock is held until then. A failure of the task
 * itself, after it began, is passed on as that failure: it is not a lock
 * that was never had, and must never read as one. A lock manager that
 * settles before the task has finished did not hold the lock for all of it,
 * and is treated as no lock.
 */
export async function runLocked<T>(
  locks: unknown,
  name: string,
  task: () => Promise<T>
): Promise<LockOutcome<T>> {
  if (!isLockRequester(locks)) return { held: false };
  const run: { began: boolean; done: boolean; value?: T } = { began: false, done: false };
  try {
    await locks.request(name, { mode: "exclusive" }, () => {
      run.began = true;
      return task().then((value) => {
        run.value = value;
        run.done = true;
      });
    });
  } catch (error) {
    if (!run.began) return { held: false };
    throw error;
  }
  if (!run.done) return { held: false };
  return { held: true, value: run.value as T };
}
