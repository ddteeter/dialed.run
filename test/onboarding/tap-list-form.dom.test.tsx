import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TapListSelection } from "../../src/lib/contracts";
import type { TapListEntry } from "../../src/modules/closet";
import { TapListForm } from "../../src/modules/onboarding/components/TapListForm";

/**
 * Screen O3, against design round 6 §AA's six rules.
 *
 * The fixture is synthetic rather than the real `TAP_LIST`, and on purpose
 * twice over. The table is 18 rows today and 24 when D-49 closes, so a
 * test built on it would have to be rewritten to add a garment; and the
 * screen's whole contract is that it works *at any list length* — the fold
 * is a prop, the remainder is counted, and nothing is hardcoded. A fixture
 * of five rows folded at three proves that in a way the real table's own
 * numbers never could.
 *
 * `TapListEntry` arrives as a type import, so nothing here drags
 * `modules/closet`'s barrel — and therefore `db/schema` — into the DOM
 * project. That is the same constraint the component itself is built
 * around.
 */
function entry(key: string, name: string): TapListEntry {
  return {
    key,
    garment: { category: "top", name, layer: "base", weight: "light" },
    // Rank is what ordered the list before it got here; this screen never
    // reads it, which is itself the point of rule 2.
    rank: { cold: 1, mild: 1, hot: 1 },
  };
}

const ENTRIES: readonly TapListEntry[] = [
  entry("tights", "Running tights"),
  entry("beanie", "Beanie"),
  entry("gloves", "Running gloves"),
  entry("singlet", "Singlet"),
  entry("cap", "Running cap"),
];

function renderForm(
  overrides: {
    entries?: readonly TapListEntry[];
    fold?: number;
    saveTapList?: (input: { data: TapListSelection }) => Promise<unknown>;
  } = {},
) {
  const save =
    overrides.saveTapList ??
    vi.fn((input: { data: TapListSelection }) => Promise.resolve(input));
  const onSaved = vi.fn();
  const onSkip = vi.fn();
  render(
    <TapListForm
      entries={overrides.entries ?? ENTRIES}
      fold={overrides.fold ?? 3}
      saveTapList={save}
      onSaved={onSaved}
      onSkip={onSkip}
    />,
  );
  return { save, onSaved, onSkip };
}

const counter = () => screen.getByText(/^Closet:/);
const next = () => screen.getByRole("button", { name: "Next" });
const disclosure = () => screen.getByRole("button", { name: /Everything else/ });

