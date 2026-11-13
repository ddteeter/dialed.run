import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { drawnText, saidText } from "./spoken-text";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { UiGroup, VerdictCoverage } from "../../src/lib/contracts";
import {
  ClosetFilters,
  chipValues,
  type ClosetFiltersProps,
} from "../../src/modules/closet/components/ClosetFilters";
import {
  barRange,
  thumbSpread,
  trackPercent,
} from "../../src/modules/closet/components/WorksAt";
import type { RailCounts } from "../../src/modules/closet/filters";
import type { ClosetSearch } from "../../src/modules/closet/inputs";

/**
 * Closet C's rail (R-94, design 174; round 46 #109b, f, h): every control
 * as it works before hydration — links and a GET form — and as it works
 * once a script is driving it.
 */
function routed(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

async function renderWithRouter(element: ReactElement) {
  const router = routed(element);
  await router.load();
  return render(<RouterProvider router={router} />);
}

const COUNTS: RailCounts = {
  all: 47,
  groups: new Map<UiGroup, number>([
    ["tops", 14],
    ["bottoms", 9],
    ["outer", 5],
    ["hands_head", 8],
    ["shoes", 6],
  ]),
  coverage: new Map<VerdictCoverage, number>([
    ["covered", 21],
    ["partial", 9],
    ["unknown", 17],
  ]),
};

function filters(props: Partial<ClosetFiltersProps> = {}): ReactElement {
  return (
    <ClosetFilters
      variant="rail"
      search={{}}
      counts={COUNTS}
      span={{ lowC: 1.1, highC: 14.4 }}
      tempUnit="f"
      {...props}
    />
  );
}

const rail = (props: Partial<ClosetFiltersProps> = {}) =>
  renderWithRouter(filters(props));

const chips = (props: Partial<ClosetFiltersProps> = {}) =>
  rail({ variant: "chips", ...props });

const link = (name: RegExp): HTMLElement => screen.getByRole("link", { name });
const href = (name: RegExp): string | null => link(name).getAttribute("href");
const button = (name: RegExp): HTMLElement =>
  screen.getByRole("button", { name });

/**
A rail whose search is its own state, as the route's is: what it asks for, it gets.
*/
function Driven() {
  const [search, setSearch] = useState<ClosetSearch>({ from: 4.4 });
  return filters({ search, onSearch: setSearch });
}

function hiddenFields(container: HTMLElement): string[] {
  return [...container.querySelectorAll("input[type='hidden']")].map(
    (input) =>
      `${input.getAttribute("name") ?? ""}=${input.getAttribute("value") ?? ""}`,
  );
}

function spanFill(): HTMLElement {
  const bar = document.querySelector<HTMLElement>("[data-part='span']");
  if (bar === null) throw new Error("no span");
  return bar;
}

describe("ClosetFilters: GROUP", () => {
  it("lists All and the groups with their counts, and leaves out a group holding nothing (round 47 #112b)", async () => {
    await rail();
    expect(link(/^All/)).toHaveTextContent("All 47");
    expect(link(/^Tops/)).toHaveTextContent("Tops 14");
    expect(link(/^Hands \/ head/)).toHaveTextContent("Hands / head 8");
    expect(screen.queryByRole("link", { name: /^Socks \/ extras/ })).toBeNull();
  });

  it("marks All current with no group set, and only it", async () => {
    await rail();
    expect(link(/^All/)).toHaveAttribute("aria-current", "true");
    expect(link(/^Tops/)).not.toHaveAttribute("aria-current");
  });

  it("marks the set group, and links each to the closet with that group", async () => {
    await rail({ search: { group: "tops", coverage: "partial" } });
    expect(link(/^Tops/)).toHaveAttribute("aria-current", "true");
    expect(link(/^All/)).not.toHaveAttribute("aria-current");
    expect(href(/^Shoes/)).toBe("/closet?group=shoes&coverage=partial");
    expect(href(/^All/)).toBe("/closet?coverage=partial");
  });

  it("is current on the page it links to, and only there, by the router's word", async () => {
    const router = createRouter({
      routeTree: createRootRoute({
        component: () =>
          filters({ search: { group: "tops", coverage: "partial" } }),
      }),
      history: createMemoryHistory({
        initialEntries: ["/closet?group=tops&coverage=partial"],
      }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(link(/^Tops/)).toHaveAttribute("aria-current", "page");
    // All's search is a part of this one's; it is still not this page.
    expect(link(/^All/)).not.toHaveAttribute("aria-current");
    expect(link(/^Shoes/)).not.toHaveAttribute("aria-current");
    // The chosen level leads away, to clear it, so it is ours: "true".
    expect(link(/^Partial/)).toHaveAttribute("aria-current", "true");
    expect(link(/^Covered/)).not.toHaveAttribute("aria-current");
  });

  it("never calls Clear current, though its search is a part of this one's", async () => {
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => filters({ search: { from: 1.1, group: "tops" } }),
      }),
      history: createMemoryHistory({
        initialEntries: ["/closet?from=1.1&group=tops"],
      }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("link", { name: "Clear" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("stays links once a script drives the rail", async () => {
    await rail({ onSearch: vi.fn() });
    expect(link(/^Tops/)).toHaveAttribute("href", "/closet?group=tops");
  });
});

describe("ClosetFilters: COVERAGE before a script", () => {
  it("names each level with its count and an ink swatch", async () => {
    await rail();
    const covered = link(/^Covered/);
    expect(covered).toHaveTextContent("Covered 21");
    expect(link(/^Partial/)).toHaveTextContent("Partial 9");
    expect(link(/^Untested/)).toHaveTextContent("Untested 17");
    expect(covered.querySelector("[data-coverage]")).toHaveAttribute(
      "data-coverage",
      "covered",
    );
    expect(link(/^Untested/).querySelector("[data-coverage]")).toHaveAttribute(
      "data-coverage",
      "unknown",
    );
  });

  it("links to a level, and from the set level to none", async () => {
    await rail({ search: { coverage: "partial", group: "tops" } });
    expect(link(/^Partial/)).toHaveAttribute("aria-current", "true");
    expect(link(/^Covered/)).not.toHaveAttribute("aria-current");
    expect(href(/^Partial/)).toBe("/closet?group=tops");
    expect(href(/^Untested/)).toBe("/closet?coverage=unknown&group=tops");
  });

  it("counts a level the closet holds none of as 0", async () => {
    await rail({ counts: { ...COUNTS, coverage: new Map() } });
    expect(link(/^Covered/)).toHaveTextContent("Covered 0");
  });
});

describe("ClosetFilters: COVERAGE with a script (#109f)", () => {
  it("is toggle buttons, the set level pressed and only it", async () => {
    await rail({ search: { coverage: "partial" }, onSearch: vi.fn() });
    expect(button(/^Partial/)).toHaveAttribute("aria-pressed", "true");
    expect(button(/^Covered/)).toHaveAttribute("aria-pressed", "false");
    expect(button(/^Partial/)).toHaveAttribute("type", "button");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Partial/ })).toBeNull();
  });

  it("sets a level, keeping the other filters", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    await rail({ search: { group: "tops" }, onSearch });
    await user.click(button(/^Covered/));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      group: "tops",
      coverage: "covered",
    });
  });

  it("lets the pressed level go when it is pressed again", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    await rail({ search: { coverage: "partial", group: "tops" }, onSearch });
    await user.click(button(/^Partial/));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      coverage: undefined,
      group: "tops",
    });
  });
});

