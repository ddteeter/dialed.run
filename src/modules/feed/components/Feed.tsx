import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { FormStatus, Mono } from "../../../ui";
import type { ConsensusResult } from "../consensus";
import type { FeedItem } from "../feed";
import type { ConditionsHome } from "../home";
import { isBacklogWorthOpening } from "../route-decisions";
import { BracketHeadline } from "./BracketHeadline";
import { ConditionsTab } from "./ConditionsTab";
import { PostCard } from "./PostCard";
import type { ToggleUsefulFn } from "./useful-reaction";

type FeedTab = "following" | "conditions";

/**
 * Which tab the feed opens on (round 22): *"Zero follows lands on Your
 * conditions."* It is the one social surface that works on day one. Once
 * a runner follows anyone, Following is the default — even when it is
 * quiet, because an empty Following is a state they chose to be in.
 */
export function defaultFeedTab(followeeCount: number): FeedTab {
  return followeeCount === 0 ? "conditions" : "following";
}

/**
 * The tab's own mark when chosen: Following wears the action pink, Your
 * conditions the teal that means "matched" (round 22's E1/E2 frames).
 */
const ACTIVE_TAB: Readonly<Record<FeedTab, string>> = {
  following: "border-action",
  conditions: "border-teal",
};

const TAB_LABEL: Readonly<Record<FeedTab, string>> = {
  following: "Following",
  conditions: "Your conditions",
};

/**
 * The feed (screens E1 and E2-lite), and the two tabs it switches between.
 */
export interface FeedProps {
  items: FeedItem[];
  followeeCount: number;
  /**
  The loader's clock, so the server and the browser say the same "2h ago".
  */
  now: number;
  /**
  The viewer's own units — every number on this screen is theirs.
  */
  units: Units;
  /**
  How many runs are waiting on a verdict, which is what decides whether
  the queue is worth a link at all.
  */
  unjudgedCount: number;
  toggleUseful: ToggleUsefulFn;
  /**
  Everything Your conditions needs, handed through untouched.
  */
  conditions: {
    home: ConditionsHome;
    locate: () => Promise<{ lat: number; lng: number } | undefined>;
    conditionsFor: (input: {
      data: { lat: number; lng: number };
    }) => Promise<ConsensusResult | undefined>;
    saveCity: (input: {
      data: { cityLabel: string };
    }) => Promise<{ lat: number; lng: number }>;
  };
}

export function Feed(props: Readonly<FeedProps>) {
  const {
    items,
    followeeCount,
    now,
    units,
    unjudgedCount,
    toggleUseful,
    conditions,
  } = props;
  // The runner's own choice wins; until they make one, the default follows
  // the data. Held as a choice rather than as the tab, because a loader
  // can refresh under a mounted screen — a stale page first, the fresh one
  // after — and a tab fixed at first render would keep the stale answer.
  const [chosen, setTab] = useState<FeedTab | undefined>();
  const tab = chosen ?? defaultFeedTab(followeeCount);

  return (
    // `mx-auto` below 720 only, for DS3's reason: a reflowed column is
    // "left-aligned inside the page measure, not centred, so it lines up
    // with the wide screens' primary column".
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0 wide:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-title uppercase">Feed</h1>
        <Link
          to="/feed/search"
          className="target inline-flex items-center text-body font-semibold text-cold-text"
        >
          Find runners
        </Link>
      </div>
      {isBacklogWorthOpening(unjudgedCount) ? (
        // DS2's own entry point — "reached from 'Clear the queue ›' on X".
        // Below two runs there is no queue to clear: the S1 prompt opens
        // A3 in the panel, like the phone.
        <Link
          to="/runs/backlog"
          className="target flex items-center justify-between gap-3 rounded-none bg-tint px-4 py-3 text-body text-ink no-underline"
        >
          <span>
            <Mono step="sm">{unjudgedCount}</Mono> runs still need a verdict
          </span>
          <span className="font-semibold text-cold-text">
            Clear the queue &rsaquo;
          </span>
        </Link>
      ) : undefined}
      {/* `gap-2`, not `gap-1`: rule 03's other half is 8px between
          adjacent hit areas, and these two are now 44 tall and touching. */}
      <div
        data-part="feed-tabs"
        className="flex gap-2 border-b border-hairline"
      >
        {(["following", "conditions"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
            }}
            aria-current={tab === value ? "page" : undefined}
            // The 90ms colour flip is the tab switch's other half
            // (design/motion.js). The indicator itself does not slide
            // here: these two labels are different widths, so a sliding
            // rule needs either equal columns or a runtime measurement,
            // and the first is a composition change — queued as a design
            // delta rather than invented.
            className={
              tab === value
                ? `tab-label target border-b-2 ${ACTIVE_TAB[value]} px-3 py-2 font-semibold`
                : "tab-label target px-3 py-2 text-label"
            }
          >
            {TAB_LABEL[value]}
          </button>
        ))}
      </div>
      {tab === "following" ? (
        <FollowingTab
          items={items}
          followeeCount={followeeCount}
          now={now}
          units={units}
          toggleUseful={toggleUseful}
          onConditions={() => {
            setTab("conditions");
          }}
        />
      ) : (
        <ConditionsTab {...conditions} units={units} />
      )}
    </div>
  );
}

function FollowingTab({
  items,
  followeeCount,
  now,
  units,
  toggleUseful,
  onConditions,
}: Readonly<{
  items: FeedItem[];
  followeeCount: number;
  now: number;
  units: Units;
  toggleUseful: ToggleUsefulFn;
  onConditions: () => void;
}>) {
  // One status region for the screen, however many cards (Accessibility
  // Contract rule 08) — each card's Useful reports its sentence here.
  const [status, setStatus] = useState("");

  if (items.length === 0) {
    return (
      <FollowingEmpty
        followsAnyone={followeeCount > 0}
        onConditions={onConditions}
      />
    );
  }
  return (
    <div data-part="feed" className="flex flex-col gap-5">
      <FormStatus>{status}</FormStatus>
      {items.map((item) => (
        <PostCard
          key={item.entryId}
          item={item}
          units={units}
          now={now}
          toggleUseful={toggleUseful}
          onStatus={setStatus}
        />
      ))}
    </div>
  );
}

/**
 * Following with nothing on it (round 22, "E1v1 Following empty").
 *
 * Reached by switching tabs with no follows, or when follows exist and
 * none has shared: then the second line says so and *Find a runner* stays.
 * The foot link switches tabs; it is not a second primary.
 */
function FollowingEmpty({
  followsAnyone,
  onConditions,
}: Readonly<{ followsAnyone: boolean; onConditions: () => void }>) {
  return (
    <div
      data-part="feed"
      data-state="empty"
      className="flex flex-col items-start gap-4 pt-8"
    >
      <BracketHeadline>Nobody yet</BracketHeadline>
      <p className="m-0 text-lead">Nobody you follow has posted yet.</p>
      <p className="m-0 text-body text-quiet">
        {followsAnyone
          ? "The runners you follow haven’t shared a run yet."
          : "Follow runners you already know by their username."}
      </p>
      <Link
        data-part="primary-action"
        to="/feed/search"
        className="target inline-flex items-center rounded-pill bg-ink px-6 py-3 text-body font-bold text-ground no-underline"
      >
        Find a runner
      </Link>
      <p className="m-0 w-full border-t border-hairline pt-4 text-body text-quiet">
        Meanwhile:{" "}
        <button
          type="button"
          onClick={onConditions}
          className="target cursor-pointer border-none bg-transparent p-0 text-left text-body font-bold text-ink"
        >
          what people wore in your conditions
        </button>
      </p>
    </div>
  );
}
