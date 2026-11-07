import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DeskPage,
  useDeskToday,
} from "../../src/modules/ops/components/DeskPage";
import { DeskShell } from "../../src/modules/ops/components/DeskShell";
import { DeskTodayPage, Today } from "../../src/modules/ops/components/Today";
import type { DeskToday, TodayCounts } from "../../src/modules/ops/desk";

/**
 * The Desk's shell and Today (Operator Screens D0).
 */

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/**
Tuesday 16 September 2025, 12:00 UTC — the board's own date.
*/
const TUESDAY_NOON = Date.UTC(2025, 8, 16, 12) / 1000;

function desk(counts: Partial<TodayCounts> = {}): DeskToday {
  return {
    asOf: TUESDAY_NOON,
    counts: {
      waiting: 0,
      decidedToday: 0,
      oldestWaitingAt: undefined,
      screenerUnfinished: 0,
      corrections: 0,
      bansThisWeek: 0,
      bansAllTime: 0,
      flaggedAccounts: 0,
      gaveUp: 0,
      oldestGaveUpAt: undefined,
      digestUnconfirmedAt: undefined,
      outboxBehind: 0,
      oldestBehindAt: undefined,
      ...counts,
    },
    skipped: [],
    breakers: [],
  };
}

async function renderToday(today: DeskToday) {
  return renderWithRouter(
    <Today
      today={today}
      gaveUp={[]}
      retry={vi.fn(() => Promise.resolve("retried"))}
      drop={vi.fn(() => Promise.resolve())}
      onChanged={vi.fn(() => Promise.resolve())}
    />,
  );
}

function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: "Desk" });
}

