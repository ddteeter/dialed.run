import { screen, waitFor, within } from "@testing-library/react";
import { drawnText, saidText } from "./spoken-text";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ConfirmEmailBand } from "../../src/modules/account/components/ConfirmEmailBand";
import { Avatar, initialOf } from "../../src/modules/feed/components/Avatar";
import { OtherProfile } from "../../src/modules/feed/components/OtherProfile";
import { OwnProfile } from "../../src/modules/feed/components/OwnProfile";
import { RunnerSearch } from "../../src/modules/feed/components/RunnerSearch";
import type {
  OtherProfile as OtherProfileData,
  OwnProfile as OwnProfileData,
} from "../../src/modules/feed/profiles";
import type { SearchResult } from "../../src/modules/feed/search";
import { expectBellEnding, renderFeedScreen, withBell } from "./feed-fixtures";
import { queryWeatherCredit } from "../ui/weather-credit";
import { pointConditions } from "../feed/conditions-fixture";
import { expectTheColumn } from "../ui/the-column";

/**
 * G, H and runner search, as round 22 draws them with only what v1
 * stores ("G New account", "H No public entries", item 15's ruling) —
 * and Follow on the control-failure pattern wherever it appears.
 */
const NOTHING = z.null().parse(JSON.parse("null"));
const done = () => Promise.resolve();

function ownProfile(overrides: Partial<OwnProfileData> = {}): OwnProfileData {
  return {
    userId: "01USER",
    username: "dana_kim",
    cityLabel: undefined,
    thermalLevel: undefined,
    followerCount: 0,
    followingCount: 0,
    entryCount: 0,
    runCount: 0,
    coverage: [],
    mostWornItems: [],
    units: { temp: "f", distance: "mi" },
    recentEntries: [],
    nextStep: undefined,
    ...overrides,
  };
}

function otherProfile(
  overrides: Partial<OtherProfileData> = {},
): OtherProfileData {
  return {
    userId: "01RAVI",
    username: "ravi_k",
    cityLabel: NOTHING,
    recentPublicEntries: [],
    units: { temp: "f", distance: "mi" },
    ...overrides,
  };
}

/**
A recent row: the day and distance its link names, and how it went.
*/
function recent(
  overrides: Partial<OwnProfileData["recentEntries"][number]> = {},
): OwnProfileData["recentEntries"][number] {
  return {
    entryId: "01E",
    createdAt: 1,
    day: "Sat, Aug 29",
    distanceM: 13_196.6,
    indoor: false,
    conditions: undefined,
    underReview: false,
    verdict: NOTHING,
    ...overrides,
  };
}

function recentRow(entryId: string): HTMLElement {
  const row = screen
    .getAllByRole("link")
    .find((link) => link.getAttribute("href") === `/feed/entry/${entryId}`)
    ?.closest("li");
  if (!row) throw new Error(`no recent row for ${entryId}`);
  return row;
}

