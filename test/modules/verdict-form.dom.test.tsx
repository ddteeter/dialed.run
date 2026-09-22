import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { entryTags, verdictScale } from "../../src/lib/contracts";
import { maxPhotosPerEntry } from "../../src/lib/photo-constraints";
import { VerdictForm } from "../../src/modules/feed/components/VerdictForm";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
 * The verdict (screen A3) — the one screen the whole product turns on.
 *
 * A verdict is per-run on a -2..+2 scale with 0 meaning dialed, and the
 * per-item signal is a flag rather than a second verdict. Both of those
 * facts are only visible in what this sends.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const entryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/entry/$entryId",
    component: () => <p>The entry</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, entryRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "01JENTRY000000000000000000",
    userId: "01JSER00000000000000000000",
    authorDisplayName: undefined,
    runId: "01JRAN00000000000000000000",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: 1_755_000_000,
    indoor: false,
    verdict: undefined,
    isPublic: true,
    caption: undefined,
    createdAt: 1_755_000_000,
    items: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    viewerHasReacted: false,
    ...overrides,
  };
}

const item = (itemId: string, name: string) => ({
  itemId,
  name,
  brand: undefined,
  category: "top",
  layer: undefined,
  flag: undefined,
  note: undefined,
});

/**
 * The per-item flag groups, in document order.
 *
 * Radio groups since design round 16: a `<select>` beside the kit read as
 * the verdict control, which is what a reviewer took it for on film. Each
 * group is legended with its garment's name, so they are found by role
 * and named rather than by index into a list of comboboxes.
 */
function flagGroups(): HTMLElement[] {
  // `group`, not `radiogroup`: `ChoiceList` renders a real `<fieldset>`
  // with a `<legend>`, which is how the garment's name becomes the
  // group's accessible name — and a fieldset's role is `group`.
  //
  // **The verdict row is a fieldset too**, since design's round 17 took it
  // out of its field box, so "every group on the screen" is no longer the
  // same set as "every flag group". A flag group is one that holds the
  // three flag chips; the verdict row holds buttons and no radio at all,
  // which is a property of what the control *is* rather than of where it
  // happens to sit in the document.
  return screen
    .getAllByRole("group")
    .filter((group) => within(group).queryAllByRole("radio").length > 0);
}

/**
The chosen chip inside one item's group.
*/
function chosenFlag(group: HTMLElement): HTMLElement {
  return within(group).getByRole("radio", { checked: true });
}

/**
The nth flag picker, or a clear failure rather than an `undefined`.
*/
function flagGroup(index: number): HTMLElement {
  const select = flagGroups()[index];
  if (select === undefined)
    throw new Error(`no flag select at ${String(index)}`);
  return select;
}

const nothing = () => Promise.resolve();
const noStat = () => Promise.resolve({ worn: 1, total: 1 });
const noUpload = () => Promise.resolve({ key: "k" });

/**
 * Rejects with `reason` exactly as given, never wrapped in an Error.
 *
 * That is the point, not a detail. A rejection from a server function has
 * crossed a structured clone, so it reaches the browser as a plain object
 * with no prototype — `instanceof Error` is false for a real one, which is
 * why `useFormSubmit` *parses* what came back instead of casting it. An
 * `Object.assign(new Error(), { issues })` would test a shape production
 * never produces.
 *
 * `throw reason` rather than `Promise.reject(reason)`: `reason` stays typed
 * `unknown` at the throw site, which `only-throw-error` allows by default,
 * where `prefer-promise-reject-errors` extends no such allowance. Same
 * helper as `test/ui/form.dom.test.tsx`; the rule's fitness for these tests
 * is written up in docs/designs/042.
 */
function rejectWith(reason: unknown): never {
  throw reason;
}

function form(
  overrides: {
    entry?: Partial<Entry>;
    bandFloor?: number;
    submitVerdict?: (input: {
      data: Record<string, unknown>;
    }) => Promise<unknown>;
    uploadPhoto?: (input: { data: FormData }) => Promise<{ key: string }>;
    itemBandWearStat?: (input: {
      data: { itemId: string; bandFloorC: number };
    }) => Promise<{ worn: number; total: number }>;
    renderPhotoStep?: (
      file: File,
      onReady: (ready: File) => void,
      announce: (sentence: string) => void,
    ) => ReactNode;
  } = {},
) {
  return (
    <VerdictForm
      entry={entry(overrides.entry)}
      bandFloor={overrides.bandFloor}
      submitVerdict={overrides.submitVerdict ?? nothing}
      uploadPhoto={overrides.uploadPhoto ?? noUpload}
      itemBandWearStat={overrides.itemBandWearStat ?? noStat}
      {...(overrides.renderPhotoStep !== undefined && {
        renderPhotoStep: overrides.renderPhotoStep,
      })}
    />
  );
}

