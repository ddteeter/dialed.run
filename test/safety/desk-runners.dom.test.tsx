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
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DeskRunners,
  metaLine,
  renameMessage,
} from "../../src/modules/safety/components/DeskRunners";
import {
  Takedown,
  takedownMessage,
} from "../../src/modules/safety/components/Takedown";
import type { DeskRunner } from "../../src/modules/safety/runners";
import { bracketed } from "../ui/bracketed";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

/**
 * D8 (round 27 #22), its Rename (#16) and Close account (D3), and SAF-6's
 * takedown form — what an operator can do, and what they are told.
 */

type Props = Parameters<typeof DeskRunners>[0];

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

const ada: DeskRunner = {
  userId: "u-ada",
  username: "ada",
  email: "ada@example.com",
  joinedAt: 1_757_000_000,
  runs: 12,
  reports: 2,
  state: "ACTIVE",
  banReason: undefined,
  flaggedAt: undefined,
};

const bo: DeskRunner = {
  userId: "u-bo",
  username: undefined,
  email: "bo@example.com",
  joinedAt: 1_700_000_000,
  runs: 0,
  reports: 0,
  state: "CLOSED",
  banReason: "Spam accounts",
  flaggedAt: undefined,
};

const COUNTS = { all: 412, reported: 9, closed: 6, flagged: 0 } as const;

async function renderDesk(overrides: Partial<Props> = {}) {
  const rename = vi
    .fn<Props["rename"]>()
    .mockResolvedValue({ kind: "renamed", username: "runner_4821" });
  const ban = vi.fn<Props["ban"]>().mockResolvedValue({ banned: true });
  const unban = vi.fn<Props["unban"]>().mockResolvedValue({ banned: false });
  const keep = vi.fn<Props["keep"]>().mockResolvedValue({ kept: true });
  const router = await renderWithRouter(
    <DeskRunners
      runners={[ada, bo]}
      counts={COUNTS}
      filter={{ filter: "all" }}
      rename={rename}
      ban={ban}
      unban={unban}
      keep={keep}
      {...overrides}
    />,
  );
  return { rename, ban, unban, keep, router };
}

