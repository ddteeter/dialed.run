import { describe, expect, it, vi } from "vitest";

import {
  bandContextFor,
  shouldAskForVerdict,
} from "../../src/modules/feed/entries";

/**
 * The two decisions that used to live in route loaders.
 *
 * A route file imports a module's `functions.ts`, so no test can import
 * it — which made these the only two branches on the feed's read path
 * that nothing could reach.
 */

describe("shouldAskForVerdict", () => {
  const entry = { userId: "01AUTHOR", verdict: undefined };

  it("asks the author of an entry with no verdict", async () => {
    const budget = vi.fn(() => Promise.resolve(true));
    expect(await shouldAskForVerdict(entry, "01AUTHOR", budget)).toBe(true);
    expect(budget).toHaveBeenCalledTimes(1);
  });

  it("defers to the once-only budget when it says no", async () => {
    // The prompt showing at all spends the budget (packet A3), so a second
    // open gets nothing even though the entry still has no verdict.
    expect(
      await shouldAskForVerdict(entry, "01AUTHOR", () => Promise.resolve(false)),
    ).toBe(false);
  });

  it("never asks a stranger, and never spends a query on one", async () => {
    // The cheap checks come first on purpose: a popular entry would
    // otherwise cost one budget lookup per viewer.
    const budget = vi.fn(() => Promise.resolve(true));
    expect(await shouldAskForVerdict(entry, "01SOMEONEELSE", budget)).toBe(
      false,
    );
    expect(budget).not.toHaveBeenCalled();
  });

  it("never asks a signed-out viewer", async () => {
    const budget = vi.fn(() => Promise.resolve(true));
    expect(await shouldAskForVerdict(entry, undefined, budget)).toBe(false);
    expect(budget).not.toHaveBeenCalled();
  });

  it("never asks about an entry that already has a verdict", async () => {
    const budget = vi.fn(() => Promise.resolve(true));
    expect(
      await shouldAskForVerdict(
        { userId: "01AUTHOR", verdict: 0 },
        "01AUTHOR",
        budget,
      ),
    ).toBe(false);
    expect(budget).not.toHaveBeenCalled();
  });

  it("treats a dialed verdict as a verdict", async () => {
    // 0 means dialed, not "no answer" — a truthiness check here would ask
    // every runner who got it exactly right to answer again.
    const budget = vi.fn(() => Promise.resolve(true));
    await shouldAskForVerdict(
      { userId: "01AUTHOR", verdict: 0 },
      "01AUTHOR",
      budget,
    );
    expect(budget).not.toHaveBeenCalled();
  });
});

describe("bandContextFor", () => {
  it("places the entry in a band and fetches its counts", async () => {
    const countsFor = vi.fn((floor: number) =>
      Promise.resolve({ cold: 3, floor }),
    );

    const context = await bandContextFor(
      { conditions: { feelsLikeC: 7.5 } },
      (feelsLikeC) => Math.floor(feelsLikeC / 5) * 5,
      countsFor,
    );

    expect(context.bandFloor).toBe(5);
    expect(context.bandCounts).toStrictEqual({ cold: 3, floor: 5 });
    // The counts are asked for by band, not by entry.
    expect(countsFor).toHaveBeenCalledWith(5);
  });

  it("asks for nothing when the entry has no conditions to place", async () => {
    // An indoor run has no band, so there is nothing to say — and asking
    // anyway would be a query per verdict for an answer that cannot be
    // shown.
    const countsFor = vi.fn(() => Promise.resolve({ cold: 0 }));

    const context = await bandContextFor(
      { conditions: undefined },
      () => 0,
      countsFor,
    );

    expect(context).toStrictEqual({
      bandFloor: undefined,
      bandCounts: undefined,
    });
    expect(countsFor).not.toHaveBeenCalled();
  });

  it("keeps a band floor of zero, which is a real band", async () => {
    // 0°C is the freezing band, not the absence of one.
    const context = await bandContextFor(
      { conditions: { feelsLikeC: 1 } },
      () => 0,
      (floor) => Promise.resolve({ floor }),
    );
    expect(context.bandFloor).toBe(0);
    expect(context.bandCounts).toStrictEqual({ floor: 0 });
  });
});