describe("VerdictForm: the scale", () => {
  it("offers every verdict the contract defines, in order", async () => {
    // Read from `verdictScale`, not restated — the labels here and the
    // ones the feed renders are the same list.
    await renderWithRouter(form());

    const labels = verdictScale.map((choice) => choice.label);
    for (const label of labels) {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    }
  });

  it("names each field the server rejects, in the words a person reads", async () => {
    // The client pre-check can only ever fail on `verdict` — every other
    // value comes from a controlled input and is well-formed by
    // construction — so one error, and one error renders no summary. The
    // *server* validates the same schema and can reject several at once,
    // which is the only path that reaches the summary and the labels.
    //
    // Without this the label map is four strings nothing reads, and a
    // mutant emptying any of them leaves a summary row with no name.
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        submitVerdict: () =>
          rejectWith({
            issues: [
              { path: ["verdict"], message: "Out of range." },
              { path: ["tags"], message: "That tag is retired." },
              {
                path: ["itemFlags"],
                message: "That piece is not on this run.",
              },
              { path: ["isPublic"], message: "Not allowed for this account." },
            ],
          }),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    expect(
      await screen.findByRole("button", { name: /Did it work/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Tags/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Per-item notes/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Sharing/ })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. 4 fields need a fix.",
    );
  });

  it("refuses to save without one, and says why", async () => {
    // This used to be `disabled` on the submit button, which §5 bans: a
    // disabled button drops focus, stops announcing, and tells a user
    // nothing about why their tap did nothing. The schema refuses the
    // submission instead, and the sentence lives in `verdictSchema` where
    // every renderer of it can find it.
    const user = userEvent.setup();
    const submitVerdict = vi.fn(() => Promise.resolve(undefined));
    await renderWithRouter(form({ submitVerdict }));

    const save = screen.getByRole("button", { name: "Save verdict" });
    expect(save).toBeEnabled();

    await user.click(save);

    expect(await screen.findByText("Say how the kit felt.")).toBeVisible();
    expect(submitVerdict).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
  });

  it("says which one is chosen, in words rather than in ink", async () => {
    // Rule 01: "remove every colour and the meaning survives." It did not.
    // The chosen verdict was an ink inversion plus a pair of brackets, and
    // the brackets are `aria-hidden` because they are a move rather than a
    // word — so a reader heard five identically-named buttons and no
    // indication of which was picked.
    //
    // `aria-pressed` rather than a `radiogroup`: the contract asks for
    // five radios with arrow-key navigation, which is a behaviour change
    // this lane may not make. A single-select toggle group is honest about
    // what the control does today. The radiogroup is D-84.
    const user = userEvent.setup();
    await renderWithRouter(form());

    const pressed = () =>
      screen
        // `queryAll`, because "nothing is pressed yet" is a state this
        // asserts and `getAllByRole` throws on an empty match.
        .queryAllByRole("button", { pressed: true })
        .map((button) => button.textContent);

    expect(pressed()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    expect(pressed()).toEqual(["[Dialed]"]);

    // And it moves rather than accumulating — two pressed verdicts would
    // be a distribution, which is a different fact from "how you called
    // it".
    await user.click(screen.getByRole("button", { name: "Way cold" }));

    expect(pressed()).toEqual(["[Way cold]"]);
  });

  it("marks the chosen one, and only that one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    expect(screen.getByRole("button", { name: "Dialed" })).toHaveClass(
      "bg-ink",
    );
    expect(screen.getByRole("button", { name: "Way cold" })).not.toHaveClass(
      "bg-ink",
    );
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeEnabled();
  });

  it("leaves the unchosen ones outlined", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    const other = screen.getByRole("button", { name: "Way cold" });
    expect(other).toHaveClass("border");
    expect(other).not.toHaveClass("bg-ink");
  });

  it("closes the brackets onto the chosen verdict, and locks after", async () => {
    // "The single most important input in the product. The bracket
    // closing is the receipt" (design/motion.js, "Verdict commit").
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));

    const chosen = screen.getByRole("button", { name: "Dialed" });
    // The two bracket spans, not every span in the button: the label and
    // its brackets are wrapped in one span so they are a single flex item
    // and wrap together as inline content — without that the cell's
    // `flex-col` laid the brackets out as rows of their own, above and
    // below the word they are supposed to be closing onto.
    const brackets = [...chosen.querySelectorAll("[aria-hidden='true']")];
    expect(brackets.map((span) => span.textContent)).toEqual(["[", "]"]);
    expect(brackets[0]).toHaveClass("bracket-close-start");
    expect(brackets[1]).toHaveClass("bracket-close-end");
    // **They frame the cell, not the words** (design round 18): *"they
    // start at the cell's outer edges, vertically centred … the pair never
    // enters the text."*
    //
    // `absolute` is the load-bearing one and the reason the ruling works:
    // an absolutely positioned child is not a flex item, so the cell's
    // `flex-col` cannot stack it as a row of its own — which is exactly
    // what it did before, putting `[` on a line above the word and `]` on
    // a line below. `inset-y-0` with `items-center` is "vertically
    // centred", against the cell's full height so a one-line and a
    // two-line label carry their brackets at the same height.
    //
    // Whether they actually clear the text is geometry, and happy-dom lays
    // nothing out — `e2e/verdict/verdict-row.spec.ts` measures it.
    for (const bracket of brackets) {
      expect(bracket).toHaveClass(
        "absolute",
        "inset-y-0",
        "flex",
        "items-center",
        "pointer-events-none",
      );
    }
    // Decoration, not notation: they must not join the name a screen
    // reader announces, which is why the button is still found by
    // "Dialed" above.
    for (const span of brackets) {
      expect(span).toHaveAttribute("aria-hidden", "true");
    }
    // "…then the row locks": the ink is delayed by one reveal, and that
    // delay is only on the chosen row — on the resting one it would make
    // un-choosing linger for a receipt that did not happen.
    expect(chosen).toHaveClass("verdict-lock");
    expect(screen.getByRole("button", { name: "Way cold" })).not.toHaveClass(
      "verdict-lock",
    );
  });

  it("gives an unchosen verdict no brackets to close", async () => {
    await renderWithRouter(form());

    expect(
      screen
        .getByRole("button", { name: "Dialed" })
        .querySelectorAll("[aria-hidden='true']"),
    ).toHaveLength(0);
  });

  it("starts from the verdict the entry already has", async () => {
    // Including 0: dialed is a verdict, and an editor that forgot it would
    // show the form as unanswered.
    await renderWithRouter(form({ entry: { verdict: 0 } }));

    expect(screen.getByRole("button", { name: "Dialed" })).toHaveClass(
      "bg-ink",
    );
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeEnabled();
  });

  it("sends the number, not the label", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("button", { name: "Way warm" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      entryId: "01JENTRY000000000000000000",
      verdict: 2,
    });
  });
});