function part(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-part="${CSS.escape(name)}"]`,
  );
}

function otherScreen(overrides: Partial<OtherProfileData> = {}) {
  return (
    <OtherProfile
      profile={otherProfile(overrides)}
      isFollowing={false}
      follow={done}
      unfollow={done}
      reportAffordance={<button type="button">Report</button>}
    />
  );
}

function followScreen(options: {
  isFollowing?: boolean;
  follow?: () => Promise<unknown>;
  unfollow?: () => Promise<unknown>;
}) {
  return (
    <OtherProfile
      profile={otherProfile()}
      isFollowing={options.isFollowing ?? false}
      follow={options.follow ?? done}
      unfollow={options.unfollow ?? done}
    />
  );
}

function results(...names: string[]): SearchResult[] {
  return names.map((username, index) => ({
    userId: `01R${String(index)}`,
    username,
    following: index === 1,
  }));
}

function searchScreen(
  found: (prefix: string) => Promise<SearchResult[]> = () =>
    Promise.resolve([]),
) {
  return (
    <RunnerSearch
      search={({ data }) => found(data.prefix)}
      follow={done}
      unfollow={done}
    />
  );
}

describe("Avatar", () => {
  it("is the runner's initial, upper-cased, and decorative", async () => {
    expect(initialOf("dana")).toBe("D");
    const { container } = await renderFeedScreen(
      <Avatar name="dana" size="large" />,
    );
    const avatar = container.querySelector('[aria-hidden="true"]');
    expect(avatar).toHaveTextContent("D");
    expect(avatar).toHaveClass("size-14", "bg-hairline");
  });

  it("comes small for a row", async () => {
    const { container } = await renderFeedScreen(
      <Avatar name="dana" size="small" />,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      "size-9",
    );
  });
});

const resend = () => Promise.resolve({ status: "sent" } as const);

describe("OwnProfile (G): an unconfirmed runner (round 26 #11; FEED-11)", () => {
  it("carries the nag at the top of You, above the identity line", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={
          <ConfirmEmailBand
            account={{
              email: "maya@example.com",
              isVerified: false,
              viewer: { homeZone: undefined },
            }}
            resend={resend}
          />
        }
        profile={ownProfile()}
      />,
    );

    expectTheColumn();
    const nag = screen.getByRole("complementary", {
      name: "Confirm your email",
    });
    expect(nag.parentElement?.firstElementChild).toBe(nag);
    expect(nag.compareDocumentPosition(part("header") ?? nag)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      within(nag).getByRole("button", { name: "Resend link" }),
    ).toBeVisible();
  });

  it("carries none once the address is confirmed", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={
          <ConfirmEmailBand
            account={{
              email: "maya@example.com",
              isVerified: true,
              viewer: { homeZone: undefined },
            }}
            resend={resend}
          />
        }
        profile={ownProfile()}
      />,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("OwnProfile (G): day one", () => {
  it("shows its counts at zero, never hidden, in ink (R55·209d)", async () => {
    await renderFeedScreen(
      <OwnProfile confirmBand={undefined} profile={ownProfile()} />,
    );

    expect(part("counts")?.textContent).toBe(
      "0 Runs\u{A0}· 0 Following\u{A0}· 0 Followers",
    );
    expect(part("counts")).toHaveClass("text-ink");
    expect(part("counts")).not.toHaveClass("text-muted");
  });

  it("counts one in the singular (R55·209b)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          followingCount: 1,
          followerCount: 1,
        })}
      />,
    );
    expect(part("counts")?.textContent).toBe(
      "1 Run\u{A0}· 1 Following\u{A0}· 1 Follower",
    );
  });
  it("offers one next step: [ NO RUNS YET ], a line, Log a run — and Settings", async () => {
    await renderFeedScreen(
      <OwnProfile confirmBand={undefined} profile={ownProfile()} />,
    );

    expect(part("entries")).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("No runs yet")).toBeVisible();
    expect(
      screen.getByText(
        "Your runs land here once you log one. Shared runs are what other people see.",
      ),
    ).toBeVisible();
    const log = screen.getByRole("link", { name: "Log a run" });
    expect(log).toHaveAttribute("href", "/runs/new");
    expect(log).toHaveClass("bg-action");
    // Round 26 #18: the icon button in every state, and day one keeps its
    // inline link as well.
    const settings = screen.getAllByRole("link", { name: "Settings" });
    expect(settings).toHaveLength(2);
    for (const link of settings) {
      expect(link).toHaveAttribute("href", "/onboarding/settings");
    }
    const [icon, inline] = settings;
    expect(icon).toHaveAttribute("data-part", "settings-button");
    expect(inline).not.toHaveAttribute("data-part");
  });

  it("names the runner, or You, and shows a city only when O1 got one", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ username: undefined })}
      />,
    );
    expect(screen.getByRole("heading", { name: "You" })).toBeVisible();
    // The one counts line, and no city line.
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(1);
    // The avatar's initial falls back to "You", same as the heading.
    expect(
      part("header")?.querySelector('[aria-hidden="true"]'),
    ).toHaveTextContent("Y");
  });
  it("shows the city in mono under the name", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ cityLabel: "Portland" })}
      />,
    );
    expect(screen.getByText("Portland")).toHaveClass("font-mono");
  });
});

describe("OwnProfile (G): past day one", () => {
  const band = {
    bandFloorC: 5,
    label: "41–50°",
    said: "41 to 50 degrees",
    cold: 1,
    dialed: 2,
    warm: 0,
  };

  it("keeps the way to Settings, the only place to sign out, as the icon alone", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 12 })}
      />,
    );

    // Round 26 #18: "The established G has the icon only."
    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings).toHaveAttribute("href", "/onboarding/settings");
    expect(settings).toHaveAttribute("data-part", "settings-button");
    expect(part("header")).toContainElement(settings);
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(settings).toHaveTextContent("");
  });

  it("drops the next step and shows the counts it has", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 12,
          followingCount: 3,
          followerCount: 4,
        })}
      />,
    );

    expect(part("counts")?.textContent).toBe(
      "12 Runs\u{A0}· 3 Following\u{A0}· 4 Followers",
    );
    expect(screen.queryByText("No runs yet")).toBeNull();
    expect(part("next-step")).toBeNull();
  });
  it("draws each section only once there is something in it", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 1 })}
      />,
    );
    expect(screen.queryByText("How you call it, by band")).toBeNull();
    expect(screen.queryByText("Most worn")).toBeNull();
    expect(screen.queryByText("Recent entries")).toBeNull();
    // No bands, so nothing of Visual Crossing's to credit (D-144).
    expect(queryWeatherCredit(document.body)).toBeNull();
  });

  it("names how each band was called", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 3, coverage: [band] })}
      />,
    );
    const row = screen.getByText("Dialed").closest("li");
    expect(drawnText(row)).toBe("[41–50°]Dialed3 runs");
    // Round 53 · 162.3: the band is said as a range, its brackets not at all.
    expect(saidText(row)).toBe("41 to 50 degreesDialed3 runs");
    // R55·209a, e: the word bold, and the count beside it, not pushed away.
    const word = screen.getByText("Dialed");
    expect(word).toHaveClass("font-semibold");
    expect(word).not.toHaveClass("flex-1");
    expect(word.nextElementSibling).toHaveTextContent("3 runs");
  });

  it("counts a band of one run in the singular (R55·209b)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          coverage: [{ ...band, cold: 0, dialed: 1, warm: 0 }],
        })}
      />,
    );
    expect(screen.getByText("Dialed").closest("li")).toHaveTextContent(
      /1 run$/u,
    );
  });

  it("credits Visual Crossing directly under the bands, which are feels-like bands (D-144)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 3, coverage: [band] })}
      />,
    );
    const section = screen.getByText("Dialed").closest("ul")?.parentElement;
    if (section === null || section === undefined) throw new Error("no bands");
    const credit = queryWeatherCredit(document.body);
    expect(credit).not.toBeNull();
    expect(section.nextElementSibling).toBe(credit);
  });

  it("counts every run in a band, whichever way it went", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 4,
          coverage: [{ ...band, cold: 1, dialed: 2, warm: 1 }],
        })}
      />,
    );
    expect(screen.getByText("Dialed").closest("li")).toHaveTextContent(
      "4 runs",
    );
  });

  it("names a band called cold as under-dressed and warm as over-dressed", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 3,
          coverage: [
            { ...band, cold: 3, dialed: 0 },
            { ...band, bandFloorC: 10, cold: 0, dialed: 0, warm: 2 },
          ],
        })}
      />,
    );
    expect(screen.getByText("Under-dressed")).toBeVisible();
    expect(screen.getByText("Over-dressed")).toBeVisible();
  });

  it("lists the most-worn pieces by brand and model, their count in runs (R55·209c)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 2,
          mostWornItems: [
            { itemId: "01A", name: "Patagonia Houdini", wearCount: 4 },
            { itemId: "01B", name: "Balega Hidden Comfort", wearCount: 1 },
          ],
        })}
      />,
    );
    const worn = screen.getByText("Patagonia Houdini").closest("li");
    expect(worn).toHaveTextContent("Patagonia Houdini[4 runs]");
    expect(
      screen.getByText("Balega Hidden Comfort").closest("li"),
    ).toHaveTextContent("[1 run]");
    // Drawn, not said: a screen reader hears "4 runs", never "left bracket".
    expect(
      [...(worn?.querySelectorAll("[aria-hidden='true']") ?? [])].map(
        (mark) => mark.textContent,
      ),
    ).toStrictEqual(["[", "]"]);
  });

  it("draws each recent entry as R55·210's run row: the date the link, one line under it", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 2,
          recentEntries: [
            recent({
              verdict: -1,
              conditions: pointConditions({
                tempC: 5,
                feelsLikeC: 3,
                condition: "Overcast",
              }),
            }),
            recent({ entryId: "01F", day: "Thu, Aug 27", distanceM: 8046.72 }),
          ],
        })}
      />,
    );
    const latest = screen.getByRole("link", { name: "Sat, Aug 29" });
    expect(latest).toHaveAttribute("href", "/feed/entry/01E");
    expect(latest).toHaveClass(
      "text-body",
      "font-semibold",
      "underline",
      "self-start",
    );
    const row = recentRow("01E");
    expect(row).toHaveAttribute("data-part", "run-row");
    expect(row).toHaveClass(
      "flex",
      "flex-col",
      "min-h-15",
      "justify-center",
      "gap-1",
      "py-2",
      "border-b",
      "border-hairline",
    );
    const meta = row.querySelector('[data-part="run-meta"]');
    expect(latest).not.toContainElement(meta as HTMLElement);
    // Drawn with each "·" bound to what follows (R55·204), said in words.
    expect(drawnText(meta)).toBe(
      "41° · Overcast\u{A0}· A bit cold\u{A0}· 8.2 mi",
    );
    expect(saidText(meta)).toBe(
      "41 degrees, Overcast\u{A0}· A bit cold\u{A0}· 8.2 miles",
    );
    expect(meta?.firstElementChild).toHaveClass("text-mono-sm", "text-quiet");
    expect(within(row).getByText("A bit cold")).toHaveClass(
      "font-semibold",
      "text-cold-text",
    );
    // No conditions and no verdict: the distance alone, never a dash.
    expect(
      drawnText(recentRow("01F").querySelector('[data-part="run-meta"]')),
    ).toBe("5.0 mi");
    // A hairline above the first row, from the list.
    expect(row.parentElement).toHaveClass("border-t", "border-hairline");
  });

  it("wears each verdict's own hue: dialed teal, warm quiet", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 2,
          recentEntries: [
            recent({ verdict: 0 }),
            recent({ entryId: "01F", day: "Thu, Aug 27", verdict: 2 }),
          ],
        })}
      />,
    );
    expect(within(recentRow("01E")).getByText("Dialed")).toHaveClass(
      "font-semibold",
      "text-dialed-text",
    );
    expect(within(recentRow("01F")).getByText("Way warm")).toHaveClass(
      "font-semibold",
      "text-quiet",
    );
  });
  it("measures a recent entry in the runner's own units", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          units: { temp: "c", distance: "km" },
          recentEntries: [
            recent({
              conditions: pointConditions({
                tempC: 5,
                feelsLikeC: 3,
                condition: "Overcast",
              }),
            }),
          ],
        })}
      />,
    );
    expect(
      drawnText(recentRow("01E").querySelector('[data-part="run-meta"]')),
    ).toBe("5° · Overcast\u{A0}· 13.2 km");
  });

  it("says Indoor for an indoor run with no conditions", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          recentEntries: [recent({ indoor: true })],
        })}
      />,
    );
    expect(within(recentRow("01E")).getByText("Indoor")).toBeVisible();
  });

  it("ends the meta line with the card's tag on an entry under review, outside the link", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          recentEntries: [
            recent({
              underReview: true,
              conditions: pointConditions({ tempC: 5, feelsLikeC: 3 }),
            }),
          ],
        })}
      />,
    );
    // The link's name stays the date; the tag is read once.
    const link = screen.getByRole("link", { name: "Sat, Aug 29" });
    const tag = part("review-tag");
    expect(tag).toHaveTextContent("Under review, other runners can't see this");
    expect(link).not.toContainElement(tag);
    const meta = recentRow("01E").querySelector('[data-part="run-meta"]');
    expect(meta?.firstElementChild?.lastElementChild).toBe(tag);
  });
});

describe("OwnProfile (G): runs but no kit on any (R55·209f)", () => {
  const step = {
    runId: "01RUN",
    conditions: pointConditions({
      tempC: 8,
      feelsLikeC: 6,
      condition: "Clear",
    }),
  };

  it("offers one next step: the last run, and its kit to add", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 1, nextStep: step })}
      />,
    );
    const next = part("next-step");
    if (next === null) throw new Error("no next step");
    expect(next).toHaveClass("border-t", "border-hairline", "pt-4");
    expect(within(next).getByRole("heading", { name: "Next" })).toBeVisible();
    expect(
      screen.getByText(
        "Your last run has no kit yet. Add what you wore, and your closet starts learning what works at 43° and dry.",
      ),
    ).toHaveClass("text-lead");
    const add = screen.getByRole("link", { name: "Add your kit" });
    expect(add).toHaveAttribute("href", "/feed/attach/01RUN");
    expect(add).toHaveClass(
      "rounded-card",
      "bg-action",
      "font-display",
      "uppercase",
      "min-h-control",
    );
    // Then Settings, as day one has it; nothing of the empty sections.
    const settings = screen.getAllByRole("link", { name: "Settings" });
    expect(settings).toHaveLength(2);
    expect(within(next).getByRole("link", { name: "Settings" })).toBe(
      settings[1],
    );
    expect(screen.queryByText("No runs yet")).toBeNull();
    expect(screen.queryByText("Recent entries")).toBeNull();
  });

  it("says the run's own wetness and temperature, in the runner's unit", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 3,
          units: { temp: "c", distance: "km" },
          nextStep: {
            runId: "01RUN",
            conditions: { ...step.conditions, precipMm: 4 },
          },
        })}
      />,
    );
    expect(
      screen.getByText(/learning what works at 6° and wet\.$/u),
    ).toBeVisible();
  });

  it("drops the weather clause when the run has none (owner, 2026-11-14)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          nextStep: { runId: "01RUN", conditions: undefined },
        })}
      />,
    );
    expect(
      screen.getByText(
        "Your last run has no kit yet. Add what you wore, and your closet starts learning what works.",
      ),
    ).toBeVisible();
  });

  it("keeps day one for a runner with no runs, whatever else is set", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({ runCount: 0, nextStep: step })}
      />,
    );
    expect(screen.getByText("No runs yet")).toBeVisible();
    expect(part("next-step")).toBeNull();
  });
});

/**
H's empty state, its second line: the one under "No shared runs yet."
*/
function emptyLine(): Element | undefined {
  return part("entries")?.children[1];
}

describe("OtherProfile (H)", () => {
  it("keeps its header and Follow with nothing public, and says so plainly", async () => {
    await renderFeedScreen(otherScreen());

    expectTheColumn();
    expect(screen.getByRole("heading", { name: "@ravi_k" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
    expect(part("entries")).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("No shared runs yet.")).toBeVisible();
    expect(
      screen.getByText(
        "Follow @ravi_k and their shared runs will show in your feed.",
      ),
    ).toBeVisible();
    // Their silence, not a next step: no brackets.
    expect(part("entries")?.textContent).not.toMatch(/\[/u);
  });

  it("stops asking for a follow once they are followed, and asks again after an unfollow", async () => {
    // #590: the line turns with the pill, on the server's answer and not
    // before it, and it is said by nothing but itself.
    const user = userEvent.setup();
    const answer = Promise.withResolvers<undefined>();
    await renderFeedScreen(followScreen({ follow: () => answer.promise }));
    const ask = "Follow @ravi_k and their shared runs will show in your feed.";
    const followed = "Their shared runs will show in your feed.";

    await user.click(screen.getByRole("button", { name: "Follow" }));
    expect(emptyLine()).toHaveTextContent(ask, { normalizeWhitespace: false });

    answer.resolve(undefined);
    await waitFor(() => {
      expect(emptyLine()?.textContent).toBe(followed);
    });
    expect(screen.getByText("No shared runs yet.")).toBeVisible();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(emptyLine()?.closest("[aria-live], [role='status']")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => {
      expect(emptyLine()?.textContent).toBe(ask);
    });
  });

  it("opens on the followed line for a runner already followed", async () => {
    await renderFeedScreen(followScreen({ isFollowing: true }));

    expect(emptyLine()?.textContent).toBe(
      "Their shared runs will show in your feed.",
    );
  });

  it("shows no counts — a stranger's follower count is a status number", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("counts")).toBeNull();
  });

  it("puts Report at the foot, after what is there — nothing, here", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("entries")?.lastElementChild).toBe(part("report"));
    expect(
      within(part("report") ?? document.body).getByRole("button"),
    ).toHaveTextContent("Report");
  });

  it("falls back to A runner and shows a city only when there is one", async () => {
    await renderFeedScreen(
      otherScreen({ username: NOTHING, cityLabel: "St. Paul" }),
    );
    expect(screen.getByRole("heading", { name: "A runner" })).toBeVisible();
    expect(screen.getByText("St. Paul")).toHaveClass("font-mono");
  });

  it("says every verdict an entry has in its hue, not only dialed", async () => {
    await renderFeedScreen(
      otherScreen({
        recentPublicEntries: [
          {
            entryId: "01A",
            day: "Tue, Aug 12",
            verdict: -1,
            distanceM: 5000,
            indoor: false,
            conditions: undefined,
          },
        ],
      }),
    );
    expect(within(recentRow("01A")).getByText("A bit cold")).toHaveClass(
      "text-cold-text",
    );
  });

  it("draws no city line, not an empty one, when there is no city", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(0);
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(otherScreen());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("lists public entries in G's run row: conditions, verdict, distance (R55·210)", async () => {
    await renderFeedScreen(
      otherScreen({
        units: { temp: "c", distance: "km" },
        recentPublicEntries: [
          {
            entryId: "01A",
            day: "Tue, Aug 12",
            verdict: 0,
            distanceM: 5000,
            indoor: false,
            conditions: pointConditions({
              tempC: 5,
              feelsLikeC: 3,
              condition: "Rain",
            }),
          },
          {
            entryId: "01B",
            // The day as the server dated it, in the run's own zone: the
            // screen prints it and computes none of its own.
            day: "Wed, Aug 13",
            verdict: NOTHING,
            distanceM: 8000,
            indoor: true,
            conditions: undefined,
          },
        ],
      }),
    );

    const first = screen.getByRole("link", { name: "Tue, Aug 12" });
    expect(first).toHaveAttribute("href", "/feed/entry/01A");
    expect(
      drawnText(recentRow("01A").querySelector('[data-part="run-meta"]')),
    ).toBe("5° · Rain\u{A0}· Dialed\u{A0}· 5.0 km");
    // No verdict: none said; indoors says so; in the viewer's own units.
    expect(screen.getByRole("link", { name: "Wed, Aug 13" })).toHaveAttribute(
      "href",
      "/feed/entry/01B",
    );
    expect(
      drawnText(recentRow("01B").querySelector('[data-part="run-meta"]')),
    ).toBe("Indoor\u{A0}· 8.0 km");
    // Ruled from a hairline above the first, and Report still closes it.
    expect(recentRow("01A").parentElement).toHaveClass(
      "border-t",
      "border-hairline",
    );
    expect(recentRow("01A").parentElement).not.toHaveClass("gap-2");
    expect(part("entries")?.lastElementChild).toBe(part("report"));
  });

  it("goes back to the feed", async () => {
    // Under /feed, where the router would call a prefix match current.
    await renderFeedScreen(otherScreen(), "/feed/u/maya_runs");
    const back = screen.getByRole("link", { name: "Back to feed" });
    expect(back).toHaveAttribute("href", "/feed");
    expect(back).not.toHaveAttribute("aria-current");
  });
});

describe("Follow, on the control-failure pattern", () => {
  it("is the pink primary until followed, then a hairline", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(done);
    await renderFeedScreen(followScreen({ follow }));
    const button = screen.getByRole("button", { name: "Follow" });
    expect(button).toHaveClass("bg-action");
    expect(button.querySelector(".sr-only")).toBeNull();

    await user.click(button);

    expect(follow).toHaveBeenCalledWith({ data: { userId: "01RAVI" } });
    await waitFor(() => {
      expect(button).toHaveAccessibleName("Following");
    });
    // The outline pill is 1px --ink (R48·134): a hairline all but
    // vanished on dark (E1-16b).
    expect(button).toHaveClass("border-ink");
    expect(button).not.toHaveClass("bg-action");
  });

  it("keeps the handle in a row's pill in all four states", async () => {
    // Round 52 #157: all four states on a row, "Following @ana" while a
    // follow is out and "Unfollowing @ana" while one is taken back. H's
    // header keeps the bare words, because its h1 names the runner.
    const user = userEvent.setup();
    const out = Promise.withResolvers<undefined>();
    const back = Promise.withResolvers<undefined>();
    await renderFeedScreen(
      <RunnerSearch
        search={() => Promise.resolve(results("ana"))}
        follow={() => out.promise}
        unfollow={() => back.promise}
      />,
    );
    await user.type(screen.getByLabelText("Search by name"), "A");
    const pill = await screen.findByRole("button", { name: "Follow @ana" });

    await user.click(pill);
    expect(pill).toHaveAttribute("aria-busy", "true");
    expect(pill).toHaveAccessibleName("Following @ana");
    out.resolve(undefined);
    await waitFor(() => {
      expect(pill).not.toHaveAttribute("aria-busy");
    });
    expect(pill).toHaveAccessibleName("Following @ana");

    await user.click(pill);
    expect(pill).toHaveAccessibleName("Unfollowing @ana");
    back.resolve(undefined);
    await waitFor(() => {
      expect(pill).toHaveAccessibleName("Follow @ana");
    });
  });

  it("waits behind [ Following ] without flipping first", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderFeedScreen(followScreen({ follow: () => pending.promise }));
    const button = screen.getByRole("button", { name: "Follow" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("bg-action");
    expect(within(button).getByText("Following")).toBeVisible();
    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("says [ Unfollowing ] while it takes a follow back", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    await renderFeedScreen(
      followScreen({ isFollowing: true, unfollow: () => pending.promise }),
    );
    const button = screen.getByRole("button", { name: "Following" });

    await user.click(button);

    expect(within(button).getByText("Unfollowing")).toBeVisible();
    pending.resolve(undefined);
    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("unfollows behind [ Unfollowing ], calling the other endpoint", async () => {
    const user = userEvent.setup();
    const follow = vi.fn(done);
    const unfollow = vi.fn(done);
    await renderFeedScreen(
      followScreen({ isFollowing: true, follow, unfollow }),
    );
    const button = screen.getByRole("button", { name: "Following" });

    await user.click(button);

    await waitFor(() => {
      expect(button).toHaveAccessibleName("Follow");
    });
    expect(unfollow).toHaveBeenCalledWith({ data: { userId: "01RAVI" } });
    expect(follow).not.toHaveBeenCalled();
  });

  it("says NOT FOLLOWING under it when following fails, and keeps the label", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      followScreen({ follow: () => Promise.reject(new TypeError("offline")) }),
    );

    await user.click(screen.getByRole("button", { name: "Follow" }));

    expect(await screen.findByText("Not following")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not following. Your connection dropped.",
    );
    expect(screen.getByRole("button", { name: "Follow" })).toBeVisible();
  });

  it("says STILL FOLLOWING when unfollowing fails", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      followScreen({
        isFollowing: true,
        unfollow: () => Promise.reject(new Error("D1 went away")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Following" }));

    expect(await screen.findByText("Still following")).toBeVisible();
    expect(screen.getByText("Our end failed.")).toBeVisible();
  });
});

describe("RunnerSearch", () => {
  it("says nothing at rest, and lists nothing", async () => {
    await renderFeedScreen(searchScreen());
    expectTheColumn();
    expect(screen.queryByText(/No runner called/u)).toBeNull();
    // Not even an empty list, which a reader hears as "list, 0 items".
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("searches on what is typed, trimmed, and lists avatar, name and a Follow pill", async () => {
    const user = userEvent.setup();
    const found = vi.fn(() => Promise.resolve(results("ana", "andy")));
    await renderFeedScreen(searchScreen(found));

    await user.type(screen.getByLabelText("Search by name"), " An");

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
    expect(found).toHaveBeenLastCalledWith("An");
    const [ana, andy] = screen.getAllByRole("listitem");
    expect(
      within(ana ?? document.body).getByRole("link", { name: "@ana" }),
    ).toHaveAttribute("href", "/feed/u/ana");
    // Round 52 #157: on a row the pill says whose it is, behind the
    // visible word; the row still draws the handle once.
    const anaPill = within(ana ?? document.body).getByRole("button", {
      name: "Follow @ana",
    });
    expect(anaPill).toBeVisible();
    expect(anaPill.lastElementChild).toHaveClass("sr-only");
    expect(anaPill.lastElementChild?.textContent).toBe(" @ana");
    // Each row knows whether the viewer already follows them.
    expect(
      within(andy ?? document.body).getByRole("button", {
        name: "Following @andy",
      }),
    ).toBeVisible();
    expect(ana).toHaveTextContent(/^A@anaFollow.* @ana$/u);
  });

  it("breathes its trailing label while a search is out, and only then", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(searchScreen(() => pending.promise));
    // Absent at rest, so it holds no width that would end the input short
    // of the field's edge (E2-05).
    expect(screen.queryByText("Searching", { selector: "span" })).toBeNull();

    await user.type(screen.getByLabelText("Search by name"), "A");
    const label = screen.getByText("Searching", { selector: "span" });
    expect(label.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(label.querySelectorAll(".breathe")).toHaveLength(2);

    pending.resolve([]);
    await waitFor(() => {
      expect(screen.queryByText("Searching", { selector: "span" })).toBeNull();
    });
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(searchScreen());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("stops breathing when the box is cleared mid-search", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(searchScreen(() => pending.promise));
    const box = screen.getByLabelText("Search by name");
    await user.type(box, "A");
    expect(screen.getByText("Searching", { selector: "span" })).toBeVisible();
    await user.clear(box);

    expect(screen.queryByText("Searching", { selector: "span" })).toBeNull();
    pending.resolve([]);
  });

  it("drops a slower failure to an older prefix", async () => {
    const user = userEvent.setup();
    const slow = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(
      searchScreen((prefix) =>
        prefix === "A" ? slow.promise : Promise.resolve(results("ana")),
      ),
    );

    await user.type(screen.getByLabelText("Search by name"), "An");
    await screen.findByRole("link", { name: "@ana" });
    slow.reject(new TypeError("offline"));

    await waitFor(() => {
      expect(screen.queryByText("Didn't load")).toBeNull();
    });
    expect(screen.getByRole("link", { name: "@ana" })).toBeVisible();
  });

  it("does not say No runner called over a search that then failed", async () => {
    const user = userEvent.setup();
    const found = vi
      .fn<(prefix: string) => Promise<SearchResult[]>>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new TypeError("offline"));
    await renderFeedScreen(searchScreen(found));
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "z");
    expect(
      await screen.findByText("No runner called @z.", { selector: "p" }),
    ).toBeVisible();
    await user.type(box, "e");

    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();
  });

  it("does not say No runner called when there are runners", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(searchScreen(() => Promise.resolve(results("ana"))));

    await user.type(screen.getByLabelText("Search by name"), "A");

    expect(await screen.findByRole("link", { name: "@ana" })).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();
  });

  it("says No runner called @x once a search has come back empty", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(searchScreen());

    await user.type(screen.getByLabelText("Search by name"), "zed ");

    expect(
      await screen.findByText("No runner called @zed.", { selector: "p" }),
    ).toBeVisible();
    // Said in the region too: the sentence lands under the field, away
    // from where a reader is typing.
    expect(screen.getByRole("status")).toHaveTextContent(
      /^No runner called @zed\.$/u,
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("says Searching in its region while a search is out, then how many it found", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(searchScreen(() => pending.promise));

    await user.type(screen.getByLabelText("Search by name"), "A");
    expect(screen.getByRole("status")).toHaveTextContent(/^Searching$/u);

    pending.resolve(results("ana", "andy"));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /^2 runners found\.$/u,
      );
    });
  });

  it("says one runner in the singular", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(searchScreen(() => Promise.resolve(results("ana"))));

    await user.type(screen.getByLabelText("Search by name"), "A");

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /^1 runner found\.$/u,
      );
    });
  });

  it("goes quiet in its region when the box is cleared, or the search fails", async () => {
    const user = userEvent.setup();
    const found = vi
      .fn<(prefix: string) => Promise<SearchResult[]>>()
      .mockResolvedValueOnce(results("ana"))
      .mockRejectedValueOnce(new TypeError("offline"));
    await renderFeedScreen(searchScreen(found));
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "A");
    await screen.findByRole("listitem");
    await user.clear(box);
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);

    await user.type(box, "B");
    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);
  });

  it("goes quiet again when the box is cleared, whitespace and all", async () => {
    const user = userEvent.setup();
    const found = vi.fn(() => Promise.resolve(results("ana")));
    await renderFeedScreen(searchScreen(found));
    const box = screen.getByLabelText("Search by name");

    await user.type(box, "A");
    await screen.findByRole("listitem");
    await user.clear(box);
    await user.type(box, "  ");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText(/No runner called/u)).toBeNull();
    expect(found).toHaveBeenCalledTimes(1);
  });

  it("drops a slower answer to an older prefix", async () => {
    const user = userEvent.setup();
    const slow = Promise.withResolvers<SearchResult[]>();
    await renderFeedScreen(
      searchScreen((prefix) =>
        prefix === "A" ? slow.promise : Promise.resolve(results("ana")),
      ),
    );

    await user.type(screen.getByLabelText("Search by name"), "An");
    await screen.findByRole("link", { name: "@ana" });
    slow.resolve(results("Old answer"));

    await waitFor(() => {
      expect(screen.queryByText("Old answer")).toBeNull();
    });
    expect(screen.getByRole("link", { name: "@ana" })).toBeVisible();
  });

  it("says Didn't load when the search fails, and tries the same one again", async () => {
    const user = userEvent.setup();
    const found = vi
      .fn<(prefix: string) => Promise<SearchResult[]>>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(results("ana"));
    await renderFeedScreen(searchScreen(found));

    await user.type(screen.getByLabelText("Search by name"), "A");
    expect(await screen.findByText("Didn't load")).toBeVisible();
    expect(screen.queryByText(/No runner called/u)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("link", { name: "@ana" })).toBeVisible();
    expect(found).toHaveBeenLastCalledWith("A");
    expect(screen.queryByText("Didn't load")).toBeNull();
  });

  it("puts a failed follow's band under the whole row", async () => {
    const user = userEvent.setup();
    await renderFeedScreen(
      <RunnerSearch
        search={() => Promise.resolve(results("ana"))}
        follow={() => Promise.reject(new TypeError("offline"))}
        unfollow={done}
      />,
    );
    await user.type(screen.getByLabelText("Search by name"), "A");
    await user.click(
      await screen.findByRole("button", { name: "Follow @ana" }),
    );

    const band = await screen.findByText("Not following");
    const row = screen.getByRole("listitem");
    expect(row).toContainElement(band);
    expect(row.lastElementChild).toContainElement(band);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not following. Your connection dropped.",
    );
  });
});

describe("the phone's bell on the profiles and search (Design 169.1)", () => {
  it("ends You's identity row, after Settings", async () => {
    await renderFeedScreen(
      withBell(<OwnProfile profile={ownProfile()} confirmBand={undefined} />),
    );
    expectBellEnding(screen.getByRole("heading", { name: "@dana_kim" }));
  });

  it("ends another runner's back row", async () => {
    await renderFeedScreen(withBell(otherScreen()));
    expectBellEnding(screen.getByRole("link", { name: "Back to feed" }));
  });

  it("ends search's title row", async () => {
    await renderFeedScreen(withBell(searchScreen()));
    expectBellEnding(screen.getByRole("heading", { name: "Find a runner" }));
  });
});
