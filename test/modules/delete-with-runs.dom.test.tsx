import { render, screen, waitFor, within } from "@testing-library/react";
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

function sheet(props: Partial<Props> = {}) {
  return render(
    <DeleteWithRuns
      open
      name="Pegasus 40"
      runCount={38}
      bandCount={4}
      retire={action()}
      remove={action()}
      onClose={ignore}
      {...props}
    />,
  );
}

/**
The IF YOU DELETE IT rows, as "WORD text" pairs.
*/
function rows(): string[] {
  return [...document.querySelectorAll("li")].map((row) => row.textContent);
}

describe("DeleteWithRuns: what it says", () => {
  it("draws round 26's sheet for a piece with 38 runs in 4 bands", () => {
    sheet();

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

  it("says one run and one band in the singular", () => {
    sheet({ runCount: 1, bandCount: 1 });

    expect(screen.getByText(/^It's on 1 run\./)).toBeVisible();
    expect(rows()).toStrictEqual([
      "GoesIt comes off the kit of its 1 run",
      "GoesIts record in 1 band",
      "StaysEvery entry and verdict, and the rest of each kit",
    ]);
  });

  it("leaves out the band row when the piece has a record in none", () => {
    sheet({ runCount: 2, bandCount: 0 });

    expect(rows()).toStrictEqual([
      "GoesIt comes off the kit of all 2 runs",
      "StaysEvery entry and verdict, and the rest of each kit",
    ]);
  });

  it("marks what goes in the cold hue and what stays in the dialed one", () => {
    sheet();

    const [goes, , stays] = document.querySelectorAll("li > span:first-child");
    expect(goes).toHaveClass("text-cold-text");
    expect(stays).toHaveClass("text-dialed-text");
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