describe("VerdictForm: the row, and the box that was around it", () => {
  /**
   * Design round 17: *"the five are one row at every width — in the 390
   * desk panel too; never a stack, never wider than the panel. Neither the
   * row nor the chips sit inside a field box."*
   *
   * The geometry half of that is `e2e/verdict/verdict-row.spec.ts`, in a
   * real browser — happy-dom lays nothing out, so every rect here is zero
   * and "one row" is not a question this project can answer. What it *can*
   * answer is the structure the ruling is about.
   */
  it("groups the five with a legend rather than a label pointing nowhere", async () => {
    // A `<label htmlFor="verdict">` names an id that does not exist —
    // there is no single control to point at, five buttons being the
    // control. A fieldset's legend is the group's accessible name, which
    // is what a reader entering the group actually hears.
    await renderWithRouter(form({}));

    const group = screen.getByRole("group", { name: /Did it work/i });
    for (const label of [
      "Way cold",
      "A bit cold",
      "Dialed",
      "A bit warm",
      "Way warm",
    ]) {
      expect(within(group).getByRole("button", { name: label })).toBeVisible();
    }
  });

  it("does not wrap the row in a field box, which was eating the focus ring", async () => {
    // **The defect, not just the look.** `field-box` (ui/a11y.css) removes
    // the outline from its descendants — correct when the child is the
    // borderless input a `FormField` insets, wrong for a button group. It
    // meant tabbing across the five verdicts showed one static outline
    // around the whole box and no indication of which button had focus, on
    // the single control the product turns on. Rule 06's "never removed"
    // was failing by construction.
    await renderWithRouter(form({}));

    const group = screen.getByRole("group", { name: /Did it work/i });
    expect(group).not.toHaveClass("field-box");
    expect(group.querySelector(".field-box")).toBeNull();
  });

  it("carries the three rules the cell's class string is holding", async () => {
    // A class string in a const is mutated, so it has to be asserted —
    // and each of these is a written rule rather than a look:
    //
    // - `uppercase` is CSS, never the label text, so the accessible name
    //   stays "Way cold" and not "WAY COLD". That is why every other
    //   assertion in this file can ask for the button by its sentence-case
    //   name (a11y contract, and the reason `Mono` works the same way).
    // - `text-center` with `flex-col` is round 17's "never wider than the
    //   panel" made structural: at 390 a two-word label has to break
    //   *inside* its own cell, because the row itself cannot.
    // - `target` is the 44px hit area (accessibility rule 03), which for a
    //   cell this narrow is the padding and not the glyph.
    await renderWithRouter(form({}));

    const button = screen.getByRole("button", { name: "Way cold" });
    expect(button).toHaveClass(
      "uppercase",
      "text-center",
      "flex-col",
      "target",
    );
  });

  it("keeps the scale's order, which is the product rule", async () => {
    // Way cold -> way warm. A set of five buttons in any order is still
    // five buttons; the order is what makes the row readable as a scale.
    await renderWithRouter(form({}));

    const group = screen.getByRole("group", { name: /Did it work/i });
    const names = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual([
      "Way cold",
      "A bit cold",
      "Dialed",
      "A bit warm",
      "Way warm",
    ]);
  });
});