describe("D8's table", () => {
  it("counts every account and draws one row per runner", async () => {
    await renderDesk();

    expect(
      screen.getByText(bracketed("412 accounts · newest first")),
    ).toBeInTheDocument();
    const [header, first, second] = screen.getAllByRole("row");
    expect(header).toHaveTextContent("HandleEmailJoinedRunsReportsState");
    // Below `wide` the email also sits under the handle (a guess, 168.3).
    expect(first).toHaveTextContent(
      "@adaada@example.comada@example.com2025-09-04122[ACTIVE]",
    );
    expect(second).toHaveTextContent(
      "—bo@example.combo@example.com2023-11-1400[CLOSED]",
    );
  });

  it("heads each column as its cells are set: padded, numbers right, the pane's columns hidden below wide", async () => {
    await renderDesk();

    const heads = screen.getAllByRole("columnheader");
    expect(heads.map((head) => head.textContent)).toEqual([
      "Handle",
      "Email",
      "Joined",
      "Runs",
      "Reports",
      "State",
    ]);
    for (const head of heads) {
      expect(head).toHaveClass("px-3", "py-3", "align-baseline");
    }
    const [handle, email, joined, runs, reports, state] = heads;
    expect(email).toHaveClass("max-wide:hidden");
    expect(joined).toHaveClass("max-wide:hidden");
    expect(runs).toHaveClass("text-right", "max-wide:hidden");
    expect(reports).toHaveClass("text-right");
    for (const shown of [handle, reports, state]) {
      expect(shown).not.toHaveClass("max-wide:hidden");
    }
    expect(handle).not.toHaveClass("text-right");
  });

  it("keeps every cell to one line, full values in titles (168.3)", async () => {
    await renderDesk();

    const [, first] = screen.getAllByRole("row");
    const cells = within(first ?? document.body).getAllByRole("cell");
    const [handle, email, joined, runs, reports, state] = cells;
    expect(within(handle ?? document.body).getByRole("button")).toHaveAttribute(
      "title",
      "@ada",
    );
    expect(within(handle ?? document.body).getByRole("button")).toHaveClass(
      "truncate",
    );
    expect(email).toHaveAttribute("title", "ada@example.com");
    expect(email).toHaveClass("max-wide:hidden", "w-1/3");
    // Truncated inside a one-track grid, so the column never widens to the
    // text, and no width is pinned (DS4).
    const cut = email?.firstElementChild;
    expect(cut).toHaveClass("grid", "grid-cols-[minmax(0,1fr)]");
    expect(cut?.firstElementChild).toHaveClass("truncate");
    expect(
      within(handle ?? document.body).getByRole("button").parentElement,
    ).toHaveClass("grid", "grid-cols-[minmax(0,1fr)]");
    expect(joined).toHaveClass("whitespace-nowrap", "max-wide:hidden");
    expect(runs).toHaveClass("text-right", "max-wide:hidden");
    expect(reports).toHaveClass("text-right");
    expect(reports).not.toHaveClass("max-wide:hidden");
    expect(state?.firstElementChild).toHaveClass(
      "flex-wrap",
      "wide:flex-nowrap",
    );
    expect(state?.firstElementChild?.firstElementChild).toHaveClass(
      "whitespace-nowrap",
    );
    expect(
      within(handle ?? document.body).getByTitle("ada@example.com"),
    ).toHaveClass("wide:hidden");
  });

  it("marks the current filter, counts each, and links the others", async () => {
    await renderDesk({ filter: { filter: "reported", query: "ad" } });

    const filters = screen.getByRole("navigation", { name: "Filter runners" });
    const reported = within(filters).getByRole("link", { name: /^Reported/u });
    expect(reported).toHaveAttribute("aria-current", "page");
    expect(reported).toHaveClass("font-semibold", "text-ink", "underline");
    const all = within(filters).getByRole("link", { name: /^All/u });
    expect(all).toHaveAttribute("href", "/desk/runners?query=ad&filter=all");
    expect(all).not.toHaveAttribute("aria-current");
    expect(all).toHaveClass("text-quiet");
    expect(all).not.toHaveClass("underline");
    expect(
      within(filters).getByRole("link", { name: /^Closed/u }),
    ).toHaveAttribute("href", "/desk/runners?query=ad&filter=closed");
    expect(
      within(filters)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toStrictEqual(["All [412]", "Reported [9]", "Closed [6]", "Flagged [0]"]);
  });

  it("says how many match, and where (round 28 #8)", () => {
    const counts = { all: 412, reported: 9, closed: 6, flagged: 2 };
    expect(metaLine({ filter: "all" }, 100, counts)).toBe(
      "412 accounts · newest first",
    );
    expect(metaLine({ filter: "all", query: "" }, 100, counts)).toBe(
      "412 accounts · newest first",
    );
    expect(metaLine({ filter: "all", query: "qz" }, 2, counts)).toBe("2 match");
    expect(metaLine({ filter: "reported", query: "qz" }, 2, counts)).toBe(
      "2 match in Reported",
    );
    expect(metaLine({ filter: "closed" }, 100, counts)).toBe(
      "6 match in Closed",
    );
    expect(metaLine({ filter: "flagged", query: "" }, 100, counts)).toBe(
      "2 match in Flagged",
    );
  });

  it("says no runner matches a search where the first row would be", async () => {
    await renderDesk({ runners: [], filter: { filter: "all", query: "qz9" } });

    const [, empty] = screen.getAllByRole("row");
    expect(empty).toHaveTextContent(
      'No runner matches "qz9".Search by handle without the @, or by the whole email.',
    );
    expect(within(empty ?? document.body).getByRole("cell")).toHaveAttribute(
      "colspan",
      "6",
    );
  });

  it("says nobody is in a filter with no search (owner, 2026-11-12)", async () => {
    await renderDesk({ runners: [], filter: { filter: "flagged" } });

    const [, empty] = screen.getAllByRole("row");
    expect(empty).toHaveTextContent(/^Nobody in Flagged\.$/u);
  });

  it("draws no empty row when there are runners", async () => {
    await renderDesk({ filter: { filter: "all", query: "a" } });
    expect(screen.queryByText(/No runner matches/u)).toBeNull();
    expect(screen.queryByText(/Nobody in/u)).toBeNull();
  });

  it("searches by navigating, keeping the filter", async () => {
    const user = userEvent.setup();
    const { router } = await renderDesk({ filter: { filter: "closed" } });

    await user.type(screen.getByRole("searchbox"), "bo");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/desk/runners");
    });
    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        query: "bo",
        filter: "closed",
      });
    });
  });

  it("starts the search box on what was searched", async () => {
    await renderDesk({ filter: { filter: "all", query: "ad" } });
    expect(screen.getByRole("searchbox")).toHaveValue("ad");
  });

  it("sets what the operator types in TYPE.field, at RADIUS.field", async () => {
    // tokens.js names the Desk search in both jobs (round 28 #1).
    await renderDesk({ filter: { filter: "all", query: "" } });
    expect(screen.getByRole("searchbox")).toHaveClass(
      "text-field",
      "rounded-field",
    );
  });
});

