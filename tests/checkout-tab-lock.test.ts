/**
 * lib/checkout/tab-lock: a checkout task runs holding the browser-wide lock,
 * or it never runs.
 *
 * Behavioural, against stand-ins for the browser's lock manager: missing,
 * throwing, refusing, granting nothing, and a FIFO manager that grants one
 * holder at a time the way the Web Locks API does. MOCKED: no real browser
 * runs here, so whether a given browser's own lock manager behaves like the
 * FIFO stand-in is assumed, not tested.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { runLocked } from "../lib/checkout/tab-lock";

const NAME = "saiflow-checkout";

/** Rejections no one handled, collected while this file runs. */
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};
before(() => {
  process.on("unhandledRejection", onUnhandled);
});
after(() => {
  process.off("unhandledRejection", onUnhandled);
});

/** Let every pending continuation, and any unhandled-rejection report, run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A task that records each run and what it saw. */
function countingTask(locks?: { holders: number }) {
  const runs: { heldWhileRunning: boolean }[] = [];
  const task = async () => {
    runs.push({ heldWhileRunning: locks === undefined ? false : locks.holders === 1 });
    return "reply";
  };
  return { runs, task };
}

/** One exclusive holder at a time, in order of request: the Web Locks API's grant, in miniature. */
function fifoLocks() {
  let tail: Promise<void> = Promise.resolve();
  const manager = {
    holders: 0,
    mostHolders: 0,
    requests: [] as { name: string; options: unknown }[],
    request(name: string, options: unknown, callback: () => Promise<void>): Promise<void> {
      manager.requests.push({ name, options });
      const turn = tail.then(() => {
        manager.holders++;
        manager.mostHolders = Math.max(manager.mostHolders, manager.holders);
        return callback().finally(() => {
          manager.holders--;
        });
      });
      tail = turn.then(
        () => undefined,
        () => undefined
      );
      return turn;
    },
  };
  return manager;
}

describe("no lock manager: the task never runs", () => {
  test("missing, null, or anything without a request method", async () => {
    for (const locks of [undefined, null, {}, { request: "not a function" }, 42, "locks"]) {
      const { runs, task } = countingTask();
      assert.deepEqual(await runLocked(locks, NAME, task), { held: false }, String(locks));
      assert.equal(runs.length, 0, String(locks));
    }
  });
});

describe("a lock the browser refuses or cannot grant: the task never runs, and nothing is left unhandled", () => {
  test("asking for the lock throws at once", async () => {
    const locks = {
      request() {
        throw new DOMException("The document is not fully active.", "InvalidStateError");
      },
    };
    const { runs, task } = countingTask();
    assert.deepEqual(await runLocked(locks, NAME, task), { held: false });
    assert.equal(runs.length, 0);
    await settle();
    assert.deepEqual(unhandled, []);
  });

  test("the request is rejected before the lock is granted", async () => {
    const locks = { request: () => Promise.reject(new DOMException("The request was aborted.", "AbortError")) };
    const { runs, task } = countingTask();
    assert.deepEqual(await runLocked(locks, NAME, task), { held: false });
    assert.equal(runs.length, 0);
    await settle();
    assert.deepEqual(unhandled, []);
  });

  test("the request settles without ever granting the lock", async () => {
    const locks = { request: async () => undefined };
    const { runs, task } = countingTask();
    assert.deepEqual(await runLocked(locks, NAME, task), { held: false });
    assert.equal(runs.length, 0);
  });

  test("a lock manager that settles before the task has finished did not hold the lock for it: no lock", async () => {
    const locks = {
      request: (_name: string, _options: unknown, callback: () => Promise<void>) => {
        void callback();
        return Promise.resolve();
      },
    };
    const outcome = await runLocked(locks, NAME, () => new Promise<string>(() => {}));
    assert.deepEqual(outcome, { held: false });
  });
});

describe("a granted lock", () => {
  test("the task runs while the lock is held, and its result comes back with it", async () => {
    const locks = fifoLocks();
    const { runs, task } = countingTask(locks);
    assert.deepEqual(await runLocked(locks, NAME, task), { held: true, value: "reply" });
    assert.deepEqual(runs, [{ heldWhileRunning: true }]);
    assert.equal(locks.holders, 0, "released afterwards");
  });

  test("it asks for an exclusive lock, by the name it was given", async () => {
    const locks = fifoLocks();
    await runLocked(locks, NAME, async () => "reply");
    assert.deepEqual(locks.requests, [{ name: NAME, options: { mode: "exclusive" } }]);
  });

  test("two tasks for one lock run one after the other: the second starts only once the first has finished", async () => {
    const locks = fifoLocks();
    const order: string[] = [];
    let finishFirst: () => void = () => {};
    const first = runLocked(locks, NAME, () => {
      order.push("first started");
      return new Promise<string>((resolve) => {
        finishFirst = () => {
          order.push("first finished");
          resolve("one");
        };
      });
    });
    const second = runLocked(locks, NAME, async () => {
      order.push("second started");
      return "two";
    });
    await settle();
    assert.deepEqual(order, ["first started"], "the second waits while the first holds the lock");
    finishFirst();
    assert.deepEqual(await Promise.all([first, second]), [
      { held: true, value: "one" },
      { held: true, value: "two" },
    ]);
    assert.deepEqual(order, ["first started", "first finished", "second started"]);
    assert.equal(locks.mostHolders, 1);
  });

  test("the task's own failure after it began is passed on as that failure, never as a lock that was not had", async () => {
    const locks = fifoLocks();
    const failure = new Error("the task failed");
    await assert.rejects(
      runLocked(locks, NAME, async () => {
        throw failure;
      }),
      (error: unknown) => error === failure
    );
    assert.equal(locks.holders, 0, "the lock is released");
    await settle();
    assert.deepEqual(unhandled, []);
  });
});