describe("VerdictForm: per-item flags", () => {
  it("offers a flag per item, defaulting to none", async () => {
    await renderWithRouter(
      form({
        entry: {
          items: [
            item("01JTEMA0000000000000000000", "Houdini"),
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
      }),
    );

    // "Anything specific?" is the board's question for this block.
    expect(
      screen.getByRole("heading", { name: "Anything specific?" }),
    ).toBeVisible();
    const groups = flagGroups();
    expect(groups).toHaveLength(2);
    // Legended with the garment, so a reader entering the group hears
    // which piece it is about rather than three unexplained options.
    expect(groups[0]).toHaveAccessibleName("Houdini");
    // Three visible choices, not three behind a tap — comparing them is
    // how a runner picks (`ChoiceList`'s own note).
    // By accessible name, not `textContent`: the chip's word is on the
    // `<label>` that wraps the input, so the input itself has no text.
    for (const name of ["Fine", "Too much", "Not enough"]) {
      expect(
        within(flagGroup(0)).getByRole("radio", { name }),
      ).toBeInTheDocument();
    }
    expect(within(flagGroup(0)).getAllByRole("radio")).toHaveLength(3);
  });

  it("asks nothing when the entry has no garments on it", async () => {
    // An entry saved with a bare kit — which `attachKit` allows — has
    // nothing to flag, so the block is absent rather than a heading over
    // nothing. Without this the `> 0` guard reads the same as `>= 0`.
    await renderWithRouter(form({ entry: { items: [] } }));

    expect(
      screen.queryByRole("heading", { name: "Anything specific?" }),
    ).toBeNull();
    // `flagGroups()`, not every group on the screen: the verdict row is
    // itself a fieldset now, and it is there whether or not the kit has
    // anything in it.
    expect(flagGroups()).toHaveLength(0);
  });

  it("gives each garment its own radio group, keyed by item id", async () => {
    // **The `name` is the grouping, and an empty one is a real bug rather
    // than a cosmetic one.** Radios sharing a name are one group: the
    // browser's arrow keys traverse it, and that is how a keyboard user
    // moves between "Fine", "Too much" and "Not enough". Blank the name
    // and each chip becomes its own group of one — the state still looks
    // right, because React drives `checked` from props, and the keyboard
    // stops working. happy-dom cannot show that, so the mechanism is what
    // is asserted.
    await renderWithRouter(
      form({
        entry: {
          items: [
            item("01JTEMA0000000000000000000", "Houdini"),
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
      }),
    );

    const names = screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("name"));
    expect(names).toStrictEqual([
      "flag-01JTEMA0000000000000000000",
      "flag-01JTEMA0000000000000000000",
      "flag-01JTEMA0000000000000000000",
      "flag-01JTEMB0000000000000000000",
      "flag-01JTEMB0000000000000000000",
      "flag-01JTEMB0000000000000000000",
    ]);
  });

  it("shows an unflagged item as Fine, chosen", async () => {
    // `"none"` and not `""`: a radio's value is a real string, and an
    // empty one reads as "no value" to the platform — a different thing
    // from "the runner chose not to flag this". One chip is always on, so
    // the group never announces as having no answer.
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
      }),
    );

    expect(chosenFlag(flagGroup(0))).toHaveAccessibleName("Fine");
  });

  it("starts from the flag the item already carries", async () => {
    // Re-opening a verdict used to show every piece as unflagged, so
    // saving again cleared a flag the runner had set.
    await renderWithRouter(
      form({
        entry: {
          items: [
            {
              ...item("01JTEMA0000000000000000000", "Houdini"),
              flag: "not_enough" as const,
            },
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
      }),
    );

    expect(chosenFlag(flagGroup(0))).toHaveAccessibleName("Not enough");
    expect(chosenFlag(flagGroup(1))).toHaveAccessibleName("Fine");
  });

  it("sends a flag it was seeded with, unchanged", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: {
          items: [
            {
              ...item("01JTEMA0000000000000000000", "Houdini"),
              flag: "not_enough" as const,
            },
          ],
        },
        submitVerdict,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: "not_enough" },
    ]);
  });

  it("keeps each item's flag to itself", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: {
          items: [
            item("01JTEMA0000000000000000000", "Houdini"),
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
      }),
    );

    await user.click(
      within(flagGroup(0)).getByRole("radio", { name: "Too much" }),
    );

    // A fieldset has no value; the chosen chip is the state. Setting one
    // item's flag must leave the other's alone, which is the bug this
    // case exists for.
    expect(chosenFlag(flagGroup(0))).toHaveAccessibleName("Too much");
    expect(chosenFlag(flagGroup(1))).toHaveAccessibleName("Fine");
  });

  it("says nothing about items when the entry has none", async () => {
    await renderWithRouter(form());
    expect(
      screen.queryByRole("heading", { name: "Per-item notes" }),
    ).toBeNull();
  });

  it("sends a flag for the item it was set on, and undefined for the rest", async () => {
    // There is no per-item verdict — the flag is the per-item signal, and
    // "no flag" has to travel as absent rather than as an empty string.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: {
          items: [
            item("01JTEMA0000000000000000000", "Houdini"),
            item("01JTEMB0000000000000000000", "Tights"),
          ],
        },
        submitVerdict,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(
      within(flagGroup(0)).getByRole("radio", { name: "Too much" }),
    );
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: "too_much" },
      { itemId: "01JTEMB0000000000000000000", flag: undefined },
    ]);
  });

  it("sends an unset flag as absent, not as an empty string", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        submitVerdict,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    // Set it, then put it back — the chip group's "Fine" is how a runner
    // un-flags, and it must reach the payload as absent rather than as
    // the string "none".
    const group = flagGroup(0);
    await user.click(within(group).getByRole("radio", { name: "Too much" }));
    await user.click(within(group).getByRole("radio", { name: "Fine" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: undefined },
    ]);
  });
});

