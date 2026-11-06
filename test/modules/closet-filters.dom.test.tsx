import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { UiGroup, VerdictCoverage } from "../../src/lib/contracts";
import {
  ClosetFilters,
  endsInC,
  type ClosetFiltersProps,
} from "../../src/modules/closet/components/ClosetFilters";
import type { RailCounts } from "../../src/modules/closet/filters";

/**
 * Closet C's rail (R-94, design 174), driven: GROUP and COVERAGE as links
 * that work before hydration, WORKS AT as a GET form that says its unit.
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

function rail(props: Partial<ClosetFiltersProps> = {}) {
  return renderWithRouter(
    <ClosetFilters
      variant="rail"
      search={{}}
      counts={COUNTS}
      span={{ lowC: 1.1, highC: 14.4 }}
      tempUnit="f"
      {...props}
    />,
  );
}

const link = (name: RegExp): HTMLElement => screen.getByRole("link", { name });
const href = (name: RegExp): string | null => link(name).getAttribute("href");

describe("ClosetFilters: GROUP", () => {
  it("lists All and the six groups with their counts, a missing one at 0", async () => {
    await rail();
    expect(link(/^All/)).toHaveTextContent("All 47");
    expect(link(/^Tops/)).toHaveTextContent("Tops 14");
    expect(link(/^Hands \/ head/)).toHaveTextContent("Hands / head 8");
    expect(link(/^Socks \/ extras/)).toHaveTextContent("Socks / extras 0");
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
    // Changing the group keeps the other filters; All drops only the group.
    expect(href(/^Shoes/)).toBe("/closet?group=shoes&coverage=partial");
    expect(href(/^All/)).toBe("/closet?coverage=partial");
  });
});

describe("ClosetFilters: COVERAGE", () => {
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

  it("sets a level, and clears it when the set level is tapped again", async () => {
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

describe("ClosetFilters: WORKS AT", () => {
  it("is a GET form to this page, with the closet's bounds as placeholders in the runner's unit", async () => {
    await rail();
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    const form = from.closest("form");
    expect(form).toHaveAttribute("method", "get");
    // No `action`: a form without one submits to the page it is on.
    expect(form).not.toHaveAttribute("action");
    expect(from).toHaveAttribute("placeholder", "34");
    expect(to).toHaveAttribute("placeholder", "58");
    expect(from).toHaveDisplayValue("");
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("opens with the asked ends in the runner's unit", async () => {
    await rail({ search: { from: 1.1, to: 14.4 } });
    expect(screen.getByLabelText("From")).toHaveValue(34);
    expect(screen.getByLabelText("To")).toHaveValue(58);
  });

  it("names its unit, and carries the other filters only when they are set", async () => {
    const { container } = await rail();
    const hidden = (): string[] =>
      [...container.querySelectorAll("input[type='hidden']")].map(
        (input) =>
          `${input.getAttribute("name") ?? ""}=${input.getAttribute("value") ?? ""}`,
      );
    expect(hidden()).toStrictEqual(["unit=f"]);
  });

  it("carries group, coverage and retired through a submit", async () => {
    const { container } = await rail({
      search: { group: "outer", coverage: "covered", retired: true },
      tempUnit: "c",
    });
    const hidden = [...container.querySelectorAll("input[type='hidden']")].map(
      (input) =>
        `${input.getAttribute("name") ?? ""}=${input.getAttribute("value") ?? ""}`,
    );
    expect(hidden).toStrictEqual([
      "unit=c",
      "group=outer",
      "coverage=covered",
      "retired=true",
    ]);
  });

  it("navigates in Celsius once hydrated, an empty end left open", async () => {
    const onWorksAt = vi.fn();
    await rail({ onWorksAt });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "34" },
    });
    const isSubmitted = fireEvent.submit(
      screen.getByRole("button", { name: "Apply" }),
    );
    expect(isSubmitted).toBe(false);
    expect(onWorksAt).toHaveBeenCalledExactlyOnceWith({ from: 1.1 });
  });

  it("submits as a plain GET when nothing handles it", async () => {
    await rail();
    const isSubmitted = fireEvent.submit(
      screen.getByRole("button", { name: "Apply" }),
    );
    expect(isSubmitted).toBe(true);
  });

  it("offers no Any while no span is set", async () => {
    await rail();
    expect(screen.queryByRole("link", { name: "Any" })).toBeNull();
  });

  it("links Any to the closet without the span", async () => {
    await rail({ search: { from: 1.1, group: "tops" } });
    expect(screen.getByRole("link", { name: "Any" })).toHaveAttribute(
      "href",
      "/closet?group=tops",
    );
  });

  it("says Untested and draws no form when no piece states a range", async () => {
    await rail({ span: undefined });
    expect(screen.queryByLabelText("From")).toBeNull();
    const worksAt = screen
      .getByRole("heading", { name: "Works at" })
      .closest("section");
    expect(worksAt?.querySelector("p")).toHaveTextContent("[Untested]");
  });
});

const span = (): HTMLElement => {
  const bar = document.querySelector<HTMLElement>("[data-part='span']");
  if (bar === null) throw new Error("no span");
  return bar;
};

describe("ClosetFilters: the span bar", () => {
  it("fills the whole track while nothing is asked", async () => {
    await rail({ span: { lowC: 0, highC: 20 } });
    expect(span().style.left).toBe("0%");
    expect(span().style.right).toBe("0%");
    expect(document.querySelector("[data-part='span-bar']")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("fills the asked part, from each end", async () => {
    await rail({ span: { lowC: 0, highC: 20 }, search: { from: 5, to: 15 } });
    expect(span().style.left).toBe("25%");
    expect(span().style.right).toBe("25%");
  });

  it("stays inside the track when an end is asked beyond it", async () => {
    await rail({ span: { lowC: 0, highC: 20 }, search: { from: -5, to: 40 } });
    expect(span().style.left).toBe("0%");
    expect(span().style.right).toBe("0%");
  });

  it("clamps an end asked past the other bound", async () => {
    await rail({ span: { lowC: 0, highC: 20 }, search: { from: 30, to: -10 } });
    expect(span().style.left).toBe("100%");
    expect(span().style.right).toBe("100%");
  });

  it("draws a closet of one temperature without dividing by zero", async () => {
    await rail({ span: { lowC: 5, highC: 5 } });
    expect(span().style.left).toBe("0%");
    expect(span().style.right).toBe("100%");
  });
});

describe("ClosetFilters: rail and chips", () => {
  it("draws the rail as text rows, bold when chosen", async () => {
    await rail();
    expect(screen.getByRole("navigation")).toHaveAttribute("data-part", "rail");
    expect(link(/^All/)).toHaveClass("aria-[current=true]:font-bold");
    expect(link(/^All/)).not.toHaveClass("rounded-pill");
    expect(link(/^All/).closest("ul")).toHaveClass("flex-col");
  });

  it("draws chips as ink-when-chosen pills that wrap", async () => {
    await rail({ variant: "chips" });
    expect(screen.getByRole("navigation")).toHaveAttribute(
      "data-part",
      "chips",
    );
    expect(link(/^All/)).toHaveClass(
      "rounded-pill",
      "aria-[current=true]:bg-ink",
    );
    expect(link(/^All/).closest("ul")).toHaveClass("flex-wrap");
  });

  it("folds WORKS AT into one chip that names the asked span", async () => {
    await rail({ variant: "chips", search: { from: 1.1, to: 14.4 } });
    const chip = screen.getByText("Works at", { selector: "summary *" });
    const summary = chip.closest("summary");
    expect(summary).toHaveTextContent("Works at[34–58°]");
    expect(summary?.closest("details")).not.toHaveAttribute("open");
    expect(
      within(summary?.closest("details") ?? document.body).getByLabelText(
        "From",
      ),
    ).toHaveValue(34);
  });

  it("names no span on the chip while none is asked", async () => {
    await rail({ variant: "chips" });
    const summary = screen
      .getByText("Works at", { selector: "summary *" })
      .closest("summary");
    expect(summary).toHaveTextContent(/^Works at$/);
  });
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
}

describe("endsInC", () => {
  it("converts each filled end from the runner's unit", () => {
    expect(endsInC(form({ from: "34", to: "58" }), "f")).toStrictEqual({
      from: 1.1,
      to: 14.4,
    });
    expect(endsInC(form({ from: "4", to: "12" }), "c")).toStrictEqual({
      from: 4,
      to: 12,
    });
  });

  it("leaves an empty, blank or unreadable end open", () => {
    expect(endsInC(form({ from: "", to: "  " }), "c")).toStrictEqual({});
    expect(endsInC(form({ from: "warm", to: "12" }), "c")).toStrictEqual({
      to: 12,
    });
    expect(endsInC(form({}), "c")).toStrictEqual({});
  });
});