describe("ClosetFilters: WORKS AT before a script (#109h)", () => {
  it("is a plain GET form to this page in the runner's unit", async () => {
    await rail();
    const lowest = screen.getByLabelText("Lowest");
    const highest = screen.getByLabelText("Highest");
    const form = lowest.closest("form");
    expect(form).toHaveAttribute("method", "get");
    expect(form).not.toHaveAttribute("action");
    expect(lowest).toHaveAttribute("placeholder", "34");
    expect(highest).toHaveAttribute("placeholder", "58");
    expect(lowest).toHaveDisplayValue("");
    // Its own names, which closetSearch reads in `unit` and never writes.
    expect(lowest).toHaveAttribute("name", "lowest");
    expect(highest).toHaveAttribute("name", "highest");
    expect(form).toHaveTextContent(/^Lowest\s*to\s*Highest\s*Apply$/u);
    expect(
      screen.getByRole("heading", { name: "Works at · °F" }),
    ).toBeVisible();
  });

  it("hides the two labels, and makes Apply a plain text button", async () => {
    await rail();
    expect(document.querySelector("label[for$='-lowest']")).toHaveClass(
      "sr-only",
    );
    expect(document.querySelector("label[for$='-highest']")).toHaveClass(
      "sr-only",
    );
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toHaveAttribute("type", "submit");
    expect(apply).toHaveClass("underline");
    expect(apply).not.toHaveClass("rounded-pill");
  });

  it("opens with the asked ends in whole degrees of the runner's unit", async () => {
    await rail({ search: { from: 1.1, to: 14.4 } });
    expect(screen.getByLabelText("Lowest")).toHaveValue(34);
    expect(screen.getByLabelText("Highest")).toHaveValue(58);
  });

  it("leaves an end nobody asked for empty, with not so much as a NaN", async () => {
    await rail({ search: { from: 1.1 } });
    expect(screen.getByLabelText("Lowest")).toHaveValue(34);
    expect(screen.getByLabelText("Highest")).not.toHaveAttribute("value");
  });

  it("names the unit its fields take", async () => {
    await rail({ tempUnit: "c", span: { lowC: 1, highC: 14 } });
    expect(
      screen.getByRole("heading", { name: "Works at · °C" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Lowest")).toHaveAttribute("placeholder", "1");
  });

  it("carries only its unit when nothing else is set", async () => {
    const { container } = await rail();
    expect(hiddenFields(container)).toStrictEqual(["unit=f"]);
  });

  it("carries group, coverage and retired through a submit", async () => {
    const { container } = await rail({
      search: { group: "outer", coverage: "covered", retired: true },
      tempUnit: "c",
    });
    expect(hiddenFields(container)).toStrictEqual([
      "unit=c",
      "group=outer",
      "coverage=covered",
      "retired=true",
    ]);
  });

  it("submits as the browser does, uncaught", async () => {
    await rail();
    expect(fireEvent.submit(button(/^Apply$/))).toBe(true);
  });

  it("offers no Clear while no span is set", async () => {
    await rail();
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
  });

  it("links Clear to the closet without the span, keeping the rest", async () => {
    await rail({ search: { from: 1.1, group: "tops" } });
    const clear = screen.getByRole("link", { name: "Clear" });
    expect(clear).toHaveAttribute("href", "/closet?group=tops");
    // Round 55 · 192: underlined and bold, so it reads as a control.
    expect(clear).toHaveClass(
      "target",
      "inline-flex",
      "items-center",
      "text-small",
      "font-bold",
      "text-ink",
      "underline",
    );
  });

  it("puts the value and Clear in the header row, with the unit (192)", async () => {
    await rail({ search: { from: 1.1 } });
    const header = screen
      .getByRole("heading", { name: /^Works at/ })
      .closest("[data-part='works-at-header']");
    expect(header).toHaveClass("min-h-11", "items-center", "justify-between");
    // An open end reads as the closet's bound: exact numbers, with the unit.
    const value = header?.querySelector("[data-part='works-at-value']");
    expect(drawnText(value)).toBe("34–58°F");
    expect(saidText(value)).toBe("34 to 58 degrees Fahrenheit");
    expect(within(header as HTMLElement).getByRole("link", { name: "Clear" })).toBeVisible();
  });

  it("reads Any in the header while no span is set", async () => {
    await rail();
    expect(
      document.querySelector("[data-part='works-at-value']"),
    ).toHaveTextContent(/^Any$/);
  });

  it("offers Clear for an upper end alone, too", async () => {
    await rail({ search: { to: 7.8 } });
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute(
      "href",
      "/closet",
    );
  });

  it("names no unit over Untested before a script, either", async () => {
    await rail({ span: undefined });
    expect(screen.getByRole("heading", { name: "Works at" })).toBeVisible();
  });

  it("says Untested and draws no control when no piece states a range", async () => {
    await rail({ span: undefined, onSearch: vi.fn() });
    expect(screen.queryByLabelText("Lowest")).toBeNull();
    const worksAt = screen
      .getByRole("heading", { name: /^Works at/ })
      .closest("section");
    expect(worksAt?.querySelector("p")).toHaveTextContent("[Untested]");
    // R50·143.5: `--muted` is for this word only, never the mark. The role
    // is ground-relative, so on a dark page it reads T1's dark `--muted`
    // (#8B8B93), which `test/ui/contrast.dom.test.tsx` pins.
    expect(worksAt?.querySelector("p")).toHaveClass("text-muted");
    // No numbers, so no unit for them to be in.
    expect(screen.getByRole("heading", { name: "Works at" })).toBeVisible();
  });
});

describe("ClosetFilters: WORKS AT with a script (#109h)", () => {
  it("is the bar: two thumbs over the closet's span, and no Apply", async () => {
    await rail({ search: { from: 4.4 }, onSearch: vi.fn() });
    const lowest = screen.getByRole("slider", { name: "Lowest" });
    const highest = screen.getByRole("slider", { name: "Highest" });
    expect(lowest).toHaveAttribute("min", "34");
    expect(lowest).toHaveAttribute("max", "58");
    expect(lowest).toHaveValue("40");
    expect(highest).toHaveValue("58");
    expect(highest).toHaveAttribute("step", "1");
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("heading", { name: "Works at" })).toBeVisible();
    expect(screen.getByText("40–58°F")).toHaveAttribute("aria-hidden", "true");
    // Round 53 · 162.3: the readout is said as a range, its unit in full.
    expect(screen.getByText("40 to 58 degrees Fahrenheit")).toHaveClass(
      "sr-only",
    );
  });

  it("asks for the span when a thumb is let go, in Celsius, the rest kept", async () => {
    const onSearch = vi.fn();
    await rail({ search: { group: "tops" }, onSearch });
    const lowest = screen.getByRole("slider", { name: "Lowest" });
    fireEvent.change(lowest, { target: { value: "40" } });
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByText("40–58°F")).toBeVisible();
    fireEvent.pointerUp(lowest);
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      group: "tops",
      from: 4.4,
      to: undefined,
    });
  });

  it("asks from the keyboard too, when the key is let go", async () => {
    const onSearch = vi.fn();
    await rail({ onSearch });
    const highest = screen.getByRole("slider", { name: "Highest" });
    fireEvent.change(highest, { target: { value: "50" } });
    fireEvent.keyUp(highest, { key: "ArrowLeft" });
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      from: undefined,
      to: 10,
    });
  });

  it("never lets the thumbs cross", async () => {
    await rail({ search: { from: 4.4, to: 7.8 }, onSearch: vi.fn() });
    const lowest = screen.getByRole("slider", { name: "Lowest" });
    const highest = screen.getByRole("slider", { name: "Highest" });
    fireEvent.change(lowest, { target: { value: "55" } });
    expect(lowest).toHaveValue("46");
    fireEvent.change(highest, { target: { value: "35" } });
    expect(highest).toHaveValue("46");
  });

  it("takes the pointer on its thumbs alone, so the lower one can be reached", async () => {
    await rail({ onSearch: vi.fn() });
    expect(screen.getByRole("slider", { name: "Lowest" })).toHaveClass(
      "pointer-events-none",
      "[&::-webkit-slider-thumb]:pointer-events-auto",
      "[&::-moz-range-thumb]:pointer-events-auto",
      "[&::-webkit-slider-thumb]:bg-ink",
    );
  });

  it("offers Clear as a button that lets go of both ends and focuses the label", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    await rail({ search: { from: 4.4, to: 7.8, group: "tops" }, onSearch });
    expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear).toHaveClass("target", "font-bold", "underline");
    await user.click(clear);
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      group: "tops",
      from: undefined,
      to: undefined,
    });
    const label = screen.getByRole("heading", { name: "Works at" });
    expect(label).toHaveFocus();
    // Focusable by Clear alone, never a stop in the tab order.
    expect(label).toHaveAttribute("tabindex", "-1");
  });

  it("starts the thumbs again from a search that changed under them", async () => {
    const user = userEvent.setup();
    await renderWithRouter(<Driven />);
    expect(screen.getByRole("slider", { name: "Lowest" })).toHaveValue("40");
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("slider", { name: "Lowest" })).toHaveValue("34");
    expect(screen.getByText("Any")).toBeVisible();
  });

  it("offers no Clear button while no span is set", async () => {
    await rail({ onSearch: vi.fn() });
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("ClosetFilters: the span bar", () => {
  it("fills the whole track while nothing is asked", async () => {
    await rail({ span: { lowC: 0, highC: 20 }, onSearch: vi.fn() });
    expect(spanFill().style.left).toBe("calc(0% - max(0px, 24px - 100%) / 2)");
    expect(spanFill().style.right).toBe("calc(0% - max(0px, 24px - 100%) / 2)");
  });

  it("fills the asked part, from each end", async () => {
    await rail({
      tempUnit: "c",
      span: { lowC: 0, highC: 20 },
      search: { from: 5, to: 15 },
      onSearch: vi.fn(),
    });
    expect(spanFill().style.left).toBe("calc(25% - max(0px, 24px - 50%) / 2)");
    expect(spanFill().style.right).toBe("calc(25% - max(0px, 24px - 50%) / 2)");
  });

  it("spreads the thumbs half the shortfall each way, so they sit 24 apart", async () => {
    // Round 55 · 192: a narrow range draws its span at 24, centred.
    await rail({
      tempUnit: "c",
      span: { lowC: 0, highC: 20 },
      search: { from: 8, to: 12 },
      onSearch: vi.fn(),
    });
    expect(screen.getByRole("slider", { name: "Lowest" }).style.transform).toBe(
      "translateX(calc(max(0px, 24px - 20%) / 2 * -1))",
    );
    expect(screen.getByRole("slider", { name: "Highest" }).style.transform).toBe(
      "translateX(calc(max(0px, 24px - 20%) / 2))",
    );
  });
});

describe("thumbSpread", () => {
  it("is the shortfall from 24, halved, and never negative", () => {
    expect(thumbSpread(7)).toBe("max(0px, 24px - 7%) / 2");
  });
});

describe("trackPercent and barRange", () => {
  it("places a value along the track, and a one-degree closet at 0", () => {
    expect(trackPercent(5, 0, 20)).toBe(25);
    expect(trackPercent(20, 0, 20)).toBe(100);
    expect(trackPercent(5, 5, 5)).toBe(0);
  });

  it("reads an end at its bound as open, and converts the rest", () => {
    const bounds = { low: 34, high: 58 };
    expect(barRange({ low: 34, high: 58 }, bounds, "f")).toStrictEqual({});
    expect(barRange({ low: 40, high: 50 }, bounds, "f")).toStrictEqual({
      from: 4.4,
      to: 10,
    });
    expect(barRange({ low: 35, high: 57 }, bounds, "f")).toStrictEqual({
      from: 1.7,
      to: 13.9,
    });
  });
});

describe("ClosetFilters: the phone's chip row (#109b)", () => {
  it("draws one chip per group in the rail's order, unset reading ALL and ANY", async () => {
    await chips();
    const [row] = within(screen.getByRole("navigation")).getAllByRole("list");
    if (row === undefined) throw new Error("no chip row");
    expect(
      within(row)
        .getAllByRole("button")
        .map((each) => drawnText(each)),
    ).toStrictEqual(["Group · All", "Works at · Any", "Coverage · All"]);
  });

  it("says a set span as a range in the chip's name (round 53 · 162.3)", async () => {
    await chips({ search: { from: 1.1, to: 14.4 } });
    expect(button(/^Works at/)).toHaveAccessibleName(
      "Works at · 34 to 58 degrees",
    );
    expect(drawnText(button(/^Works at/))).toBe("Works at · 34–58°");
  });

  it("reads each set value", () => {
    expect(
      chipValues(
        { group: "tops", from: 1.1, to: 14.4, coverage: "unknown" },
        "f",
      ),
    ).toStrictEqual({
      group: { shown: "Tops", said: "Tops" },
      worksAt: { shown: "34–58°", said: "34 to 58 degrees" },
      coverage: { shown: "Untested", said: "Untested" },
    });
  });

  it("opens nothing until a chip is tapped, then one at a time", async () => {
    const user = userEvent.setup();
    await chips();
    expect(button(/^Group/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /^Tops/ })).toBeNull();

    await user.click(button(/^Group/));
    expect(button(/^Group/)).toHaveAttribute("aria-expanded", "true");
    expect(link(/^Tops/)).toBeVisible();

    await user.click(button(/^Coverage/));
    expect(button(/^Group/)).toHaveAttribute("aria-expanded", "false");
    expect(button(/^Coverage/)).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("link", { name: /^Tops/ })).toBeNull();

    await user.click(button(/^Coverage/));
    expect(button(/^Coverage/)).toHaveAttribute("aria-expanded", "false");
  });

  it("points each chip at the control it opens", async () => {
    const user = userEvent.setup();
    await chips({ onSearch: vi.fn() });
    await user.click(button(/^Works at/));
    const panel = document.querySelector<HTMLElement>(
      `#${CSS.escape(button(/^Works at/).getAttribute("aria-controls") ?? "")}`,
    );
    if (panel === null) throw new Error("no panel");
    expect(panel).toBeVisible();
    expect(within(panel).getByRole("slider", { name: "Lowest" })).toBeVisible();
  });

  it("draws the open chip in ink and the rest outlined", async () => {
    await chips();
    expect(button(/^Group/)).toHaveClass(
      "rounded-pill",
      "border-hairline",
      "aria-expanded:bg-ink",
      "aria-expanded:text-ground",
    );
  });

  it("draws a panel's choices as ink-when-chosen pills that wrap", async () => {
    const user = userEvent.setup();
    await chips({ onSearch: vi.fn() });
    await user.click(button(/^Coverage/));
    expect(button(/^Covered/)).toHaveClass(
      "rounded-pill",
      "aria-pressed:bg-ink",
      "[&[aria-current]]:bg-ink",
    );
    expect(button(/^Covered/).closest("ul")).toHaveClass("flex-wrap");
  });

  it("shows every control open before hydration, where a chip cannot open one", async () => {
    const router = routed(filters({ variant: "chips" }));
    await router.load();
    const html = renderToString(<RouterProvider router={router} />);
    expect(html).not.toMatch(/\shidden(=""|\s|>)/u);
    expect(html.match(/aria-expanded="true"/gu)).toHaveLength(3);
    expect(html).toContain('method="get"');
  });
});

