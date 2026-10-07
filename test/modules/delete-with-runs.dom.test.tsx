import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { DeleteWithRuns } from "../../src/modules/closet/components/DeleteWithRuns";
import type { ControlAction } from "../../src/ui";

/**
 * Round 26 #3, "Y Delete with runs", on its own: the words for every
 * count, the two actions and their bands, and where focus lands.
 */
function ignore(): void {
  // Nothing under test reacts to this.
}

function action(overrides: Partial<ControlAction<[]>> = {}): ControlAction<[]> {
  return {
    pending: false,
    failure: undefined,
    status: "",
    run: () => Promise.resolve(),
    retry: ignore,
    retryRef: createRef(),
    ...overrides,
  };
}

type Props = ComponentProps<typeof DeleteWithRuns>;
type CountBands = Props["countBands"];

function counted(bands: number | undefined): CountBands {
  return () => Promise.resolve(bands);
}

function sheet(props: Partial<Props> = {}) {
  return render(
    <DeleteWithRuns
      open
      itemId="01ITEM"
      name="Pegasus 40"
      runCount={38}
      countBands={counted(4)}
      retire={action()}
      remove={action()}
      onClose={ignore}
      {...props}
    />,
  );
}

/**
Lets the count the sheet asked for on opening arrive.
*/
async function afterTheCount(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
The IF YOU DELETE IT rows, as "WORD text" pairs.
*/
function rows(): string[] {
  return [...document.querySelectorAll("li")].map((row) => row.textContent);
}

describe("DeleteWithRuns: what it says", () => {
  it("draws round 26's sheet for a piece with 38 runs in 4 bands", async () => {
    sheet();
    await afterTheCount();

    expect(
      screen.getByRole("heading", {
        name: "Delete the Pegasus 40? Retire it instead.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "It's on 38 runs. Retiring takes it out of the picker and keeps everything it taught you.",
      ),
    ).toBeVisible();
    expect(screen.getByText("If you delete it")).toBeVisible();
    expect(rows()).toStrictEqual([
      "GoesIt comes off the kit of all 38 runs",
      "GoesIts record in 4 bands",
      "StaysEvery entry and verdict, and the rest of each kit",
    ]);
    expect(screen.getByText("This can't be undone.")).toBeVisible();
    expect(document.querySelector("[data-part='sheet']")).toHaveAttribute(
      "data-state",
      "delete-with-runs",
    );
  });

  it("says one run and one band in the singular", async () => {
    sheet({ runCount: 1, countBands: counted(1) });
    await afterTheCount();

    expect(screen.getByText(/^It's on 1 run\./)).toBeVisible();
    expect(rows()).toStrictEqual([
      "GoesIt comes off the kit of its 1 run",
      "GoesIts record in 1 band",
      "StaysEvery entry and verdict, and the rest of each kit",
    ]);
  });

  it("leaves out the band row when the piece has a record in none", async () => {
    sheet({ runCount: 2, countBands: counted(0) });
    await afterTheCount();

    expect(rows()).toStrictEqual([
      "GoesIt comes off the kit of all 2 runs",
      "StaysEvery entry and verdict, and the rest of each kit",
    ]);
  });

  it("marks what goes and what stays in ink, never a verdict's hue (round 28 #13)", async () => {
    sheet();
    await afterTheCount();

    const [goes, , stays] = document.querySelectorAll("li > span:first-child");
    expect(goes).toHaveClass("text-ink", "text-mono-xs");
    expect(stays).toHaveClass("text-ink", "text-mono-xs");
  });
});

describe("DeleteWithRuns: the band count, asked for on opening (law 5)", () => {
  const WITHOUT_BANDS = [
    "GoesIt comes off the kit of all 38 runs",
    "StaysEvery entry and verdict, and the rest of each kit",
  ];

  it("asks for this garment's count only once the sheet opens", async () => {
    const countBands = vi.fn(counted(4));
    const { rerender } = sheet({ open: false, countBands });

    expect(countBands).not.toHaveBeenCalled();

    rerender(
      <DeleteWithRuns
        open
        itemId="01ITEM"
        name="Pegasus 40"
        runCount={38}
        countBands={countBands}
        retire={action()}
        remove={action()}
        onClose={ignore}
      />,
    );

    expect(await screen.findByText("Its record in 4 bands")).toBeVisible();
    expect(countBands).toHaveBeenCalledExactlyOnceWith({
      data: { itemId: "01ITEM" },
    });
  });

  it("opens without the band row while the count is on its way", () => {
    sheet({ countBands: () => new Promise(ignore) });

    expect(rows()).toStrictEqual(WITHOUT_BANDS);
    expect(screen.getByRole("button", { name: "Retire it" })).toBeVisible();
  });

  it("leaves the band row out when the count could not be had", async () => {
    sheet({ countBands: counted(undefined) });
    await afterTheCount();

    expect(rows()).toStrictEqual(WITHOUT_BANDS);
  });

  it("drops a count an earlier opening had when asking fails this time", async () => {
    const countBands = vi
      .fn<CountBands>()
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const view = (isOpen: boolean) => (
      <DeleteWithRuns
        open={isOpen}
        itemId="01ITEM"
        name="Pegasus 40"
        runCount={38}
        countBands={countBands}
        retire={action()}
        remove={action()}
        onClose={ignore}
      />
    );
    const { rerender } = render(view(true));
    expect(await screen.findByText("Its record in 4 bands")).toBeVisible();

    rerender(view(false));
    rerender(view(true));

    await waitFor(() => {
      expect(screen.queryByText("Its record in 4 bands")).toBeNull();
    });
    expect(countBands).toHaveBeenCalledTimes(2);
    expect(rows()).toStrictEqual(WITHOUT_BANDS);
  });
});

describe("DeleteWithRuns: the two actions", () => {
  it("makes retiring the pink primary and deleting the hairline secondary", () => {
    sheet();

    // Round 26: pink is the action, and retiring is the one recommended.
    const retiring = screen.getByRole("button", { name: "Retire it" });
    expect(retiring).toHaveClass("bg-action", "rounded-pill", "font-bold");
    const deleting = screen.getByRole("button", {
      name: "Delete it and its record",
    });
    expect(deleting).toHaveClass("border", "border-ink", "bg-transparent");
    expect(deleting).not.toHaveClass("bg-action");
  });

  it("retires on Retire it and deletes on the hairline button", async () => {
    const user = userEvent.setup();
    const retire = vi.fn(() => Promise.resolve());
    const remove = vi.fn(() => Promise.resolve());
    sheet({ retire: action({ run: retire }), remove: action({ run: remove }) });

    await user.click(screen.getByRole("button", { name: "Retire it" }));
    expect(retire).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Delete it and its record" }),
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("waits in brackets on the action in flight", () => {
    sheet({
      retire: action({ pending: true }),
      remove: action({ pending: true }),
    });

    expect(screen.getByText("Retiring")).toBeVisible();
    expect(screen.getByText("Deleting")).toBeVisible();
    const [retiring, deleting] = screen.getAllByRole("button", { busy: true });
    expect(retiring).toHaveAttribute("aria-disabled", "true");
    expect(deleting).toHaveAttribute("aria-disabled", "true");
  });

  it("holds the delete off while a retire is in flight", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(() => Promise.resolve());
    sheet({
      retire: action({ pending: true }),
      remove: action({ run: remove }),
    });

    const deleting = screen.getByRole("button", {
      name: "Delete it and its record",
    });
    expect(deleting).toHaveAttribute("aria-disabled", "true");
    expect(deleting).toHaveAttribute("aria-busy", "true");
    expect(deleting).not.toHaveAttribute("disabled");
    // Only the action in flight says so.
    expect(screen.getByText("Retiring")).toBeVisible();
    expect(screen.getByText("Deleting")).not.toBeVisible();

    await user.click(deleting);

    expect(remove).not.toHaveBeenCalled();
  });

  it("holds the retire off while a delete is in flight", async () => {
    const user = userEvent.setup();
    const retire = vi.fn(() => Promise.resolve());
    sheet({
      retire: action({ run: retire }),
      remove: action({ pending: true }),
    });

    const retiring = screen.getByRole("button", { name: "Retire it" });
    expect(retiring).toHaveAttribute("aria-disabled", "true");

    await user.click(retiring);

    expect(retire).not.toHaveBeenCalled();
  });

  it("claims nothing busy while neither is in flight", () => {
    sheet();

    expect(screen.queryAllByRole("button", { busy: true })).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Retire it" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("shows each failure under its own button", () => {
    sheet({
      retire: action({
        failure: { kicker: "Not retired", message: "Our end failed." },
      }),
    });
    const band = screen.getByText("Not retired").closest("[data-part]");
    expect(band?.previousElementSibling).toHaveTextContent("Retire it");
    expect(screen.queryByText("Not deleted")).toBeNull();
  });

  it("shows a failed delete under the delete", () => {
    sheet({
      remove: action({
        failure: { kicker: "Not deleted", message: "Our end failed." },
      }),
    });
    const band = screen.getByText("Not deleted").closest("[data-part]");
    expect(band?.previousElementSibling).toHaveTextContent(
      "Delete it and its record",
    );
  });

  it("offers Try again on the failed action, and nowhere else", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    sheet({
      remove: action({
        failure: { kicker: "Not deleted", message: "Our end failed." },
        retry,
      }),
    });

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    sheet({ onClose });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe("DeleteWithRuns: where focus lands", () => {
  it("lands on Cancel, so a key pressed unread takes nothing away", async () => {
    sheet();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
  });

  it("takes no focus while it is closed", () => {
    sheet({ open: false });

    expect(document.activeElement).toBe(document.body);
    expect(
      within(document.body).queryByRole("heading", { hidden: false }),
    ).toBeNull();
  });
});
