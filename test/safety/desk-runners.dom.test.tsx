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
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DeskRunners,
  renameMessage,
} from "../../src/modules/safety/components/DeskRunners";
import {
  Takedown,
  takedownMessage,
} from "../../src/modules/safety/components/Takedown";
import type { DeskRunner } from "../../src/modules/safety/runners";

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
};

async function renderDesk(overrides: Partial<Props> = {}) {
  const rename = vi
    .fn<Props["rename"]>()
    .mockResolvedValue({ kind: "renamed", username: "runner_4821" });
  const ban = vi.fn<Props["ban"]>().mockResolvedValue({ banned: true });
  const unban = vi.fn<Props["unban"]>().mockResolvedValue({ banned: false });
  const router = await renderWithRouter(
    <DeskRunners
      runners={[ada, bo]}
      total={412}
      filter={{ filter: "all" }}
      rename={rename}
      ban={ban}
      unban={unban}
      {...overrides}
    />,
  );
  return { rename, ban, unban, router };
}

describe("D8's table", () => {
  it("counts every account and draws one row per runner", async () => {
    await renderDesk();

    expect(screen.getByText("[412 accounts]")).toBeInTheDocument();
    const [header, first, second] = screen.getAllByRole("row");
    expect(header).toHaveTextContent("HandleEmailJoinedRunsReportsState");
    expect(first).toHaveTextContent("@adaada@example.com2025-09-04122[ACTIVE]");
    expect(second).toHaveTextContent("—bo@example.com2023-11-1400[CLOSED]");
  });

  it("marks the current filter, and links the others", async () => {
    await renderDesk({ filter: { filter: "reported", query: "ad" } });

    const filters = screen.getByRole("navigation", { name: "Filter runners" });
    expect(
      within(filters).getByRole("link", { name: "Reported" }),
    ).toHaveAttribute("aria-current", "page");
    expect(within(filters).getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/desk/runners?query=ad&filter=all",
    );
    expect(
      within(filters).getByRole("link", { name: "All" }),
    ).not.toHaveAttribute("aria-current");
    expect(
      within(filters).getByRole("link", { name: "Closed" }),
    ).toHaveAttribute("href", "/desk/runners?query=ad&filter=closed");
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
    expect(renameMessage({ kind: "collided" })).toBe(
      "That placeholder is taken. Press Rename again.",
    );
    expect(renameMessage({ kind: "not_found" })).toBe(
      "This runner has no handle to take away.",
    );
  });
});

describe("Close account (D3)", () => {
  it("closes with the reason their notice quotes", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.type(screen.getByRole("textbox", { name: /Why/ }), "Spam");
    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).toHaveBeenCalledWith({
      data: { userId: "u-ada", reason: "Spam" },
    });
  });

  it("refuses to close without a reason", async () => {
    const user = userEvent.setup();
    const { ban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "@ada" }));

    await user.click(screen.getByRole("button", { name: "Close account" }));

    expect(ban).not.toHaveBeenCalled();
  });

  it("offers a closed account its reason and Reopen instead", async () => {
    const user = userEvent.setup();
    const { unban } = await renderDesk();
    await user.click(screen.getByRole("button", { name: "—" }));

    expect(screen.getByText("Spam accounts")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close account" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen account" }));

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
    await user.selectOptions(picker, "—");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(rename).not.toHaveBeenCalled();
    expect(picker).toHaveDisplayValue("—");
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
    ).toHaveDisplayValue("—");
    expect(screen.getByRole("textbox", { name: /Why/ })).toHaveValue("");
  });
});

describe("Takedown (SAF-6)", () => {
  it("opens with nothing chosen", () => {
    render(<Takedown takeDown={vi.fn()} />);
    const picker = screen.getByRole("combobox", {
      name: /What it is/,
    });
    expect(picker).toHaveDisplayValue("—");
    // The empty option is chosen, not merely shown: a value no option
    // holds leaves nothing selected.
    if (!(picker instanceof HTMLSelectElement)) throw new Error("no select");
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
    expect(options).toStrictEqual(["—", "A photo", "A whole entry"]);
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
    await user.selectOptions(picker, "—");
    await user.click(screen.getByRole("button", { name: "Take it down" }));

    expect(takeDown).not.toHaveBeenCalled();
    const said = await screen.findAllByText("Pick a photo or an entry.");
    expect(said.length).toBeGreaterThan(0);
    expect(picker).toHaveDisplayValue("—");
  });

  it("tells the operator each outcome", () => {
    expect(takedownMessage("removed")).toBe(
      "Taken down. The runner has been told, and the notice is on record.",
    );
    expect(takedownMessage("not_found")).toBe(
      "Nothing has that id. Check it against the notice.",
    );
  });
});
