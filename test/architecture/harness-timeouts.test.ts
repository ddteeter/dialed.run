import { describe, expect, it } from "vitest";

import config from "../../vitest.config.ts?raw";

/**
 * A hook gets the same deadline as a test, in every vitest project.
 *
 * `vitest.config.ts` raises `testTimeout` for the starved harness (20s,
 * and a minute under Stryker's dry run); a project that sets it without
 * `hookTimeout` leaves its `beforeEach` on vitest's own 10s, which is how
 * a mutation shard's dry run failed on a table reset that takes
 * milliseconds (#566, design 199). Read as text: the config cannot be
 * imported from inside the pool it configures.
 */
const TEST_DEADLINE = "testTimeout: TEST_TIMEOUT_MS,";
const HOOK_DEADLINE = "hookTimeout: TEST_TIMEOUT_MS,";

const lines = config.split("\n").map((line) => line.trim());

describe("the harness timeouts", () => {
  it("sets a test deadline in each of the three projects", () => {
    expect(lines.filter((line) => line.startsWith('name: "'))).toHaveLength(3);
    expect(lines.filter((line) => line === TEST_DEADLINE)).toHaveLength(3);
  });

  it("gives every project's hooks the deadline its tests have", () => {
    const afterEachTestDeadline = lines.filter(
      (_line, index) => index > 0 && lines[index - 1] === TEST_DEADLINE,
    );
    expect(afterEachTestDeadline).toStrictEqual([
      HOOK_DEADLINE,
      HOOK_DEADLINE,
      HOOK_DEADLINE,
    ]);
  });

  it("types no deadline as a number of its own", () => {
    const typed = lines.filter(
      (line) =>
        (line.startsWith("testTimeout:") && line !== TEST_DEADLINE) ||
        (line.startsWith("hookTimeout:") && line !== HOOK_DEADLINE),
    );
    expect(typed).toStrictEqual([]);
  });
});
