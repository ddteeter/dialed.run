import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RunList } from "../../src/modules/runs/components/RunList";
import type { RunRow } from "../../src/modules/runs/service";

/**
 * The run list, and the badge that says where a run's conditions came
 * from.
 *
 * That badge is a switch over `weather_status` with six answers, and
 * `renderToString` could only ever look at one of them.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function run(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "01RUN",
    userId: "01USER",
    source: "manual",
    startedAt: 1_755_000_000,
    durationS: 1800,
    distanceM: 5000,
    lat: NOTHING,
    lng: NOTHING,
    indoor: false,
    effort: NOTHING,
    title: "Evening run",
    idempotencyKey: NOTHING,
    weatherStatus: "attached",
    ...overrides,
  };
}

describe("RunList", () => {
  it("asks for a file rather than showing an empty list", async () => {
    await renderWithRouter(<RunList runs={[]} />);
    expect(screen.getByText(/Drop in a GPX/)).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("links each run to its own screen", async () => {
    await renderWithRouter(
      <RunList
        runs={[
          run({ id: "01A", title: "Morning" }),
          run({ id: "01B", title: "Evening" }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: /Morning/ })).toHaveAttribute(
      "href",
      "/runs/01A",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders the distance in km, to two places, in mono", async () => {
    // Mono is the tell that a value was measured. 5000 m is 5.00 km, not
    // 5 km: a bare integer reads as a rounded guess.
    await renderWithRouter(<RunList runs={[run({ distanceM: 5432 })]} />);
    expect(screen.getByRole("link", { name: /Evening run/ })).toHaveTextContent(
      "5.43 KM",
    );
  });

  it("separates the badge from the distance", async () => {
    // A literal " · ": JSX drops whitespace between expressions, so
    // without it the line reads "[CONDITIONS ATTACHED]5.00 KM".
    await renderWithRouter(<RunList runs={[run()]} />);
    expect(screen.getByRole("link", { name: /Evening run/ })).toHaveTextContent(
      "[Conditions attached] · 5.00 KM",
    );
  });

  it.each([
    ["attached", "Conditions attached"],
    ["manual", "Manual temp"],
    ["failed", "Unavailable"],
    ["pending", "Pending"],
    ["none", "None"],
  ] as const)("says %s runs are %s", async (status, badge) => {
    // Every arm of the switch, including the default: a status this list
    // does not recognise still has to render something a person can read.
    await renderWithRouter(
      <RunList runs={[run({ weatherStatus: status })]} />,
    );
    expect(screen.getByRole("link", { name: /Evening run/ })).toHaveTextContent(
      `[${badge}]`,
    );
  });

  it("says Indoor whatever the weather status claims", async () => {
    // The indoor check comes first on purpose: a treadmill run with a
    // stale 'attached' status has no conditions worth showing.
    await renderWithRouter(
      <RunList runs={[run({ indoor: true, weatherStatus: "attached" })]} />,
    );
    expect(screen.getByRole("link", { name: /Evening run/ })).toHaveTextContent(
      "[Indoor]",
    );
  });

  it("keeps the badge in normal case so a reader announces it as words", async () => {
    // Uppercased in CSS by <Bracketed>: several screen readers spell short
    // all-caps tokens out letter by letter.
    await renderWithRouter(<RunList runs={[run()]} />);
    expect(screen.queryByText(/CONDITIONS ATTACHED/)).toBeNull();
  });
});