describe("selecting a runner", () => {
  it("asks for a pick first, then shows Rename above Close account", async () => {
    const user = userEvent.setup();
    await renderDesk();

    expect(
      screen.getByText("Pick a runner to rename or close."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    const column = screen.getByRole("complementary", { name: "@ada" });
    const headings = within(column).getAllByRole("heading");
    expect(headings.map((h) => h.textContent)).toStrictEqual([
      "Rename",
      "Close account",
    ]);
    expect(screen.getByRole("row", { selected: true })).toHaveTextContent(
      "@ada",
    );
  });

  it("marks the picked row and heads the pane with whose it is (N3-02)", async () => {
    const user = userEvent.setup();
    await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    const row = screen.getByRole("row", { selected: true });
    expect(row).toHaveClass("group", "aria-selected:bg-panel");
    expect(row.firstElementChild).toHaveClass(
      "border-l-3",
      "border-transparent",
      "group-aria-selected:border-hi-viz",
    );
    const pane = screen.getByRole("complementary", { name: "@ada" });
    expect(pane).toHaveClass("bg-panel", "desk:sticky");
    expect(pane.firstElementChild).toHaveTextContent(
      "@adaada@example.com[ACTIVE]12 runs · 2 reports on name · joined 2025-09-04",
    );
    expect(
      screen.queryByText("Pick a runner to rename or close."),
    ).not.toBeInTheDocument();
  });

  it("counts one run and one report in the singular", async () => {
    const user = userEvent.setup();
    await renderDesk({ runners: [{ ...ada, runs: 1, reports: 1 }] });
    await user.click(screen.getByRole("button", { name: "@ada" }));

    const line = screen.getByText(/^joined 2025-09-04$/u);
    // The date never breaks from its word (168.3).
    expect(line).toHaveClass("whitespace-nowrap");
    expect(line.parentElement).toHaveTextContent(
      /^1 run · 1 report on name · joined 2025-09-04$/u,
    );
  });

  it("names a runner with no handle by their email", async () => {
    const user = userEvent.setup();
    await renderDesk();
    const bosRow = screen.getAllByRole("row")[2];
    await user.click(bosRow ?? document.body);
    expect(
      screen.getByRole("complementary", { name: "@bo@example.com" }),
    ).toBeInTheDocument();
  });
});

/**
6 November 2025, 12:00 UTC: when ada's flag opened.
*/
const FLAGGED_AT = Date.UTC(2025, 10, 6, 12) / 1000;

/**
 * D8 over a list the test swaps, as a reload or another filter would:
 * "Next list" draws the next one.
 */
function NextList({
  lists,
}: Readonly<{ lists: readonly (readonly DeskRunner[])[] }>) {
  const [at, setAt] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAt(at + 1);
        }}
      >
        Next list
      </button>
      <DeskRunners
        runners={lists[at] ?? []}
        counts={{ ...COUNTS, flagged: 1 }}
        filter={{ filter: "all" }}
        rename={vi.fn<Props["rename"]>()}
        ban={vi.fn<Props["ban"]>()}
        unban={vi.fn<Props["unban"]>()}
        keep={vi.fn<Props["keep"]>().mockResolvedValue({ kept: true })}
      />
    </>
  );
}

