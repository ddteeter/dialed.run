import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
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

import { DeskShell } from "../../src/modules/ops/components/DeskShell";
import { DeskTodayPage, Today } from "../../src/modules/ops/components/Today";
import type { DeskToday, TodayCounts } from "../../src/modules/ops/desk";
import type { GaveUpJob } from "../../src/modules/ops/gave-up";

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
      oldestWaitingAt: undefined,
      screenerUnfinished: 0,
      bansThisWeek: 0,
      bansAllTime: 0,
      gaveUp: 0,
      oldestGaveUpAt: undefined,
      ...counts,
    },
  };
}

function renderToday(
  today: DeskToday,
  gaveUp: readonly GaveUpJob[] = [],
  handlers: Partial<Parameters<typeof Today>[0]> = {},
) {
  return render(
    <Today
      today={today}
      gaveUp={gaveUp}
      retry={vi.fn(() => Promise.resolve("retried"))}
      drop={vi.fn(() => Promise.resolve())}
      onChanged={vi.fn(() => Promise.resolve())}
      {...handlers}
    />,
  );
}

function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: "Desk" });
}

describe("DeskShell", () => {
  it("is always dark: the inverted ground, whatever the page around it", async () => {
    const { container } = await renderWithRouter(
      <DeskShell current="today" today={desk()}>
        <p>page</p>
      </DeskShell>,
    );

    expect(container.querySelector('[data-ground="ink"]')).toContainElement(
      screen.getByText("page"),
    );
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
    expect(entries).toStrictEqual([
      "Today",
      "Review",
      "Access",
      "Duplicates",
      "Runners",
    ]);
  });

  it("links the built destinations, and only those", async () => {
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
      ["Review", "/safety/review"],
      // D7, task 126 (ACC-5).
      ["Access", "/desk/access"],
      ["Runners", "/desk/runners"],
    ]);
    // Not yet built: text, not a link that goes nowhere.
    expect(within(rail()).getByText("Duplicates").closest("li")).toHaveClass(
      "text-muted",
    );
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

    const review = within(rail()).getByRole("link", { name: "Review 4" });
    expect(within(review).getByText("4")).toHaveClass("text-hiviz-text");
  });

  it("counts what the system gave up on on the Today entry, in hi-viz", async () => {
    await renderWithRouter(
      <DeskShell current="review" today={desk({ gaveUp: 3, waiting: 4 })}>
        <p>page</p>
      </DeskShell>,
    );

    const today = within(rail()).getByRole("link", { name: "Today 3" });
    expect(within(today).getByText("3")).toHaveClass("text-hiviz-text");
    expect(
      within(rail()).getByRole("link", { name: "Review 4" }),
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
  });
});

describe("Today", () => {
  it("dates the counts, month before day", () => {
    renderToday(desk());

    expect(
      screen.getByRole("heading", { level: 1, name: "Tuesday, Sep 16" }),
    ).toBeInTheDocument();
  });

  it("renders the digest's three numbers, in the digest's order", () => {
    renderToday(
      desk({
        waiting: 4,
        oldestWaitingAt: TUESDAY_NOON - 19 * 3600 - 1200,
        screenerUnfinished: 1,
        bansThisWeek: 0,
        bansAllTime: 3,
      }),
    );

    const stats = within(screen.getByRole("list", { name: "Today" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(stats).toStrictEqual([
      "4waiting for a decisionOldest · 19h",
      "1photo the screener couldn't finishHidden until you look",
      "0bans this week3 all time",
    ]);
  });

  it("puts what needs a person in hi-viz, and nothing at zero or for bans", () => {
    renderToday(
      desk({
        waiting: 2,
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

  it("says nothing is waiting rather than dating an oldest that does not exist", () => {
    renderToday(desk());

    expect(screen.getByText("Nothing waiting")).toBeInTheDocument();
  });

  it("speaks in the plural past one", () => {
    renderToday(desk({ screenerUnfinished: 2, bansThisWeek: 2 }));

    expect(
      screen.getByText("photos the screener couldn't finish"),
    ).toBeInTheDocument();
    expect(screen.getByText("bans this week")).toBeInTheDocument();
  });

  it("speaks in the singular at one", () => {
    renderToday(desk({ bansThisWeek: 1 }));

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
      await within(rail()).findByRole("link", { name: "Today 1" }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: /^Drop/u }));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
    expect(drop).toHaveBeenCalledWith({ data: { id: "g1" } });
  });
});