describe("VerdictForm: tags and sharing", () => {
  it("offers every tag the contract defines, in words", async () => {
    await renderWithRouter(form());
    for (const tag of entryTags) {
      expect(
        screen.getByRole("button", { name: tag.replaceAll("_", " ") }),
      ).toBeVisible();
    }
  });

  it("leaves unchosen tags outlined", async () => {
    await renderWithRouter(form());
    const chafed = screen.getByRole("button", { name: "chafed" });
    expect(chafed).toHaveClass("border");
    expect(chafed).not.toHaveClass("bg-ink");
  });

  it("toggles a tag on and back off", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    const chafed = screen.getByRole("button", { name: "chafed" });

    await user.click(chafed);
    expect(screen.getByRole("button", { name: "chafed" })).toHaveClass(
      "bg-ink",
    );

    await user.click(screen.getByRole("button", { name: "chafed" }));
    expect(screen.getByRole("button", { name: "chafed" })).not.toHaveClass(
      "bg-ink",
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({ tags: [] });
  });

  it("starts from the tags the entry already has, and sends them", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({ entry: { tags: ["chafed"] }, submitVerdict }),
    );

    expect(screen.getByRole("button", { name: "chafed" })).toHaveClass(
      "bg-ink",
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      tags: ["chafed"],
    });
  });

  it("is shared by default, and can be made private", async () => {
    // Entries are public by default with a per-entry toggle.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    const share = screen.getByLabelText(/Share this/);
    expect(share).toBeChecked();

    await user.click(share);
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      isPublic: false,
    });
  });

  it("starts private when the entry already is", async () => {
    await renderWithRouter(form({ entry: { isPublic: false } }));
    expect(screen.getByLabelText(/Share this/)).not.toBeChecked();
  });
});

function fileInput(): HTMLInputElement {
  const input = document.querySelector("input[type='file']");
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

function jpeg(name = "a.jpg"): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("VerdictForm: photos", () => {
  it("shows the photos the entry already has", async () => {
    const { container } = await renderWithRouter(
      form({ entry: { photoKeys: ["entries/01USER/01ENTRY/a"] } }),
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute(
      "src",
      "/feed/photo/entries/01USER/01ENTRY/a",
    );
  });

  it("shows no grid at all when there are none", async () => {
    // Not an empty grid: a four-column grid with nothing in it is a gap
    // above the Add a photo link.
    const { container } = await renderWithRouter(form());
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".grid-cols-4")).toHaveLength(0);
  });

  it("shows the grid as soon as there is one photo", async () => {
    const { container } = await renderWithRouter(
      form({ entry: { photoKeys: ["a"] } }),
    );
    expect(container.querySelectorAll(".grid-cols-4")).toHaveLength(1);
  });

  it("uploads a photo as multipart, with its own idempotency key", async () => {
    // One key per file, not per submission: each photo is its own create.
    const user = userEvent.setup();
    const uploadPhoto = vi.fn<
      (input: { data: FormData }) => Promise<{ key: string }>
    >(() => Promise.resolve({ key: "new-key" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    const sent = uploadPhoto.mock.calls[0]?.[0]?.data;
    expect(sent?.get("entryId")).toBe("01JENTRY000000000000000000");
    expect(sent?.get("photo")).toBeInstanceOf(File);
    expect(typeof sent?.get("idempotencyKey")).toBe("string");
  });

  it("adds the uploaded photo to the grid", async () => {
    const user = userEvent.setup();
    const { container } = await renderWithRouter(
      form({ uploadPhoto: () => Promise.resolve({ key: "new-key" }) }),
    );

    await user.upload(fileInput(), jpeg());

    await waitFor(() => {
      expect(container.querySelectorAll("img")).toHaveLength(1);
    });
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/feed/photo/new-key",
    );
  });

  it("uploads several at once, each with its own key", async () => {
    const user = userEvent.setup();
    const keys: unknown[] = [];
    const uploadPhoto = vi.fn((input: { data: FormData }) => {
      keys.push(input.data.get("idempotencyKey"));
      return Promise.resolve({ key: `k${String(keys.length)}` });
    });
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), [jpeg("a.jpg"), jpeg("b.jpg")]);

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(2);
    });
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("refuses a type the server would refuse", async () => {
    // `applyAccept: false` so the file reaches the handler: the `accept`
    // attribute is a hint the browser may honour, and the check in the
    // handler is the one that has to hold.
    const user = userEvent.setup({ applyAccept: false });
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(
      fileInput(),
      new File(["x"], "a.gif", { type: "image/gif" }),
    );

    expect(
      await screen.findByText("Photos must be JPEG, PNG, or WebP."),
    ).toBeVisible();
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("keeps going past a refused file to the ones that are fine", async () => {
    // `continue`, not `break`: one bad file in a multi-select should not
    // silently drop the rest.
    const user = userEvent.setup({ applyAccept: false });
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), [
      new File(["x"], "a.gif", { type: "image/gif" }),
      jpeg("b.jpg"),
    ]);

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
  });

  it("stops at the cap, and says why", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry - 1 }, (_, i) =>
            String(i),
          ),
        },
        uploadPhoto,
      }),
    );

    await user.upload(fileInput(), [jpeg("a.jpg"), jpeg("b.jpg")]);

    // At the cap the Add-a-photo control is gone — and the sentence
    // explaining why has to outlive it, which is the whole point of the
    // field rendering when there is an error but no control.
    await waitFor(() => {
      expect(screen.queryByLabelText("Add a photo")).toBeNull();
    });
    expect(
      await screen.findByText(
        `Up to ${String(maxPhotosPerEntry)} photos per entry.`,
      ),
    ).toBeVisible();
    // The first went up; the second hit the cap.
    expect(uploadPhoto).toHaveBeenCalledTimes(1);
  });

  it("hides the picker entirely once the entry is full", async () => {
    const { container } = await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry }, (_, i) =>
            String(i),
          ),
        },
      }),
    );
    expect(container.querySelectorAll("input[type='file']")).toHaveLength(0);
  });

  it("says so when an upload fails", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({ uploadPhoto: () => Promise.reject(new Error("R2 unavailable")) }),
    );

    await user.upload(fileInput(), jpeg());

    expect(
      await screen.findByText("Couldn't upload that photo. Try again."),
    ).toBeVisible();
  });

  it("says it is uploading while it works, and stops after", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    await renderWithRouter(form({ uploadPhoto: () => pending.promise }));

    await user.upload(fileInput(), jpeg());

    expect(await screen.findByText("Uploading…")).toBeVisible();
    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(screen.getByText("Add a photo")).toBeVisible();
    });
  });

  it("does nothing when the picker is dismissed", async () => {
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    fileInput().dispatchEvent(new Event("change", { bubbles: true }));

    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("says nothing at rest", async () => {
    const { container } = await renderWithRouter(form());
    expect(container.querySelectorAll("p.text-pink")).toHaveLength(0);
  });

  it("clears the last photo message when a new one is picked", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const pending = Promise.withResolvers<{ key: string }>();
    const uploadPhoto = vi
      .fn<() => Promise<{ key: string }>>()
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(
      fileInput(),
      new File(["x"], "a.gif", { type: "image/gif" }),
    );
    expect(
      await screen.findByText("Photos must be JPEG, PNG, or WebP."),
    ).toBeVisible();

    await user.upload(fileInput(), jpeg("b.jpg"));

    await waitFor(() => {
      expect(
        screen.queryByText("Photos must be JPEG, PNG, or WebP."),
      ).toBeNull();
    });
    pending.resolve({ key: "k" });
  });
});

