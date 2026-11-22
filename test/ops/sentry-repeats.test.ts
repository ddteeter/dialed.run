import { afterEach, describe, expect, it, vi } from "vitest";

import {
  errorKind,
  MAX_REMEMBERED_KINDS,
  REPEAT_WINDOW_MS,
  repeatGate,
} from "../../src/modules/ops/sentry/repeats";
import {
  captureRequestException,
  requestReporter,
  type SentryReport,
} from "../../src/modules/ops/sentry/sentry";

describe("an error's kind", () => {
  it("is its name and message", () => {
    expect(errorKind(new TypeError("bad id"))).toBe("TypeError: bad id");
  });

  it("is the value's type for anything that is not an Error", () => {
    expect(errorKind("text")).toBe("string");
    expect(errorKind(undefined)).toBe("undefined");
  });
});

describe("the repeat gate", () => {
  it("lets a kind through once per window", () => {
    const isDue = repeatGate(1000, 8);
    expect(isDue("a", 0)).toBe(true);
    expect(isDue("a", 999)).toBe(false);
    expect(isDue("a", 1000)).toBe(true);
    expect(isDue("a", 1500)).toBe(false);
  });

  it("keeps each kind's window apart", () => {
    const isDue = repeatGate(1000, 8);
    expect(isDue("a", 0)).toBe(true);
    expect(isDue("b", 10)).toBe(true);
    expect(isDue("a", 20)).toBe(false);
    expect(isDue("b", 30)).toBe(false);
  });

  it("forgets the oldest kind once it holds more than its bound", () => {
    const isDue = repeatGate(1000, 2);
    expect(isDue("a", 0)).toBe(true);
    expect(isDue("b", 1)).toBe(true);
    // A third kind pushes "a" out, so "a" is due again inside its window.
    expect(isDue("c", 2)).toBe(true);
    expect(isDue("b", 3)).toBe(false);
    expect(isDue("a", 4)).toBe(true);
  });

  it("counts a re-sent kind as the newest, not the oldest", () => {
    const isDue = repeatGate(10, 2);
    expect(isDue("a", 0)).toBe(true);
    expect(isDue("b", 1)).toBe(true);
    // "a" is sent again after its window, so "b" is now the oldest.
    expect(isDue("a", 10)).toBe(true);
    expect(isDue("c", 11)).toBe(true);
    expect(isDue("a", 12)).toBe(false);
    expect(isDue("b", 13)).toBe(true);
  });

  it("defaults to a minute and a bounded set of kinds", () => {
    expect(REPEAT_WINDOW_MS).toBe(60_000);
    expect(MAX_REMEMBERED_KINDS).toBe(64);
    const isDue = repeatGate();
    expect(isDue("a", 0)).toBe(true);
    expect(isDue("a", 59_999)).toBe(false);
    expect(isDue("a", 60_000)).toBe(true);
  });
});

function reporterAt(times: number[]) {
  const sent: { error: unknown; report: SentryReport }[] = [];
  let index = 0;
  const report = requestReporter(
    repeatGate(1000, 8),
    (error, details) => {
      sent.push({ error, report: details });
    },
    () => times[index++] ?? 0,
  );
  return { report, sent };
}

describe("the reporter for a request that threw", () => {
  it("sends one issue per kind, with the kind as its fingerprint", () => {
    const { report, sent } = reporterAt([0]);
    const error = new Error("Invalid server action param");
    report(error);
    expect(sent).toStrictEqual([
      {
        error,
        report: {
          context: { surface: "fetch" },
          tags: {},
          fingerprint: ["fetch", "Error: Invalid server action param"],
        },
      },
    ]);
  });

  it("sends a repeat of one kind once per window", () => {
    const { report, sent } = reporterAt([0, 500, 1000]);
    report(new Error("x"));
    report(new Error("x"));
    report(new Error("x"));
    expect(sent).toHaveLength(2);
  });

  it("sends a different kind inside the window", () => {
    const { report, sent } = reporterAt([0, 1]);
    report(new Error("x"));
    report(new Error("y"));
    expect(sent.map((one) => one.report.fingerprint)).toStrictEqual([
      ["fetch", "Error: x"],
      ["fetch", "Error: y"],
    ]);
  });
});

describe("what server.ts reports a thrown request with", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("goes to the Worker's own reporter, once per kind", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {
      /*
       * The disabled reporter's line is what is asserted.
       */
    });
    const error = new Error("a kind only this test throws");

    captureRequestException(error);
    captureRequestException(new Error("a kind only this test throws"));

    // No DSN in the test bindings, so the report is the disabled line.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { surface: "fetch" },
      error,
    );
  });
});
