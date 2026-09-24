import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EntryDetail } from "../../src/modules/feed/components/EntryDetail";
import { Feed } from "../../src/modules/feed/components/Feed";
import { OtherProfile } from "../../src/modules/feed/components/OtherProfile";
import { feedItem, firstPaintOf, MILES, NOW } from "./feed-fixtures";

/**
 * A screen's one status region says nothing in the page the server sends
 * (Accessibility Contract rule 08: announce what happened, never on
 * arrival). Read from first paint because every control on these screens
 * reports into the region on mount, which would hide a region that started
 * out saying something.
 */
const NOTHING = z.null().parse(JSON.parse("null"));
const done = () => Promise.resolve();
const EMPTY_REGION = /<div role="status"[^>]*><\/div>/u;

describe("the status region on first paint", () => {
  it("is empty on Following", async () => {
    const html = await firstPaintOf(
      <Feed
        items={[feedItem()]}
        followeeCount={1}
        now={NOW}
        units={MILES}
        unjudgedCount={0}
        toggleUseful={() => Promise.resolve({ useful: true })}
        conditions={{
          home: { coords: undefined, cityLabel: undefined },
          locate: () => Promise.resolve(undefined),
          conditionsFor: () => Promise.resolve(undefined),
          saveCity: () => Promise.resolve({ lat: 1, lng: 2 }),
        }}
      />,
    );
    expect(html).toMatch(EMPTY_REGION);
  });

  it("is empty on D", async () => {
    const html = await firstPaintOf(
      <EntryDetail
        units={MILES}
        viewerId="01STRANGER"
        shouldPromptVerdict={false}
        recordPrompted={done}
        toggleUseful={() => Promise.resolve({ useful: true })}
        entry={{
          id: "01ENTRY",
          userId: "01USER",
          authorDisplayName: "mark_t",
          runId: "01RUN",
          runTitle: "Run",
          distanceM: 8047,
          durationS: 2600,
          startedAt: NOW,
          indoor: false,
          verdict: undefined,
          isPublic: true,
          caption: undefined,
          createdAt: NOW,
          items: [],
          photoKeys: [],
          tags: [],
          usefulCount: 0,
          conditions: undefined,
          viewerHasReacted: false,
        }}
      />,
    );
    expect(html).toMatch(EMPTY_REGION);
  });

  it("is empty on H", async () => {
    const html = await firstPaintOf(
      <OtherProfile
        profile={{
          userId: "01RAVI",
          displayName: "Ravi K",
          cityLabel: NOTHING,
          recentPublicEntries: [],
        }}
        isFollowing={false}
        follow={done}
        unfollow={done}
      />,
    );
    expect(html).toMatch(EMPTY_REGION);
  });
});
