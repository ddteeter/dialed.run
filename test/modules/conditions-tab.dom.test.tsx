import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { ConditionsTab } from "../../src/modules/feed/components/ConditionsTab";
import type { ConsensusResult } from "../../src/modules/feed/consensus";
import type { ConditionsHome } from "../../src/modules/feed/home";
import { MILES, renderFeedScreen } from "./feed-fixtures";

/**
 * Your conditions (E2-lite), in round 22's four drawn states — waiting,
 * location denied, no matches, widened — plus the unwidened block and the
 * two it does not draw (no weather, a failed read).
 */
interface Coords {
  lat: number;
  lng: number;
}

const PORTLAND = { lat: 45.52, lng: -122.68 };
const NOWHERE: ConditionsHome = { coords: undefined, cityLabel: undefined };
const band = { minC: 5, maxC: 8, precip: "damp" as const };

function tab(
  overrides: {
    home?: ConditionsHome;
    locate?: () => Promise<Coords | undefined>;
    conditionsFor?: (input: {
      data: Coords;
    }) => Promise<ConsensusResult | undefined>;
    saveCity?: (input: { data: { cityLabel: string } }) => Promise<Coords>;
  } = {},
) {
  return (
    <ConditionsTab
      home={overrides.home ?? NOWHERE}
      locate={overrides.locate ?? (() => Promise.resolve({ lat: 1, lng: 2 }))}
      conditionsFor={
        overrides.conditionsFor ?? (() => Promise.resolve(undefined))
      }
      saveCity={overrides.saveCity ?? (() => Promise.resolve(PORTLAND))}
      units={MILES}
    />
  );
}

function block(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    '[data-part="match-block"]',
  );
  if (element === null) throw new Error("no match block");
  return element;
}

describe("ConditionsTab: waiting", () => {
  it("is one state for asking and fetching: the headline breathes, nothing else", async () => {
    const pending = Promise.withResolvers<Coords | undefined>();
    await renderFeedScreen(tab({ locate: () => pending.promise }));

    expect(block()).toHaveAttribute("data-state", "waiting");
    expect(block()).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Your conditions")).toHaveClass("font-mono");
    expect(screen.getByText("Finding weather")).toBeVisible();
    const brackets = block().querySelectorAll(".breathe");
    expect(brackets).toHaveLength(2);
    pending.resolve(undefined);
  });

  it("asks where the runner is, and asks the consensus about exactly there", async () => {
    const conditionsFor = vi.fn(() => Promise.resolve(undefined));
    await renderFeedScreen(
      tab({
        locate: () => Promise.resolve({ lat: 44.98, lng: -93.27 }),
        conditionsFor,
      }),
    );

    await waitFor(() => {
      expect(conditionsFor).toHaveBeenCalledWith({
        data: { lat: 44.98, lng: -93.27 },
      });
    });
  });

  it("skips the prompt entirely for a runner with a saved location", async () => {
    const locate = vi.fn(() => Promise.resolve({ lat: 9, lng: 9 }));
    const conditionsFor = vi.fn(() => Promise.resolve(undefined));
    await renderFeedScreen(
      tab({
        home: { coords: { lat: 45, lng: -122 }, cityLabel: "Portland" },
        locate,
        conditionsFor,
      }),
    );

    await waitFor(() => {
      expect(conditionsFor).toHaveBeenCalledWith({
        data: { lat: 45, lng: -122 },
      });
    });
    expect(locate).not.toHaveBeenCalled();
  });
});

describe("ConditionsTab: when what it was given changes", () => {
  it("looks again, with what it was given now, when the place or the reader changes", async () => {
    const user = userEvent.setup();
    const before = vi.fn(() => Promise.resolve(undefined));
    const after = vi.fn(() => Promise.resolve(undefined));

    function Changing() {
      const [moved, setMoved] = useState(false);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setMoved(true);
            }}
          >
            Move
          </button>
          {tab({
            home: {
              coords: moved ? PORTLAND : { lat: 1, lng: 1 },
              cityLabel: undefined,
            },
            conditionsFor: moved ? after : before,
          })}
        </>
      );
    }

    await renderFeedScreen(<Changing />);
    await waitFor(() => {
      expect(before).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(after).toHaveBeenCalledWith({ data: PORTLAND });
    });
    expect(before).toHaveBeenCalledTimes(1);
  });
});