describe("VerdictForm: what happens after saving", () => {
  it("tells them what the run just did to a piece's record", async () => {
    // The point of the whole screen: a verdict is data about a garment in
    // a temperature band, and this is where the runner sees it land.
    const user = userEvent.setup();
    const itemBandWearStat = vi.fn(() =>
      Promise.resolve({ worn: 3, total: 5 }),
    );
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    expect(await screen.findByText("Houdini is now 3 of 5")).toBeVisible();
    expect(screen.getByText("[Noted]")).toBeVisible();
    expect(itemBandWearStat).toHaveBeenCalledWith({
      data: { itemId: "01JTEMA0000000000000000000", bandFloorC: 5 },
    });
  });

  it("goes straight to the entry when there is no band to count in", async () => {
    const user = userEvent.setup();
    const itemBandWearStat = vi.fn(() =>
      Promise.resolve({ worn: 1, total: 1 }),
    );
    const { router } = await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        itemBandWearStat,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/feed/entry/01JENTRY000000000000000000",
      );
    });
    expect(itemBandWearStat).not.toHaveBeenCalled();
  });

  it("goes straight there when the entry has no items either", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(form({ bandFloor: 5 }));

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/feed/entry/01JENTRY000000000000000000",
      );
    });
  });

  it("moves on from the noted screen when asked", async () => {
    const user = userEvent.setup();
    const { router } = await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat: () => Promise.resolve({ worn: 3, total: 5 }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    await screen.findByText("Houdini is now 3 of 5");

    await user.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/feed/entry/01JENTRY000000000000000000",
      );
    });
  });

  it("says so when the save fails, and leaves the form standing", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        submitVerdict: () => Promise.reject(new Error("D1 unavailable")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    // The band the contract defines, with the classifier's own sentence —
    // not a pink line of the form's own wording. Pink is action, never
    // failure.
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save verdict" })).toBeVisible();
  });

  it("clears the last failure on the next attempt", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<unknown>();
    const submitVerdict = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 unavailable"))
      .mockReturnValueOnce(pending.promise);
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(screen.queryByText("Our end failed. Nothing changed.")).toBeNull();
    });
    pending.resolve(undefined);
  });
});