describe("TapListForm", () => {
  it("opens at zero, with nothing ticked", () => {
    // Rule 4. With O2 cut there is no photo pass to seed from, and a
    // screen that arrived pre-ticked would be claiming a runner owns
    // something they never said they owned.
    renderForm();

    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }
    expect(counter()).toHaveTextContent("Closet: 0 pieces");
    expect(screen.getByText("Tap what you own")).toBeVisible();
  });

  it("names each row by the garment, not by its mark", async () => {
    // The `+` and `✓` the artboard draws are decoration. If they reached
    // the accessible name, a runner on a screen reader would hear "plus
    // Running tights" and, after tapping, a different control name for the
    // same row.
    renderForm();

    expect(screen.getByRole("checkbox", { name: "Running tights" })).toBeVisible();

    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Running tights" }));

    expect(screen.getByRole("checkbox", { name: "Running tights" })).toBeChecked();
  });

  it("folds where it is told and states the real remainder", () => {
    // Rule 3. Five rows folded at three leaves two — the disclosure counts
    // rather than repeating design's "10 more", which was true of a
    // 24-row table and of nothing else.
    renderForm();

    expect(screen.getByRole("checkbox", { name: "Running gloves" })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: "Singlet" })).toBeNull();
    expect(disclosure()).toHaveTextContent("Everything else · 2 more");
    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals the rest, and keeps its own name while doing it", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(disclosure());

    expect(screen.getByRole("checkbox", { name: "Singlet" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Running cap" })).toBeVisible();
    // The name is what it discloses; `aria-expanded` is the state. A label
    // that flipped to "Fewer" would announce a different control each press.
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(disclosure()).toHaveTextContent("Everything else · 2 more");
  });

  it("shows no disclosure when nothing is hidden", () => {
    renderForm({ fold: ENTRIES.length });

    expect(screen.queryByRole("button", { name: /Everything else/ })).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(ENTRIES.length);
  });

  it("keeps every row on offer — the list is never filtered", async () => {
    // Rule 1, stated as the thing that would break it: a screen that
    // dropped rows it thought the band did not need would lose the
    // Minneapolis runner their singlet.
    const user = userEvent.setup();
    renderForm();

    await user.click(disclosure());

    expect(screen.getAllByRole("checkbox").map((box) => box.getAttribute("name"))).toEqual(
      ENTRIES.map(() => "keys"),
    );
    for (const row of ENTRIES) {
      expect(
        screen.getByRole("checkbox", { name: row.garment.name }),
      ).toBeVisible();
    }
  });

  it("toggles, both ways, and counts taps", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));
    expect(counter()).toHaveTextContent("Closet: 1 pieces");

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));
    expect(screen.getByRole("checkbox", { name: "Beanie" })).not.toBeChecked();
    expect(counter()).toHaveTextContent("Closet: 0 pieces");
  });

  it("counts a tapped row that the fold has since hidden", async () => {
    // Collapsing the disclosure hides the row, not the tap. A count that
    // fell when the list closed would tell a runner they had lost
    // something they still own, and the payload would disagree with it.
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.click(disclosure());
    await user.click(screen.getByRole("checkbox", { name: "Singlet" }));
    await user.click(disclosure());

    expect(screen.queryByRole("checkbox", { name: "Singlet" })).toBeNull();
    expect(counter()).toHaveTextContent("Closet: 1 pieces");

    await user.click(next());
    expect(save).toHaveBeenCalledWith({ data: { keys: ["singlet"] } });
  });

  it("says 'enough to start' at six and not at five", async () => {
    // Advice, not a gate — so the assertion is about the words appearing,
    // and the next test is about Next working long before them.
    const user = userEvent.setup();
    const six = [...ENTRIES, entry("buff", "Buff")];
    renderForm({ entries: six, fold: six.length });

    for (const row of six.slice(0, 5)) {
      await user.click(screen.getByRole("checkbox", { name: row.garment.name }));
    }
    expect(screen.getByText("Tap what you own")).toBeVisible();
    expect(screen.queryByText("Enough to start")).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Buff" }));
    expect(screen.getByText("Enough to start")).toBeVisible();
    expect(screen.queryByText("Tap what you own")).toBeNull();
  });

  it("submits from the first tap", async () => {
    // "Next is live from the first tap." One tap is a complete answer.
    const user = userEvent.setup();
    const { save, onSaved } = renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Running tights" }));
    await user.click(next());

    expect(save).toHaveBeenCalledWith({ data: { keys: ["tights"] } });
    // After the announce, never before it — `onSaved` navigates, and
    // navigation unmounts the live region the success sentence went into.
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it("sends the taps in the order they were made", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Running gloves" }));
    await user.click(screen.getByRole("checkbox", { name: "Running tights" }));
    await user.click(next());

    expect(save).toHaveBeenCalledWith({ data: { keys: ["gloves", "tights"] } });
  });

  it("answers a zero-tap Next with the schema's own sentence", async () => {
    // The artboard draws Next inert until something is ticked. A disabled
    // submit is forbidden by the forms contract, so the sentence does that
    // job — and it names the way out, which a grey button never could.
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.click(next());

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("Tap what you own, or skip for now.")).toBeVisible();
  });

  it("clears that sentence on the tap it asked for", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(next());
    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));

    expect(
      screen.queryByText("Tap what you own, or skip for now."),
    ).toBeNull();
  });

  it("skips without writing anything", async () => {
    // Packet requirement 4: every step past O1 is skippable, and a runner
    // who bails still has a working app. Skip is not a submit with an
    // empty payload — it creates nothing at all.
    const user = userEvent.setup();
    const { save, onSkip, onSaved } = renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("draws the artboard's mark, and keeps it out of the name", async () => {
    // `+` before a tap, `✓` after — AA1 and AA2. It is decoration, so it
    // lives in the text and not in the accessible name, which the
    // `getByRole` queries throughout this file already depend on.
    const user = userEvent.setup();
    renderForm();

    const chip = () =>
      screen.getByRole("checkbox", { name: "Beanie" }).parentElement;

    expect(chip()?.textContent).toBe("+Beanie");

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));

    expect(chip()?.textContent).toBe("✓Beanie");
  });

  it("never lets the browser submit the form itself", async () => {
    // `noValidate` plus `preventDefault`: without the second the page
    // navigates away mid-submit and the handler's result is lost.
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(next());
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("marks a tapped row in ink, never in hue", async () => {
    // Design round 6 §AB: pink, teal and grey mean cold, dialed and warm
    // everywhere and permanently. A ticked chip that borrowed one of them
    // would be saying "dialed" on a screen with no verdicts in it.
    const user = userEvent.setup();
    renderForm();

    const chip = () =>
      screen.getByRole("checkbox", { name: "Beanie" }).parentElement;

    expect(chip()).toHaveClass("border");
    expect(chip()).not.toHaveClass("bg-night");

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));

    expect(chip()).toHaveClass("bg-night");
    expect(chip()).toHaveClass("text-chalk");
    expect(chip()?.className).not.toMatch(/pink|teal|hi-viz/);
  });

  it("announces the save, and does not move before it has", async () => {
    const user = userEvent.setup();
    const { onSaved } = renderForm();

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));
    await user.click(next());

    // One live region, one sentence, and `onSaved` — which navigates — runs
    // after it (D-44).
    const status = screen.getByRole("status");
    expect(within(status).getByText("Closet started.")).toBeInTheDocument();
    // The sentence is in the region *before* the move happens: it is set
    // synchronously with the success, and `onSaved` waits a macrotask.
    expect(onSaved).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("offers a retry when the save fails, and keeps the taps", async () => {
    const user = userEvent.setup();
    const save = vi.fn(() => Promise.reject(new Error("D1 is down")));
    const { onSaved } = renderForm({ saveTapList: save });

    await user.click(screen.getByRole("checkbox", { name: "Beanie" }));
    await user.click(next());

    expect(screen.getByText("Our end failed. Nothing changed.")).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    // The taps survive the failure: nothing is cleared, so `Try again`
    // resubmits exactly what was tapped.
    expect(screen.getByRole("checkbox", { name: "Beanie" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(save).toHaveBeenCalledTimes(2);
  });
});