describe("ConditionsTab: location denied", () => {
  it("asks where they run, with a city field — not a failure, so no band", async () => {
    await renderFeedScreen(tab({ locate: () => Promise.resolve(undefined) }));

    expect(await screen.findByText("Where do you run?")).toBeVisible();
    expect(block()).toHaveAttribute("data-state", "location-denied");
    expect(
      screen.getByText(
        "Location is off. Type your city and we’ll match its weather instead.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("City")).toBeVisible();
    expect(
      screen.getByText("Saved to your settings. Change it any time under You."),
    ).toBeVisible();
    expect(document.querySelector('[data-part="failure-band"]')).toBeNull();
  });

  it("never asks again once a city is saved: no reading, no form", async () => {
    await renderFeedScreen(
      tab({
        home: { coords: undefined, cityLabel: "Portland, OR" },
        locate: () => Promise.resolve(undefined),
      }),
    );

    expect(await screen.findByText("No weather yet")).toBeVisible();
    expect(screen.queryByLabelText("City")).toBeNull();
  });

  it("saves the typed city, then matches the weather where it was found", async () => {
    const user = userEvent.setup();
    const saveCity = vi.fn(() => Promise.resolve(PORTLAND));
    const conditionsFor = vi.fn(() =>
      Promise.resolve({
        status: "too-few" as const,
        windowDays: 14 as const,
        band,
      }),
    );
    await renderFeedScreen(
      tab({
        locate: () => Promise.resolve(undefined),
        saveCity,
        conditionsFor,
      }),
    );

    await user.type(await screen.findByLabelText("City"), "  Portland, OR ");
    await user.click(screen.getByRole("button", { name: "Use this city" }));

    expect(saveCity).toHaveBeenCalledWith({
      data: { cityLabel: "Portland, OR" },
    });
    // Announced before the screen moves on (the form contract's order).
    await waitFor(
      () => {
        expect(screen.getByRole("status")).toHaveTextContent("City saved.");
      },
      { interval: 1 },
    );
    // A city nobody's matched yet goes straight to No matches (round 22).
    expect(await screen.findByText("Not enough runs yet")).toBeVisible();
    expect(conditionsFor).toHaveBeenCalledWith({ data: PORTLAND });
  });

  it("says why on the city field when the city cannot be found, and keeps the form", async () => {
    const user = userEvent.setup();
    // What the server sends for a city the provider could not find: the
    // schema's issue on the city field, as any field error arrives.
    const notFound = new ZodError([
      {
        code: "custom",
        path: ["cityLabel"],
        message: "We couldn't find that city. Add the state or country.",
        input: undefined,
      },
    ]);
    await renderFeedScreen(
      tab({
        locate: () => Promise.resolve(undefined),
        saveCity: () => Promise.reject(notFound),
      }),
    );

    await user.type(await screen.findByLabelText("City"), "Atlantis");
    await user.click(screen.getByRole("button", { name: "Use this city" }));

    expect(
      await screen.findByText(
        "We couldn't find that city. Add the state or country.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("City")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(document.querySelector('[data-part="failure-band"]')).toBeNull();
  });

  it("waits on the weather where the saved city is, breathing, before it answers", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderFeedScreen(
      tab({
        locate: () => Promise.resolve(undefined),
        conditionsFor: () => pending.promise,
      }),
    );

    await user.type(await screen.findByLabelText("City"), "Portland");
    await user.click(screen.getByRole("button", { name: "Use this city" }));

    expect(await screen.findByText("Finding weather")).toBeVisible();
    pending.resolve(undefined);
    expect(await screen.findByText("No weather yet")).toBeVisible();
  });

  it("keeps the page where it is when the city is sent", async () => {
    await renderFeedScreen(tab({ locate: () => Promise.resolve(undefined) }));
    const field = await screen.findByLabelText("City");
    const form = field.closest("form");
    if (form === null) throw new Error("no form");
    // `fireEvent` answers whether the default went ahead: it must not.
    expect(fireEvent.submit(form)).toBe(false);
  });

  it("marks an empty city with the schema's sentence and saves nothing", async () => {
    const user = userEvent.setup();
    const saveCity = vi.fn(() => Promise.resolve(PORTLAND));
    await renderFeedScreen(
      tab({ locate: () => Promise.resolve(undefined), saveCity }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Use this city" }),
    );

    expect(await screen.findByText("Type the city you run in.")).toBeVisible();
    expect(saveCity).not.toHaveBeenCalled();
  });

  it("keeps the form and says Nothing saved when the save fails", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      tab({
        locate: () => Promise.resolve(undefined),
        saveCity: () => Promise.reject(new TypeError("offline")),
      }),
    );

    await user.type(await screen.findByLabelText("City"), "Portland");
    await user.click(screen.getByRole("button", { name: "Use this city" }));

    expect(await screen.findByText("Nothing saved")).toBeVisible();
    expect(screen.getByLabelText("City")).toHaveValue("Portland");
  });
});

describe("ConditionsTab: no matches", () => {
  it("says there are not enough runs yet, why, and offers the Call as the way on", async () => {
    await renderFeedScreen(
      tab({
        conditionsFor: () =>
          Promise.resolve({ status: "too-few", windowDays: 14, band }),
      }),
    );

    expect(await screen.findByText("Not enough runs yet")).toBeVisible();
    expect(block()).toHaveAttribute("data-state", "no-matches");
    expect(block()).toHaveTextContent(
      "Matching [41–46°] · damp · Last 14 days",
    );
    expect(
      screen.getByText(
        "Fewer than five runners near you logged this weather in two weeks — too few to show without showing who.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("Your own record in this band is on the Call."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Open the Call" })).toHaveAttribute(
      "href",
      "/call",
    );
    // Teal means matched, so an empty answer never wears it.
    expect(block()).not.toHaveClass("bg-teal");
  });
});

describe("ConditionsTab: matched", () => {
  const matched = {
    status: "matched",
    runners: 6,
    groups: [
      { group: "tops", runners: 5 },
      { group: "bottoms", runners: 3 },
      { group: "shoes", runners: 2 },
    ],
    windowDays: 3,
    band,
  } as const;

  it("fills the block teal and counts the runners, in the last three days", async () => {
    await renderFeedScreen(
      tab({ conditionsFor: () => Promise.resolve(matched) }),
    );

    expect(await screen.findByText("6 runners logged this")).toBeVisible();
    expect(block()).toHaveAttribute("data-state", "matched");
    expect(block()).toHaveClass("bg-teal");
    expect(block()).toHaveTextContent("Matching [41–46°] · damp · Last 3 days");
    expect(screen.getByText("In the last three days, near you.")).toBeVisible();
  });

  it("says so when it had to look back two weeks", async () => {
    await renderFeedScreen(
      tab({
        conditionsFor: () => Promise.resolve({ ...matched, windowDays: 14 }),
      }),
    );

    expect(
      await screen.findByText(
        "Too few this week, so this looks back two weeks.",
      ),
    ).toBeVisible();
    expect(block()).toHaveAttribute("data-state", "widened");
    expect(block()).toHaveTextContent("Last 14 days");
  });

  it("lists what they wore, each against the runners, the majority in pink", async () => {
    await renderFeedScreen(
      tab({ conditionsFor: () => Promise.resolve(matched) }),
    );

    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      "Tops5/6",
      "Bottoms3/6",
      "Shoes2/6",
    ]);
    const fills = rows.map(
      (row) => row.querySelector<HTMLElement>(":scope > span > span") ?? row,
    );
    expect(fills.map((fill) => fill.style.width)).toStrictEqual([
      "83%",
      "50%",
      "33%",
    ]);
    // More than half is pink; half or fewer is the quiet grey.
    expect(fills[0]).toHaveClass("bg-action");
    expect(fills[1]).toHaveClass("bg-hairline-2");
    expect(fills[2]).toHaveClass("bg-hairline-2");
    expect(screen.getByText("5/6")).toHaveClass("font-mono");
    expect(screen.getByText("What they wore")).toBeVisible();
  });

  it("drops the list when no group reached two runners", async () => {
    await renderFeedScreen(
      tab({
        conditionsFor: () => Promise.resolve({ ...matched, groups: [] }),
      }),
    );

    expect(await screen.findByText("6 runners logged this")).toBeVisible();
    expect(screen.queryByText("What they wore")).toBeNull();
  });
});

describe("ConditionsTab: what round 22 does not draw", () => {
  it("says there is no weather yet when the place has no reading — never that nobody ran", async () => {
    await renderFeedScreen(tab());

    expect(await screen.findByText("No weather yet")).toBeVisible();
    expect(block()).toHaveAttribute("data-state", "no-weather");
    expect(screen.getByRole("link", { name: "Open the Call" })).toBeVisible();
  });

  it("says Didn't load when the read fails, and tries again", async () => {
    const user = userEvent.setup();
    const conditionsFor = vi
      .fn<() => Promise<ConsensusResult | undefined>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({ status: "too-few", windowDays: 14, band });
    await renderFeedScreen(tab({ conditionsFor }));

    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.getByText("Your connection dropped.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Not enough runs yet")).toBeVisible();
    expect(conditionsFor).toHaveBeenCalledTimes(2);
  });
});
