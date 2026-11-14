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
import {
  DeskTodayPage,
  Today,
  flaggedNote,
} from "../../src/modules/ops/components/Today";
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
      oldestFlaggedAt: undefined,
      gaveUp: 0,
      oldestGaveUpAt: undefined,
      digestUnconfirmedAt: undefined,
      lastDigestAt: undefined,
      outboxBehind: 0,
      oldestBehindAt: undefined,
      ...counts,
    },
    skipped: [],
    breakers: [],
    operatorHandle: undefined,
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

  it("heads every page with the bar: [dialed] DESK, and who is looking (R55·194)", async () => {
    await renderWithRouter(
      <DeskShell
        current="today"
        today={{ ...desk(), operatorHandle: "maya_ops" }}
      >
        <p>page</p>
      </DeskShell>,
    );

    const bar = screen.getByRole("banner");
    expect(within(bar).getByText("Desk")).toHaveClass("text-hiviz-text");
    // The Desk's [dialed], with no .run, said in full.
    expect(within(bar).queryByText(".run")).toBeNull();
    expect(within(bar).getByText("dialed.run")).toHaveClass("sr-only");
    // The handle in its own case; the role in capitals; at width only.
    const operator = bar.querySelector("[data-part='operator']");
    expect(operator).toHaveTextContent("@maya_ops · Operator ·");
    expect(operator).toHaveClass("hidden", "wide:inline");
    expect(operator).not.toHaveClass("uppercase");
    expect(within(bar).getByText("Operator ·")).toHaveClass("uppercase");
    // No sign-out was provided, so none is drawn.
    expect(within(bar).queryByRole("button")).toBeNull();
  });

  it("names nobody in the bar for an operator with no handle", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    expect(
      screen.getByRole("banner").querySelector("[data-part='operator']"),
    ).toHaveTextContent(/^Operator ·$/u);
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
      "Codes",
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
      // R55·194: Codes, its own destination beside Access.
      ["Codes", "/desk/codes"],
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
    expect(current).toHaveClass("border-hi-viz");
  });

  it("marks the current destination by its edge, keeping hi-viz text for counts (R55·194/195)", async () => {
    await renderWithRouter(
      <DeskShell current="review" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    const review = within(rail()).getByRole("link", { name: "Review" });
    const today = within(rail()).getByRole("link", { name: "Today" });
    expect(review).toHaveAttribute("aria-current", "page");
    // A 2px hi-viz edge: the underline on a phone, the left bar at width,
    // with the --panel fill and bold text there.
    expect(review).toHaveClass(
      "border-b-2",
      "wide:border-b-0",
      "wide:border-l-2",
      "border-hi-viz",
      "font-bold",
      "wide:bg-panel",
      "text-ink",
    );
    expect(review).not.toHaveClass("text-hiviz-text", "border-transparent");
    expect(today).not.toHaveAttribute("aria-current");
    expect(today).toHaveClass("border-transparent", "text-ink");
    expect(today).not.toHaveClass(
      "border-hi-viz",
      "font-bold",
      "wide:bg-panel",
    );
  });

  it("scrolls the current destination into the phone's row, and no other (R55·195)", async () => {
    const scrolled: string[] = [];
    const spy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(function (this: HTMLElement, options) {
        expect(options).toStrictEqual({ block: "nearest", inline: "nearest" });
        scrolled.push(this.textContent);
      });
    await renderWithRouter(
      <DeskShell current="codes" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );
    expect(scrolled).toStrictEqual(["Codes"]);
    spy.mockRestore();
  });

  it("is one sticky row on a phone and the rail beside the page from wide (R55·195)", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );
    expect(rail()).toHaveClass(
      "sticky",
      "top-0",
      "overflow-x-auto",
      "wide:static",
      "wide:flex-col",
      "wide:border-r",
    );
    expect(within(rail()).getByRole("list")).toHaveClass(
      "flex",
      "whitespace-nowrap",
      "wide:flex-col",
    );
  });

  it("says at the rail's foot that screening is OK and the digest has not run yet", async () => {
    await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );
    const footer = rail().querySelector("[data-part='rail-footer']");
    expect(footer).toHaveClass("hidden", "wide:flex");
    const [screening, digest] = [...(footer?.children ?? [])];
    expect(screening).toHaveTextContent("Screening · OK");
    expect(screening).toHaveClass("text-muted");
    expect(digest).toHaveTextContent("Last digest · Not yet");
  });

  it("says screening is holding, in hi-viz, while a breaker is over, and when the digest last ran (owner, #635)", async () => {
    await renderWithRouter(
      <DeskShell
        current="today"
        today={{
          ...desk({ lastDigestAt: TUESDAY_NOON - 5 * 3600 }),
          breakers: [
            { cause: "fingerprint", isOver: true, count: 9, ceiling: 8 },
          ],
        }}
      >
        <p>page</p>
      </DeskShell>,
    );
    const footer = rail().querySelector("[data-part='rail-footer']");
    const [screening, digest] = [...(footer?.children ?? [])];
    expect(screening).toHaveTextContent("Screening · Holding");
    expect(screening).toHaveClass("text-hiviz-text");
    expect(digest).toHaveTextContent("Last digest · 07:00");
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
      "0flagged accountsNone flagged",
    ]);
  });

  it("draws the four as --panel cards, two by two, the numeral in display type (R55·196)", async () => {
    await renderToday(desk({ waiting: 4 }));
    const list = screen.getByRole("list", { name: "Today" });
    expect(list).toHaveClass("grid", "grid-cols-2", "gap-3");
    const [first] = within(list).getAllByRole("listitem");
    expect(first).toHaveClass("rounded-card", "border", "bg-panel", "p-5");
    expect(within(first ?? document.body).getByText("4")).toHaveClass(
      "font-display",
      "text-display",
    );
  });

  it("says HIDDEN UNTIL YOU LOOK in hi-viz while the screener left one, muted at zero (R55·196)", async () => {
    const { unmount } = await renderToday(desk({ screenerUnfinished: 2 }));
    expect(screen.getByText("Hidden until you look")).toHaveClass(
      "text-hiviz-text",
    );
    unmount();
    await renderToday(desk({ screenerUnfinished: 0 }));
    expect(screen.getByText("Hidden until you look")).toHaveClass("text-muted");
  });

  it("keeps every other caption muted, even above zero", async () => {
    await renderToday(
      desk({
        waiting: 3,
        oldestWaitingAt: TUESDAY_NOON - 3600,
        flaggedAccounts: 2,
        oldestFlaggedAt: TUESDAY_NOON - 2 * 86_400,
      }),
    );
    expect(screen.getByText("Oldest · 1h")).toHaveClass("text-muted");
    expect(screen.getByText("Oldest · 2d")).toHaveClass("text-muted");
  });

  it("links flagged accounts to D8's Flagged filter, in hi-viz above zero, singular at one", async () => {
    await renderToday(desk({ flaggedAccounts: 1 }));

    const link = screen.getByRole("link", { name: "flagged account" });
    expect(link).toHaveAttribute("href", "/desk/runners?filter=flagged");
    const card = link.closest("li");
    const count = card?.querySelector(".font-display");
    expect(count).toHaveTextContent("1");
    expect(count).toHaveClass("text-hiviz-text");
    // R55·196: the whole card opens it, the link stretched over the card.
    expect(card).toHaveClass("relative");
    expect(link).toHaveClass("after:absolute", "after:inset-0");
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

describe("flaggedNote", () => {
  it("says NONE FLAGGED at zero, else how long the oldest has waited (R55·196)", () => {
    expect(flaggedNote(undefined, TUESDAY_NOON)).toBe("None flagged");
    expect(flaggedNote(TUESDAY_NOON - 2 * 86_400 - 5, TUESDAY_NOON)).toBe(
      "Oldest · 2d",
    );
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
      "Codes",
      "Runners",
    ]);
  });

  it("gives the three tables the page measure and the rest the column (168.3, R55·194)", async () => {
    const widths: Record<string, string> = {};
    for (const current of [
      "today",
      "review",
      "corrections",
      "access",
      "duplicates",
      "codes",
      "runners",
    ] as const) {
      const { unmount } = await renderUnderDesk(desk({}), () => (
        <DeskPage current={current}>
          <p>{`the ${current} page`}</p>
        </DeskPage>
      ));
      const body = await screen.findByText(`the ${current} page`);
      const page = body.closest("main")?.firstElementChild;
      widths[current] =
        /max-w-(?<measure>page|column)/u.exec(page?.className ?? "")?.groups
          ?.measure ?? "neither";
      unmount();
    }
    expect(widths).toStrictEqual({
      today: "column",
      review: "page",
      corrections: "column",
      access: "column",
      duplicates: "column",
      codes: "page",
      runners: "page",
    });
  });

  it("hands a page the same counts through useDeskToday", async () => {
    await renderUnderDesk(desk({ waiting: 7 }), () => <TodayCountsProbe />);

    expect(await screen.findByText("waiting 7")).toBeTruthy();
  });
});