describe("a flagged account (D-161 1, R47·124) and PENDING DELETE (PR#126-1)", () => {
  it("offers Flagged last among the filters, with its count, even at 0", async () => {
    await renderDesk({
      filter: { filter: "flagged" },
      counts: { ...COUNTS, flagged: 0 },
    });

    const filters = screen.getByRole("navigation", { name: "Filter runners" });
    expect(
      within(filters)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toStrictEqual(["All [412]", "Reported [9]", "Closed [6]", "Flagged [0]"]);
    const chip = within(filters).getByRole("link", { name: /^Flagged/u });
    expect(chip).toHaveAttribute("aria-current", "page");
    expect(chip).toHaveAttribute("href", "/desk/runners?filter=flagged");
    expect(within(chip).getByText(bracketed("0"))).toBeInTheDocument();
  });

  it("counts the flagged accounts on the chip", async () => {
    await renderDesk({ counts: { ...COUNTS, flagged: 3 } });

    const filters = screen.getByRole("navigation", { name: "Filter runners" });
    expect(
      within(filters).getByRole("link", { name: /^Flagged/u }),
    ).toHaveTextContent("Flagged [3]");
  });

  it("marks a flagged row beside its state, in hi-viz, and no other row", async () => {
    await renderDesk({ runners: [{ ...ada, flaggedAt: FLAGGED_AT }, bo] });

    const [, first, second] = screen.getAllByRole("row");
    const mark = within(first ?? document.body).getByText(bracketed("Flagged"));
    expect(mark).toHaveClass("text-hiviz-text");
    expect(first).toHaveTextContent("[ACTIVE][Flagged]");
    expect(
      within(second ?? document.body).queryByText(bracketed("Flagged")),
    ).toBeNull();
  });

  it("draws PENDING DELETE as a state", async () => {
    await renderDesk({ runners: [{ ...ada, state: "PENDING DELETE" }] });

    expect(screen.getByText(bracketed("PENDING DELETE"))).toBeInTheDocument();
  });

  it("puts the flag at the top of the column, dated, never saying intimate", async () => {
    const user = userEvent.setup();
    await renderDesk({ runners: [{ ...ada, flaggedAt: FLAGGED_AT }] });
    await user.click(screen.getByRole("button", { name: "@ada" }));

    const column = screen.getByRole("complementary", { name: "@ada" });
    expect(
      within(column)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toStrictEqual(["Flagged", "Rename", "Close account"]);
    const flagHeading = within(column).getByRole("heading", {
      name: "Flagged",
    });
    expect(flagHeading.firstElementChild).toHaveClass("text-hiviz-text");
    expect(flagHeading.closest("section")).toHaveClass("border-hiviz-text");
    expect(
      within(column).getByText(
        "A takedown of an image they posted was upheld on Nov 6. Nothing has happened to the account. Keep it, or ban it below.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/intimate/iu);
    expect(
      within(column).getByRole("button", { name: "Keep account" }),
    ).toHaveClass("rounded-pill", "border-ink", "bg-transparent");
  });

  it("keeps on Keep account, reloads, and hands focus to the runner's name", async () => {
    const user = userEvent.setup();
    const { keep, router } = await renderDesk({
      runners: [{ ...ada, flaggedAt: FLAGGED_AT }],
    });
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Keep account" }));

    expect(keep).toHaveBeenCalledWith({ data: { userId: "u-ada" } });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "@ada" })).toHaveFocus();
    });
  });

  it("hands focus to the name after a ban of a flagged runner too", async () => {
    const user = userEvent.setup();
    await renderDesk({ runners: [{ ...ada, flaggedAt: FLAGGED_AT }, bo] });
    await user.click(screen.getByRole("button", { name: "@ada" }));
    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Serious");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule/ }),
      "Post sexual or explicit content",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "@ada" })).toHaveFocus();
    });
  });

  it("leaves focus alone after a ban of an unflagged runner", async () => {
    const user = userEvent.setup();
    const { ban, router } = await renderDesk();
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "@ada" }));
    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Serious");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule/ }),
      "Post sexual or explicit content",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(await screen.findByText("Account closed.")).toBeInTheDocument();
    expect(ban).toHaveBeenCalled();
    // The reload is the decision's last step: focus would have moved by then.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "@ada" })).not.toHaveFocus();
  });

  it("says it is still flagged when Keep account fails", async () => {
    const user = userEvent.setup();
    const keep = vi
      .fn<Props["keep"]>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await renderDesk({ keep, runners: [{ ...ada, flaggedAt: FLAGGED_AT }] });
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Keep account" }));

    expect(await screen.findByText("Still flagged")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@ada" })).not.toHaveFocus();
  });

  it("starts each flagged runner's flag afresh", async () => {
    const user = userEvent.setup();
    const keep = vi
      .fn<Props["keep"]>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await renderDesk({
      keep,
      runners: [
        { ...ada, flaggedAt: FLAGGED_AT },
        { ...ada, userId: "u-di", username: "di", flaggedAt: FLAGGED_AT },
      ],
    });
    await user.click(screen.getByRole("button", { name: "@ada" }));
    await user.click(screen.getByRole("button", { name: "Keep account" }));
    expect(await screen.findByText("Still flagged")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "@di" }));

    expect(screen.queryByText("Still flagged")).not.toBeInTheDocument();
  });

  it("hands focus to the name once, not to a later list that draws the row again", async () => {
    const user = userEvent.setup();
    const flaggedAda = { ...ada, flaggedAt: FLAGGED_AT };
    await renderWithRouter(
      <NextList lists={[[flaggedAda, bo], [bo], [ada, bo]]} />,
    );
    await user.click(screen.getByRole("button", { name: "@ada" }));
    await user.click(screen.getByRole("button", { name: "Keep account" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "@ada" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Next list" }));
    await user.click(screen.getByRole("button", { name: "Next list" }));

    expect(screen.getByRole("button", { name: "@ada" })).not.toHaveFocus();
  });

  it("shows no flag on a closed account, which Reopen answers", async () => {
    const user = userEvent.setup();
    await renderDesk({ runners: [{ ...bo, flaggedAt: FLAGGED_AT }] });
    await user.click(screen.getByRole("button", { name: "—" }));

    expect(
      screen.queryByRole("button", { name: "Keep account" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reopen account" }),
    ).toBeInTheDocument();
  });
});

describe("Rename (round 27 #16)", () => {
  it("renames with a reason from the fixed list, and says to what", async () => {
    const user = userEvent.setup();
    const { rename } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Pretends to be someone else",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(rename).toHaveBeenCalledWith({
      data: { userId: "u-ada", nameReason: "Pretends to be someone else" },
    });
    expect(
      await screen.findByText("Renamed to @runner_4821."),
    ).toBeInTheDocument();
  });

  it("refuses a rename with no reason", async () => {
    const user = userEvent.setup();
    const { rename } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(rename).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick why the name has to go.");
    expect(said.length).toBeGreaterThan(0);
  });

  it("tells the operator each outcome", () => {
    expect(renameMessage({ kind: "renamed", username: "runner_0042" })).toBe(
      "Renamed to @runner_0042.",
    );
    expect(renameMessage({ kind: "taken" })).toBe(
      "That placeholder is taken. Press Rename again.",
    );
    expect(renameMessage({ kind: "moved", username: "dunk_runs" })).toBe(
      "The handle changed to @dunk_runs before the rename landed. Nothing was renamed. Look at it, then press Rename again if it still has to go.",
    );
    expect(renameMessage({ kind: "not_found" })).toBe(
      "This runner has no handle to take away.",
    );
  });
});

describe("Close account (D3)", () => {
  it("closes with the reason their notice quotes, and the rule it names", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule it breaks/ }),
      "Post spam, advertising or promotion we have not allowed",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).toHaveBeenCalledWith({
      data: { userId: "u-ada", reason: "Spam", rule: "spam" },
    });
  });

  it("closes over suspected CSAM naming no rule (C8)", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Closed");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule it breaks/ }),
      "Suspected CSAM (the notice names no rule)",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).toHaveBeenCalledWith({
      data: { userId: "u-ada", reason: "Closed", rule: "suspected_csam" },
    });
  });

  it("refuses to close without a rule, in the schema's words", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick the rule it breaks.");
    expect(said.length).toBeGreaterThan(0);
  });

  it("treats a rule taken back as nothing chosen", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));
    const rule = screen.getByRole("combobox", { name: /Which rule it breaks/ });

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.selectOptions(rule, "Harass anyone");
    await user.selectOptions(rule, "Not set");
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).not.toHaveBeenCalled();
  });

  it("refuses to close without a reason", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).not.toHaveBeenCalled();
  });

  it("names both empty fields in the summary by their labels (P3-07)", async () => {
    const user = userEvent.setup();
    await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(await screen.findByText("2 fields need a fix.")).toBeInTheDocument();
    expect(screen.getByText(/^Why — /u)).toBeInTheDocument();
    expect(screen.getByText(/^Which rule it breaks — /u)).toBeInTheDocument();
  });

  it("offers a closed account its reason and Reopen instead", async () => {
    const user = userEvent.setup();
    const { unban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "—" }));

    expect(screen.getByText("Spam accounts")).toBeInTheDocument();
    const closedHeading = screen.getByRole("heading", {
      name: "Account closed",
    });
    expect(closedHeading.firstElementChild).not.toHaveClass("text-hiviz-text");
    expect(closedHeading.closest("section")).toHaveClass("border-hairline");
    expect(
      screen.queryByRole("button", { name: "Close account" }),
    ).not.toBeInTheDocument();
    const reopen = screen.getByRole("button", { name: "Reopen account" });
    // Round 44 #104: the closed runner's one action is the chalk pill.
    expect(reopen).toHaveClass("target", "rounded-pill", "bg-ink");
    await user.click(reopen);

    expect(unban).toHaveBeenCalledWith({ data: { userId: "u-bo" } });
  });

  it("says a closed account is still closed when Reopen fails", async () => {
    const user = userEvent.setup();
    const unban = vi
      .fn<Props["unban"]>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await renderDesk({
      unban,
      runners: [{ ...bo, banReason: undefined }],
    });
    await user.click(screen.getByRole("button", { name: "—" }));
    expect(screen.getByText("No reason recorded.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reopen account" }));

    expect(await screen.findByText("Still closed")).toBeInTheDocument();
  });
});