describe("ClosetFilters: the rail's look", () => {
  it("draws the rail as text rows, bold when chosen", async () => {
    await rail();
    expect(screen.getByRole("navigation")).toHaveAttribute("data-part", "rail");
    expect(link(/^All/)).toHaveClass(
      "[&[aria-current]]:font-bold",
      "aria-pressed:font-bold",
    );
    expect(link(/^All/)).not.toHaveClass("rounded-pill");
    expect(link(/^All/).closest("ul")).toHaveClass("flex-col");
  });

  it("gives every choice, link or toggle, the 44px target and ink text", async () => {
    await rail({ onSearch: vi.fn() });
    for (const choice of [link(/^All/), button(/^Covered/)]) {
      expect(choice).toHaveClass(
        "target",
        "flex",
        "items-center",
        "gap-2",
        "text-ink",
        "no-underline",
      );
    }
  });

  it("puts each count at the right of its row (Round 55 · 191b)", async () => {
    await rail({ onSearch: vi.fn() });
    for (const choice of [link(/^All/), button(/^Covered/)]) {
      expect(choice).toHaveClass("w-full", "justify-between");
    }
  });

  it("holds each label at its bold width, so choosing one never moves the grid", async () => {
    // C-11: Untested went bold, the rail widened, and the grid moved 5px.
    await rail();
    const label = link(/^All/).querySelector("[data-part='option-label']");
    expect(label).toHaveClass("inline-grid");
    const [shown, reserve] = [...(label?.children ?? [])];
    expect(shown).toHaveClass("col-start-1", "row-start-1");
    expect(shown).not.toHaveClass("invisible");
    expect(reserve).toHaveClass("invisible", "col-start-1", "row-start-1", "font-bold");
    expect(reserve).toHaveAttribute("aria-hidden", "true");
    expect(reserve?.textContent).toBe(shown?.textContent);
    // Heard once.
    expect(link(/^All/)).toHaveAccessibleName(/^All \d+$/);
  });

  it("keeps the chips' labels plain: a chip's width is its own", async () => {
    await chips();
    fireEvent.click(button(/^Group/));
    expect(
      screen.getByRole("link", { name: /^All/ }).querySelector(
        "[data-part='option-label']",
      ),
    ).toBeNull();
  });
});