describe("VerdictForm: the details that go missing silently", () => {
  it("offers the control at rest and withdraws it at the cap", async () => {
    // Three things at once, because they are one decision: the field
    // renders when there is a control *or* a message, the control itself
    // renders only below the cap, and the resting label is the words a
    // person taps. At the cap with nothing wrong there is no control and
    // nothing to say, so the whole field goes — anything else leaves an
    // "Add a photo" heading over empty space.
    await renderWithRouter(form());
    expect(screen.getByText("Add a photo")).toBeVisible();

    cleanup();

    await renderWithRouter(
      form({
        entry: {
          photoKeys: Array.from({ length: maxPhotosPerEntry }, (_, i) =>
            String(i),
          ),
        },
      }),
    );
    expect(screen.queryByText("Add a photo")).toBeNull();
  });

  it("says it is busy on the control, and starts one upload at a time", async () => {
    // Both halves of what the `disabled` attribute used to do, done the
    // way §5 requires: the input stays focusable and announces that work
    // is under way, and the re-entry guard lives in the handler. A second
    // selection mid-upload would race the cap count, which is counted
    // locally precisely because state does not settle between iterations.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    const uploadPhoto = vi.fn(() => pending.promise);
    await renderWithRouter(form({ uploadPhoto }));

    const input = fileInput();
    expect(input).not.toHaveAttribute("aria-busy");

    await user.upload(input, [jpeg("a.jpg")]);

    await waitFor(() => {
      expect(fileInput()).toHaveAttribute("aria-busy", "true");
    });
    // Still focusable, which a `disabled` input would not be.
    expect(fileInput()).toBeEnabled();

    await user.upload(fileInput(), [jpeg("b.jpg")]);
    expect(uploadPhoto).toHaveBeenCalledTimes(1);

    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(fileInput()).not.toHaveAttribute("aria-busy");
    });
  });

  it("says it is uploading while it uploads", async () => {
    // The label swaps for the duration, and nothing else on the screen
    // says work is under way — a photo that takes a moment would otherwise
    // look like a tap that did not register.
    const user = userEvent.setup();
    const pending = Promise.withResolvers<{ key: string }>();
    await renderWithRouter(form({ uploadPhoto: () => pending.promise }));

    await user.upload(fileInput(), [jpeg("a.jpg")]);

    expect(await screen.findByText("Uploading…")).toBeVisible();
    pending.resolve({ key: "k" });
    await waitFor(() => {
      expect(screen.queryByText("Uploading…")).toBeNull();
    });
  });

  it("submits through its own handler, never the browser's", async () => {
    // `event.preventDefault()`. Without it the browser navigates on submit
    // and the whole hook — validation, announcement, band — is skipped,
    // while the screen appears to do something.
    const user = userEvent.setup();
    await renderWithRouter(form());
    await user.click(screen.getByRole("button", { name: "Dialed" }));

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save verdict" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("announces the save before either exit destroys the region", async () => {
    // Both success paths take the live region with them — one navigates,
    // the other replaces the form with the noted screen — so the sentence
    // cannot be read after the fact. It is observable in exactly one
    // window: `onSuccess` has set the status and is awaiting the band
    // stat, so the form is still mounted with the region filled. Holding
    // that promise open is what makes the window big enough to assert in.
    //
    // That the window exists at all is D-44's fix: before it, the status
    // and the unmount landed in the same commit.
    const user = userEvent.setup();
    const stat = Promise.withResolvers<{ worn: number; total: number }>();
    await renderWithRouter(
      form({
        bandFloor: -5,
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        itemBandWearStat: () => stat.promise,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Save verdict" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verdict saved.");
    });

    stat.resolve({ worn: 3, total: 7 });
    expect(await screen.findByText(/Houdini is now 3 of 7/)).toBeVisible();
  });
});

/**
 * A step that records what it was handed and lets the test decide when the
 * blurred bytes come back — which is the whole contract: the picked file
 * waits, and something else says what gets uploaded.
 */
function recordingStep() {
  const seen: File[] = [];
  let release: ((ready: File) => void) | undefined;
  // Captured, never called during render. `announce` writes the form's
  // state, and a child that writes its parent's state while rendering is
  // an infinite loop — which is exactly why `PhotoBlur` announces from an
  // effect, and why a fixture that does otherwise proves nothing about it.
  let say: ((sentence: string) => void) | undefined;
  const render = (
    file: File,
    onReady: (ready: File) => void,
    announce: (sentence: string) => void,
  ) => {
    seen.push(file);
    release = onReady;
    say = announce;
    return <p>step for {file.name}</p>;
  };
  return {
    seen,
    render,
    hand: (ready: File) => release?.(ready),
    announce: (sentence: string) => {
      say?.(sentence);
    },
  };
}

