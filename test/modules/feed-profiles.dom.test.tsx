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
  it("shows its counts at zero, never hidden", async () => {
    await renderFeedScreen(
      <OwnProfile confirmBand={undefined} profile={ownProfile()} />,
    );

    expect(part("counts")).toHaveTextContent("0 Runs0 Following0 Followers");
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
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(3);
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

    expect(part("counts")).toHaveTextContent("12 Runs3 Following4 Followers");
    expect(screen.queryByText("No runs yet")).toBeNull();
    expect(screen.getByText("12")).toHaveClass("text-ink");
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

  it("lists the most-worn pieces, and names each recent entry by its day and distance (round 35 #53b)", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 2,
          mostWornItems: [{ itemId: "01A", name: "Houdini", wearCount: 4 }],
          recentEntries: [
            recent(),
            recent({
              entryId: "01F",
              day: "Thu, Aug 27",
              distanceM: 8046.72,
            }),
          ],
        })}
      />,
    );
    const worn = screen.getByText("Houdini").closest("li");
    expect(worn).toHaveTextContent("Houdini[4]");
    // Drawn, not said: a screen reader hears "4", never "left bracket".
    expect(
      [...(worn?.querySelectorAll("[aria-hidden='true']") ?? [])].map(
        (mark) => mark.textContent,
      ),
    ).toStrictEqual(["[", "]"]);
    const latest = screen.getByRole("link", {
      name: "Sat, Aug 29, 8.2 miles",
    });
    expect(latest).toHaveAttribute("href", "/feed/entry/01E");
    // Drawn as before, said in words (round 52 #158).
    expect(within(latest).getByText("Sat, Aug 29 · 8.2 mi")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByRole("link", { name: "Thu, Aug 27, 5.0 miles" }),
    ).toHaveAttribute("href", "/feed/entry/01F");
    // No tag and no conditions: no meta line at all, never an empty one.
    expect(part("entry-meta")).toBeNull();
    expect(document.querySelector('[data-part="review-tag"]')).toBeNull();
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
      screen.getByRole("link", { name: "Sat, Aug 29, 13.2 kilometres" }),
    ).toBeVisible();
    expect(part("entry-meta")).toHaveTextContent("5° · Overcast");
  });

  it("puts the conditions on the meta line, outside the link", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
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
    const link = screen.getByRole("link", { name: "Sat, Aug 29, 8.2 miles" });
    const meta = part("entry-meta");
    expect(meta).toHaveTextContent("41° · Overcast");
    expect(link.nextElementSibling).toBe(meta);
    expect(link).not.toContainElement(meta);
  });

  it("carries the tag alone on the meta line when there are no conditions", async () => {
    await renderFeedScreen(
      <OwnProfile
        confirmBand={undefined}
        profile={ownProfile({
          runCount: 1,
          recentEntries: [recent({ underReview: true })],
        })}
      />,
    );
    expect(part("entry-meta")?.children).toHaveLength(1);
    expect(part("entry-meta")?.firstElementChild).toBe(part("review-tag"));
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

  it("marks a recent entry under review with the card's tag, first on the meta line and outside the link (round 35 #53b)", async () => {
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
    // The link's name stays the entry's label; the tag is read once.
    const link = screen.getByRole("link", { name: "Sat, Aug 29, 8.2 miles" });
    expect(link).toHaveAttribute("href", "/feed/entry/01E");
    const tag = part("review-tag");
    expect(tag).toHaveTextContent("Under review, other runners can't see this");
    expect(link).not.toContainElement(tag);
    const meta = part("entry-meta");
    expect(meta?.firstElementChild).toBe(tag);
    expect(meta).toHaveTextContent("41° · clear");
    expect(link.nextElementSibling).toBe(meta);
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

  it("badges every verdict an entry has, not only dialed", async () => {
    await renderFeedScreen(
      otherScreen({
        recentPublicEntries: [
          {
            entryId: "01A",
            day: "Tue Aug 12",
            verdict: -1,
          },
        ],
      }),
    );
    expect(part("verdict-badge")).toHaveTextContent("A bit cold");
  });

  it("draws no city line, not an empty one, when there is no city", async () => {
    await renderFeedScreen(otherScreen());
    expect(part("header")?.querySelectorAll(".font-mono")).toHaveLength(0);
  });

  it("says nothing in its status region until something happens", async () => {
    await renderFeedScreen(otherScreen());
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("lists public entries by date, with the verdict each has (no caption, D-167)", async () => {
    await renderFeedScreen(
      otherScreen({
        recentPublicEntries: [
          {
            entryId: "01A",
            day: "Tue Aug 12",
            verdict: 0,
          },
          {
            entryId: "01B",
            // The day as the server dated it, in the run's own zone: the
            // screen prints it and computes none of its own.
            day: "Wed Aug 13",
            verdict: NOTHING,
          },
        ],
      }),
    );

    const first = screen.getByRole("link", { name: /Tue Aug 12/u });
    const second = screen.getByRole("link", { name: /Wed Aug 13/u });
    expect(first).toHaveAttribute("href", "/feed/entry/01A");
    expect(first).toHaveTextContent(/^Tue Aug 12Dialed$/u);
    // No verdict, no badge.
    expect(second).toHaveAttribute("href", "/feed/entry/01B");
    expect(second).toHaveTextContent(/^Wed Aug 13$/u);
    expect(second.children).toHaveLength(1);
    // And Report still closes the list.
    expect(part("entries")?.lastElementChild).toBe(part("report"));
    expect(screen.getByText("Tue Aug 12")).toHaveClass("font-mono");
    expect(screen.getByText("Wed Aug 13")).toHaveClass("font-mono");
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