describe("DeskShell", () => {
  it("is always dark: the night ground, whatever the page or theme around it", async () => {
    const { container } = await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    // `night`, not the inverted `ink`, which a dark page turns to paper.
    expect(container.querySelector('[data-ground="night"]')).toContainElement(
      screen.getByText("page"),
    );
    expect(container.querySelector('[data-ground="ink"]')).toBeNull();
  });

  it("marks itself as the Desk, for an operator", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    expect(within(rail()).getByText("Desk")).toHaveClass("text-hiviz-text");
    expect(within(rail()).getByText("Operator")).toBeInTheDocument();
  });

  it("names every destination in the rail, in order", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    const entries = within(rail())
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    // D-87's five (D0, round 30): Gave up is a section of Today, not here.
    // Corrections under Review, above Duplicates (R48·130).
    expect(entries).toStrictEqual([
      "Today",
      "Review",
      "Corrections",
      "Access",
      "Duplicates",
      "Runners",
    ]);
  });

  it("links every destination", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    const links = within(rail()).getAllByRole("link");
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toStrictEqual([
      ["Today", "/desk"],
      ["Review", "/desk/review"],
      ["Corrections", "/desk/corrections"],
      // D7, task 126 (ACC-5).
      ["Access", "/desk/access"],
      // D2, task 110: the last to be built.
      ["Duplicates", "/desk/duplicates"],
      ["Runners", "/desk/runners"],
    ]);
  });

  it("marks Duplicates current on its own page", async () => {
    await renderWithRouter(
      <DeskShell current="duplicates" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    const current = within(rail()).getByRole("link", { current: "page" });
    expect(current.textContent).toBe("Duplicates");
    expect(current).toHaveClass("text-hiviz-text");
  });

  it("marks the current destination, in hi-viz", async () => {
    await renderWithRouter(
      <DeskShell current="review" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    const review = within(rail()).getByRole("link", { name: "Review" });
    const today = within(rail()).getByRole("link", { name: "Today" });
    expect(review).toHaveAttribute("aria-current", "page");
    expect(review).toHaveClass("text-hiviz-text");
    expect(today).not.toHaveAttribute("aria-current");
    expect(today).toHaveClass("text-ink");
  });

  it("counts what is waiting on the Review entry, in hi-viz", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk({ waiting: 4 })}>
        <p>page</p>
      </DeskShell>,
    );

    const review = within(rail()).getByRole("link", {
      name: "Review 4 waiting",
    });
    expect(within(review).getByText("4")).toHaveClass("text-hiviz-text");
    // The rail draws the bare number; the unit is spoken only.
    expect(within(review).getByText("waiting")).toHaveClass("sr-only");
  });

  it("counts the Corrections queue's rows on its entry (R48·130)", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk({ corrections: 2 })}>
        <p>page</p>
      </DeskShell>,
    );
    const corrections = within(rail()).getByRole("link", {
      name: "Corrections 2 waiting",
    });
    expect(within(corrections).getByText("2")).toHaveClass("text-hiviz-text");
  });

  it("counts what the system gave up on on the Today entry, in hi-viz", async () => {
    await renderWithRouter(
      <DeskShell current="review" today={desk({ gaveUp: 3, waiting: 4 })}>
        <p>page</p>
      </DeskShell>,
    );

    const today = within(rail()).getByRole("link", {
      name: "Today 3 gave up",
    });
    expect(within(today).getByText("3")).toHaveClass("text-hiviz-text");
    expect(within(today).getByText("gave up")).toHaveClass("sr-only");
    expect(
      within(rail()).getByRole("link", { name: "Review 4 waiting" }),
    ).toBeVisible();
  });

  it("shows no count at zero, and none on a destination that has none", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    // The entry stays; the count goes (D6).
    expect(within(rail()).getByRole("link", { name: "Review" })).toBeVisible();
    expect(rail().querySelectorAll(":scope li .font-mono")).toHaveLength(0);
    // Nor the words that would have said what it counts.
    expect(within(rail()).queryByText("waiting")).not.toBeInTheDocument();
  });

  it("marks only the page you are on current, not Today on every Desk page", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <DeskShell current="review" today={desk()}>
          <p>page</p>
        </DeskShell>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/desk/review"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    // The router's own match: "/desk" is a prefix of "/desk/review", and
    // a prefix match would mark Today current too.
    expect(
      await within(rail()).findByRole("link", { name: "Review" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(rail()).getByRole("link", { name: "Today" }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("Today", () => {
  it("dates the counts, month before day", async () => {
    await renderToday(desk());

    // Heard, the heading says what the date is of; seen, it is the date.
    const heading = screen.getByRole("heading", {
      level: 1,
      name: "Today, Tuesday, Sep 16",
    });
    expect(within(heading).getByText("Today,")).toHaveClass(
      "sr-only",
      "normal-case",
    );
  });

  it("renders the digest's three numbers in its order, then flagged accounts (R47·125)", async () => {
    await renderToday(
      desk({
        waiting: 4,
        decidedToday: 0,
        oldestWaitingAt: TUESDAY_NOON - 19 * 3600 - 1200,
        screenerUnfinished: 1,
        bansThisWeek: 0,
        bansAllTime: 3,
        flaggedAccounts: 0,
      }),
    );

    const stats = within(screen.getByRole("list", { name: "Today" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(stats).toStrictEqual([
      "4waiting for a decisionOldest · 19h",
      "1photo the screener couldn't finishHidden until you look",
      "0bans this week3 all time",
      "0flagged accounts",
    ]);
  });

  it("links flagged accounts to D8's Flagged filter, in hi-viz above zero, singular at one", async () => {
    await renderToday(desk({ flaggedAccounts: 1 }));

    const link = screen.getByRole("link", { name: "flagged account" });
    expect(link).toHaveAttribute("href", "/desk/runners?filter=flagged");
    const count = link.closest("li")?.querySelector(".font-mono");
    expect(count).toHaveTextContent("1");
    expect(count).toHaveClass("text-hiviz-text");
    // The board draws no line under it: only the count is in mono.
    expect(link.closest("li")?.querySelectorAll(".font-mono")).toHaveLength(1);
  });

  it("puts what needs a person in hi-viz, and nothing at zero or for bans", async () => {
    await renderToday(
      desk({
        waiting: 2,
        decidedToday: 0,
        oldestWaitingAt: TUESDAY_NOON - 3600,
        screenerUnfinished: 0,
        bansThisWeek: 1,
        bansAllTime: 1,
      }),
    );

    const [waiting, screener, bans] = within(
      screen.getByRole("list", { name: "Today" }),
    ).getAllByRole("listitem");
    expect(within(waiting ?? document.body).getByText("2")).toHaveClass(
      "text-hiviz-text",
    );
    expect(within(screener ?? document.body).getByText("0")).toHaveClass(
      "text-ink",
    );
    expect(within(bans ?? document.body).getByText("1")).toHaveClass(
      "text-ink",
    );
  });

  it("says nothing is waiting rather than dating an oldest that does not exist", async () => {
    await renderToday(desk());

    expect(screen.getByText("Nothing waiting")).toBeInTheDocument();
  });

  it("speaks in the plural past one", async () => {
    await renderToday(desk({ screenerUnfinished: 2, bansThisWeek: 2 }));

    expect(
      screen.getByText("photos the screener couldn't finish"),
    ).toBeInTheDocument();
    expect(screen.getByText("bans this week")).toBeInTheDocument();
  });

  it("speaks in the singular at one", async () => {
    await renderToday(desk({ bansThisWeek: 1 }));

    expect(screen.getByText("ban this week")).toBeInTheDocument();
  });
});

describe("DeskTodayPage", () => {
  it("is Today in the Desk's shell, and reloads the route after a drop", async () => {
    const drop = vi.fn(() => Promise.resolve());
    const page = (
      <DeskTodayPage
        today={desk({ gaveUp: 1 })}
        gaveUp={[
          {
            id: "g1",
            kind: "weather",
            doing: "Fetch weather for @sam's run",
            reason: "No weather.",
            rawError: undefined,
            tries: 5,
            firstFailedAt: TUESDAY_NOON - 3600,
            lastFailedAt: TUESDAY_NOON - 3600,
            hasStoredPage: false,
          },
        ]}
        retry={vi.fn(() => Promise.resolve())}
        drop={drop}
      />
    );
    const rootRoute = createRootRoute({ component: () => page });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const invalidate = vi.spyOn(router, "invalidate");
    render(<RouterProvider router={router} />);

    expect(
      await within(rail()).findByRole("link", { name: "Today 1 gave up" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: /^Drop/u }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(drop).toHaveBeenCalledWith({ data: { id: "g1" } });
  });
});

/**
 * Renders `page` under a `/desk` layout whose loader returns `today`, the
 * way every route under the real `/desk` sees it.
 */
async function renderUnderDesk(today: DeskToday, page: () => ReactElement) {
  const rootRoute = createRootRoute();
  const deskRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "desk",
    loader: () => today,
  });
  const pageRoute = createRoute({
    getParentRoute: () => deskRoute,
    // Not `/desk` itself: Today's rail link would be the router's
    // current page there, whichever entry DeskPage marks.
    path: "page",
    component: page,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([deskRoute.addChildren([pageRoute])]),
    history: createMemoryHistory({ initialEntries: ["/desk/page"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function TodayCountsProbe() {
  const today = useDeskToday();
  return <p>{`waiting ${String(today.counts.waiting)}`}</p>;
}

describe("DeskPage", () => {
  it("draws the shell with the /desk layout's counts, marking its page", async () => {
    await renderUnderDesk(desk({ waiting: 4, gaveUp: 3 }), () => (
      <DeskPage current="duplicates">
        <p>the page</p>
      </DeskPage>
    ));

    expect(await screen.findByText("the page")).toBeTruthy();
    // One current page, not two: Today's `/desk` is a prefix of every
    // Desk URL, and a fuzzy match marked it current everywhere.
    expect(
      within(rail()).getByRole("link", { current: "page" }).textContent,
    ).toBe("Duplicates");
    // The counts come from the layout's loader, through useDeskToday.
    expect(
      within(rail())
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toStrictEqual([
      "Today3 gave up",
      "Review4 waiting",
      "Corrections",
      "Access",
      "Duplicates",
      "Runners",
    ]);
  });

  it("hands a page the same counts through useDeskToday", async () => {
    await renderUnderDesk(desk({ waiting: 7 }), () => <TodayCountsProbe />);

    expect(await screen.findByText("waiting 7")).toBeTruthy();
  });
});