describe("after an action", () => {
  const cy: DeskRunner = {
    ...ada,
    userId: "u-cy",
    username: "cy",
    email: "cy@example.com",
  };

  it.each([
    [{ kind: "moved", username: "dunk_runs" }, /changed to @dunk_runs/u],
    [{ kind: "taken" }, /That placeholder is taken/u],
  ] as const)(
    "says a rename that did not happen in the control band, under NOT RENAMED (round 38 #60)",
    async (outcome, sentence) => {
      const user = userEvent.setup();
      await renderDesk({
        rename: vi.fn<Props["rename"]>().mockResolvedValue(outcome),
      });
      await user.click(screen.getByRole("button", { name: "@ada" }));

      await user.selectOptions(
        screen.getByRole("combobox", { name: /Why the name has to go/ }),
        "Advertising",
      );
      await user.click(screen.getByRole("button", { name: "Rename" }));

      const band = await waitFor(() => {
        const found = document.querySelector("[data-part='control-failure']");
        expect(found).not.toBeNull();
        return found;
      });
      expect(band).toHaveTextContent(/^Not renamed/u);
      expect(band).toHaveTextContent(sentence);
      // No Try again: the sentence says to press Rename.
      expect(band?.querySelector("button")).toBeNull();
    },
  );

  it("says a runner with no handle as a line, not a band", async () => {
    const user = userEvent.setup();
    await renderDesk({
      rename: vi.fn<Props["rename"]>().mockResolvedValue({ kind: "not_found" }),
    });
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(
      await screen.findByText("This runner has no handle to take away."),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-part='control-failure']")).toBeNull();
  });

  it("keeps the search in the page rather than submitting the form", async () => {
    await renderDesk();
    const search = screen.getByRole("search");
    expect(fireEvent.submit(search)).toBe(false);
  });

  it("renames, says so, and reloads the page's data", async () => {
    const user = userEvent.setup();
    const { router } = await renderDesk();
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(await screen.findByText("Rename sent.")).toBeInTheDocument();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("treats a rename reason taken back as nothing chosen", async () => {
    const user = userEvent.setup();
    const { rename } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));
    const picker = screen.getByRole("combobox", {
      name: /Why the name has to go/,
    });

    await user.selectOptions(picker, "Advertising");
    expect(picker).toHaveDisplayValue("Advertising");
    await user.selectOptions(picker, "Not set");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(rename).not.toHaveBeenCalled();
    expect(picker).toHaveDisplayValue("Not set");
  });

  it("says nothing in Rename before it is pressed", async () => {
    const user = userEvent.setup();
    await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));
    const rename = screen.getByRole("form", { name: "Rename" });
    expect(rename.querySelectorAll("p")).toHaveLength(1);
  });

  it("closes, says so, and reloads the page's data", async () => {
    const user = userEvent.setup();
    const { router } = await renderDesk();
    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule it breaks/ }),
      "Harass anyone",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(await screen.findByText("Account closed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalled();
    });
  });

  it("starts each runner's panels afresh", async () => {
    const user = userEvent.setup();
    await renderDesk({ runners: [ada, cy] });
    await user.click(screen.getByRole("button", { name: "@ada" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");

    await user.click(screen.getByRole("button", { name: "@cy" }));

    expect(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
    ).toHaveDisplayValue("Not set");
    expect(screen.getByRole("textbox", { name: /Why/ })).toHaveValue("");
  });
});

/**
An action that never answers, so its pending state stays on screen.
*/
function never(): Promise<never> {
  return new Promise<never>(() => {
    // Never settles.
  });
}

describe("while an action is in flight", () => {
  it("names each pending action", async () => {
    const user = userEvent.setup();
    await renderDesk({ rename: vi.fn(never), ban: vi.fn(never) });
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Why the name has to go/ }),
      "Advertising",
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Which rule it breaks/ }),
      "Harass anyone",
    );
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(await screen.findByText("Renaming")).toBeInTheDocument();
    expect(await screen.findByText("Closing")).toBeInTheDocument();
  });

  it("names a pending takedown", async () => {
    const user = userEvent.setup();
    render(<Takedown takeDown={vi.fn(never)} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: /What it is/ }),
      "A photo",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Its id/ }),
      "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    );
    await user.type(screen.getByRole("textbox", { name: /The notice/ }), "x");
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    expect(await screen.findByText("Taking it down")).toBeInTheDocument();
  });

  it("keeps a Desk form in the page, and names only a titled one", () => {
    render(<Takedown takeDown={vi.fn(never)} />);
    const form = document.querySelector("form");
    if (form === null) throw new Error("no form");
    expect(form).not.toHaveAttribute("aria-labelledby");
    expect(fireEvent.submit(form)).toBe(false);
    // Its own layout, held to the column on a wide Desk page (168.3).
    expect(form).toHaveClass("flex", "flex-col", "gap-4", "max-w-column");
  });
});