describe("the photo step W3 hangs off", () => {
  it("has one status region on the screen, and lends it to the step", async () => {
    // Rule 08: *"one `role=\"status\"` region per screen"*. This screen
    // used to have two — the form's, and a second `aria-live` paragraph
    // inside `PhotoBlur` for W3's three sentences — and two regions
    // firing at once means one of them is lost.
    //
    // The count is the assertion that matters: a step that opened its own
    // region would still announce, and still be wrong.
    const user = userEvent.setup();
    const step = recordingStep();
    const { container } = await renderWithRouter(
      form({
        uploadPhoto: vi.fn(() => Promise.resolve({ key: "k" })),
        renderPhotoStep: step.render,
      }),
    );

    await user.upload(fileInput(), jpeg());

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    act(() => {
      step.announce("We blurred one face.");
    });

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "We blurred one face.",
      );
    });
  });

  it("holds the picked file instead of uploading it", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    const step = recordingStep();
    await renderWithRouter(form({ uploadPhoto, renderPhotoStep: step.render }));

    await user.upload(fileInput(), jpeg());

    // **The whole promise of W3.** If the picked file uploads while the
    // blur step is on screen, the original frame has already left the
    // device and the step is decoration.
    expect(uploadPhoto).not.toHaveBeenCalled();
    expect(step.seen.map((file) => file.name)).toEqual(["a.jpg"]);
    expect(screen.getByText("step for a.jpg")).toBeVisible();
  });

  it("uploads the bytes the step hands back, not the ones picked", async () => {
    const user = userEvent.setup();
    const uploaded: string[] = [];
    const uploadPhoto = vi.fn((input: { data: FormData }) => {
      const part = input.data.get("photo");
      uploaded.push(part instanceof File ? part.name : "not a file");
      return Promise.resolve({ key: "k" });
    });
    const step = recordingStep();
    await renderWithRouter(form({ uploadPhoto, renderPhotoStep: step.render }));
    await user.upload(fileInput(), jpeg());

    step.hand(
      new File([new Uint8Array([9])], "blurred.jpg", { type: "image/jpeg" }),
    );

    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
    expect(uploaded).toEqual(["blurred.jpg"]);
  });

  it("says it is uploading, then puts the step away", async () => {
    const user = userEvent.setup();
    const inFlight = Promise.withResolvers<{ key: string }>();
    const step = recordingStep();
    await renderWithRouter(
      form({
        uploadPhoto: () => inFlight.promise,
        renderPhotoStep: step.render,
      }),
    );
    await user.upload(fileInput(), jpeg());

    step.hand(jpeg("blurred.jpg"));

    expect(await screen.findByText("Uploading…")).toBeVisible();
    inFlight.resolve({ key: "k" });
    // The step goes when its answer has been taken. Left up, it reads as
    // a photo still waiting to be blurred — over one already uploaded.
    await waitFor(() => {
      expect(screen.queryByText(/^step for/)).not.toBeInTheDocument();
    });
    // And the form stops saying it is working. "Uploading…" that never
    // clears is the same screen as an upload that never finished.
    await waitFor(() => {
      expect(screen.getByText("Add a photo")).toBeVisible();
    });
  });

  it("reports a failure after the step the same way as one before it", async () => {
    const user = userEvent.setup();
    const step = recordingStep();
    await renderWithRouter(
      form({
        uploadPhoto: () => Promise.reject(new Error("R2 unavailable")),
        renderPhotoStep: step.render,
      }),
    );
    await user.upload(fileInput(), jpeg());

    step.hand(jpeg("blurred.jpg"));

    // The blur step does not get its own error vocabulary: a failed
    // upload is a failed upload, and the runner's next move is the same.
    expect(
      await screen.findByText("Couldn't upload that photo. Try again."),
    ).toBeVisible();
  });

  it("lets a second photo through after the first has landed", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    const step = recordingStep();
    await renderWithRouter(form({ uploadPhoto, renderPhotoStep: step.render }));

    await user.upload(fileInput(), jpeg("one.jpg"));
    step.hand(jpeg("one-blurred.jpg"));
    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });

    await user.upload(fileInput(), jpeg("two.jpg"));
    step.hand(jpeg("two-blurred.jpg"));

    // The in-flight guard has to be released by the step's path too, or
    // the first photo is the only one a runner can ever add.
    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(2);
    });
  });

  it("uploads straight away when no step is supplied", async () => {
    const user = userEvent.setup();
    const uploadPhoto = vi.fn(() => Promise.resolve({ key: "k" }));
    await renderWithRouter(form({ uploadPhoto }));

    await user.upload(fileInput(), jpeg());

    // The garment path and anything else that has no blur step: the slot
    // is optional and its absence must not swallow the upload.
    await waitFor(() => {
      expect(uploadPhoto).toHaveBeenCalledTimes(1);
    });
  });

  it("shows no step until a file has been picked", async () => {
    const step = recordingStep();
    await renderWithRouter(form({ renderPhotoStep: step.render }));

    // Rendering it unconditionally would call the slot with nothing to
    // show — which is how a blur screen appears over a form nobody has
    // given a photo to.
    expect(step.seen).toEqual([]);
    expect(screen.queryByText(/^step for/)).not.toBeInTheDocument();
  });
});

/**
 * The log flow's three screens are three routes, so the move that carries
 * "which way you are travelling" has to be on each of them — and a screen
 * that quietly loses its wrapper animates nothing, with nothing to say so.
 *
 * The wrapper is what is asserted, not a particular class. Round 12 made
 * the *arrival* a third state: entering the flow from the bar is the
 * router's `rise`, so `FlowStep` deliberately adds no class there, and a
 * screen rendered on its own — as here — is always entering.
 */
describe("VerdictForm: the log flow", () => {
  it("is step three of the log flow, and enters from an edge", async () => {
    await renderWithRouter(form());

    const step = document.querySelector("[data-flow-direction]");
    expect(step).not.toBeNull();
    // Mounted with no step before it, so this is the way in: the class is
    // absent precisely because the rise is the move.
    expect(step).toHaveAttribute("data-flow-direction", "entering");
    expect(step?.className).toBe("");
  });
});
