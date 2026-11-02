import { expect, test } from "@playwright/test";

import { isLocked, whileLocked } from "./busy-retry";

/**
 * The retry every `withLocalDb` statement goes through. What it must get
 * right is narrow: try again on the lock, in each shape the proxy has
 * actually sent it, and on nothing else.
 */

/** An error shaped like the ones drizzle and D1 hand back: a wrapper
 *  whose `cause` chain ends at what workerd said. */
function wrapped(outer: string, ...causes: string[]): Error {
  let cause: Error | undefined;
  for (const message of causes.toReversed()) {
    cause = new Error(message, { cause });
  }
  return new Error(outer, { cause });
}

test("the lock is recognised in every shape CI has seen it arrive in", () => {
  // notifications-m, where SQLite's own words survived.
  expect(
    isLocked(
      wrapped("Failed query: delete …", "SQLITE_BUSY: database is locked"),
    ),
  ).toBe(true);
  // Runs 38054389037, 39173780977, 40132692494: workerd masks it.
  expect(
    isLocked(
      wrapped(
        "Failed query: insert …",
        "internal error; reference = 1l1qktda5uq29k7j8ehb20vn",
      ),
    ),
  ).toBe(true);
  // Run 41218872437: masked, behind D1's commit-token wrapper.
  expect(
    isLocked(
      wrapped(
        "Failed query: select …",
        "D1_ERROR: Failed to get session commit token: internal error; reference = ijjttefbeh0ppia18mgo3g7p",
        "Failed to get session commit token: internal error; reference = ijjttefbeh0ppia18mgo3g7p",
      ),
    ),
  ).toBe(true);
});

test("anything else is not the lock", () => {
  expect(
    isLocked(
      wrapped(
        "Failed query: insert …",
        "D1_ERROR: UNIQUE constraint failed: user.id: SQLITE_CONSTRAINT",
      ),
    ),
  ).toBe(false);
  expect(
    isLocked(wrapped("an internal error; reference = abc happened later")),
  ).toBe(false);
  expect(isLocked("SQLITE_BUSY")).toBe(false);
});

test("a statement that loses the lock is tried again until it wins", async () => {
  let calls = 0;
  const result = await whileLocked(() => {
    calls += 1;
    return calls < 3
      ? Promise.reject(
          wrapped("Failed query: …", "SQLITE_BUSY: database is locked"),
        )
      : Promise.resolve("written");
  });
  expect(result).toBe("written");
  expect(calls).toBe(3);
});

test("any other failure is thrown at once, unchanged", async () => {
  const constraint = wrapped("Failed query: …", "UNIQUE constraint failed");
  let calls = 0;
  await expect(
    whileLocked(() => {
      calls += 1;
      return Promise.reject(constraint);
    }),
  ).rejects.toBe(constraint);
  expect(calls).toBe(1);
});

test("a lock that outlasts every attempt still fails", async () => {
  const thrown: Error[] = [];
  let failure: unknown;
  try {
    await whileLocked(() => {
      const locked = wrapped(
        "Failed query: …",
        "SQLITE_BUSY: database is locked",
      );
      thrown.push(locked);
      return Promise.reject(locked);
    });
  } catch (error) {
    failure = error;
  }
  expect(thrown).toHaveLength(5);
  expect(failure).toBe(thrown.at(-1));
});