describe("Takedown (SAF-6)", () => {
  it("heads its section with a kicker, like its siblings on Review (G-15)", () => {
    render(<Takedown takeDown={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Takedown" });
    expect(heading).not.toHaveClass("font-display");
    expect(heading.firstElementChild).toHaveClass("font-mono", "text-mono-xs");
  });

  it("opens with nothing chosen", () => {
    render(<Takedown takeDown={vi.fn()} />);
    const picker = screen.getByRole("combobox", {
      name: /What it is/,
    });
    expect(picker).toHaveDisplayValue("Not set");
    // The empty option is chosen, not merely shown: a value no option
    // holds leaves nothing selected.
    if (!(picker instanceof HTMLSelectElement))
      throw new TypeError("no select");
    expect(picker.selectedIndex).toBe(0);
    expect(picker.value).toBe("");
  });

  type TakeDown = Parameters<typeof Takedown>[0]["takeDown"];

  it("takes a named photo down against its notice, and says so", async () => {
    const user = userEvent.setup();
    const takeDown = vi
      .fn<TakeDown>()
      .mockResolvedValue({ outcome: "removed" });
    render(<Takedown takeDown={takeDown} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /What it is/ }),
      "A photo",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Its id/ }),
      "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    );
    await user.type(
      screen.getByRole("textbox", { name: /The notice/ }),
      "Acme, ref 114",
    );
    await user.click(screen.getByRole("button", { name: "Take it down" }));

    expect(takeDown).toHaveBeenCalledWith({
      data: {
        subjectType: "photo",
        subjectId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        notice: "Acme, ref 114",
      },
    });
    expect(
      await screen.findByText(takedownMessage("removed")),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Takedown sent.");
    });
  });

  it("says nothing before anything has been submitted", () => {
    const { container } = render(<Takedown takeDown={vi.fn<TakeDown>()} />);

    // Any non-empty initial value for `said` would render this paragraph
    // immediately, which would read as a confirmation nobody asked for.
    expect(container.querySelector("p")).toBeNull();
  });

  it("offers exactly the two subjects, by the words a reviewer reads", () => {
    render(<Takedown takeDown={vi.fn<TakeDown>()} />);

    const select = screen.getByRole("combobox", { name: /What it is/ });
    const options = within(select)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toStrictEqual(["Not set", "A photo", "A whole entry"]);
  });

  it("takes a whole entry down too", async () => {
    const user = userEvent.setup();
    const takeDown = vi
      .fn<TakeDown>()
      .mockResolvedValue({ outcome: "removed" });
    render(<Takedown takeDown={takeDown} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /What it is/ }),
      "A whole entry",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Its id/ }),
      "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    );
    await user.type(
      screen.getByRole("textbox", { name: /The notice/ }),
      "Acme, ref 114",
    );
    await user.click(screen.getByRole("button", { name: "Take it down" }));

    expect(takeDown).toHaveBeenCalledWith({
      data: {
        subjectType: "entry",
        subjectId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        notice: "Acme, ref 114",
      },
    });
  });

  it("refuses an empty form with the schema's sentences, labelled by field", async () => {
    const user = userEvent.setup();
    const takeDown = vi.fn<TakeDown>();
    render(<Takedown takeDown={takeDown} />);

    await user.click(screen.getByRole("button", { name: "Take it down" }));

    expect(takeDown).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick a photo or an entry.");
    expect(said.length).toBeGreaterThan(0);
    // Three empty fields fail together, which is exactly when the summary
    // renders and its rows' labels — otherwise unobservable — are shown.
    expect(screen.getByText("3 fields need a fix.")).toBeInTheDocument();
    expect(
      screen.getByText("What it is — Pick a photo or an entry."),
    ).toBeInTheDocument();
    expect(screen.getByText("Its id — not a ULID")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The notice — Say who sent the notice and its reference.",
      ),
    ).toBeInTheDocument();
  });

  it("treats a kind picked and then taken back as nothing chosen", async () => {
    const user = userEvent.setup();
    const takeDown = vi.fn<TakeDown>();
    render(<Takedown takeDown={takeDown} />);
    const picker = screen.getByRole("combobox", { name: /What it is/ });

    await user.selectOptions(picker, "A photo");
    expect(picker).toHaveDisplayValue("A photo");
    await user.selectOptions(picker, "Not set");
    await user.click(screen.getByRole("button", { name: "Take it down" }));

    expect(takeDown).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick a photo or an entry.");
    expect(said.length).toBeGreaterThan(0);
    expect(picker).toHaveDisplayValue("Not set");
  });

  it("tells the operator each outcome", () => {
    expect(takedownMessage("removed")).toBe(
      "Taken down. The runner has been told, and the notice is on record.",
    );
    expect(takedownMessage("already_removed")).toBe(
      "Already taken down. Nothing more was sent or recorded.",
    );
    expect(takedownMessage("not_found")).toBe(
      "Nothing has that id. Check it against the notice.",
    );
  });
});

describe("D8 and Takedown: a lapsed session (Au7, D-155)", () => {
  it("carries page to log-in", async () => {
    carriedSince();
    await renderDesk();
    await userEvent.setup().click(screen.getByRole("button", { name: "@ada" }));
    render(<Takedown takeDown={vi.fn()} />);

    expect(carriedSince()).toEqual(["page"]);
  });
});
