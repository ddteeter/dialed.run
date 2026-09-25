import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { entryTags, verdictScale } from "../../src/lib/contracts";
import type { BandSignals } from "../../src/modules/feed/band-signals";
import type { Units } from "../../src/lib/contracts";
import { verdictHue } from "../../src/ui/verdict-hue";
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

/**
 * Opens A3b, where every garment's triple and all nine tags live since
 * round 20 moved them off A3. Returns the sheet, so a query can be scoped
 * to it rather than finding the same tag twice — once as a chip, once here.
 */
async function openSpecifics(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "More ›" }));
  return screen.findByRole("dialog", { name: "Anything specific?" });
}

const nothing = () => Promise.resolve();
const noStat = () => Promise.resolve({ worn: 1, total: 1 });

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
    bandCounts?: Readonly<Record<number, number>>;
    bandSignals?: BandSignals;
    units?: Units;
    submitVerdict?: (input: {
      data: Record<string, unknown>;
    }) => Promise<unknown>;
    itemBandWearStat?: (input: {
      data: { itemId: string; bandFloorC: number };
    }) => Promise<{ worn: number; total: number }>;
  } = {},
) {
  return (
    <VerdictForm
      entry={entry(overrides.entry)}
      bandFloor={overrides.bandFloor}
      history={
        overrides.bandCounts === undefined &&
        overrides.bandSignals === undefined
          ? undefined
          : {
              counts: overrides.bandCounts ?? {},
              signals: overrides.bandSignals ?? { garments: {}, tagUse: {} },
            }
      }
      units={overrides.units ?? { temp: "f", distance: "mi" }}
      submitVerdict={overrides.submitVerdict ?? nothing}
      itemBandWearStat={overrides.itemBandWearStat ?? noStat}
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
    await user.click(screen.getByRole("button", { name: "Log it" }));

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

    const save = screen.getByRole("button", { name: "Log it" });
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

    // Teal, because the chosen cell wears its verdict's hue (round 19).
    expect(screen.getByRole("button", { name: "Dialed" })).toHaveClass(
      "bg-teal",
    );
    expect(screen.getByRole("button", { name: "Way cold" })).not.toHaveClass(
      "bg-action",
    );
    expect(screen.getByRole("button", { name: "Log it" })).toBeEnabled();
  });

  it.each(verdictScale)(
    "fills a chosen $label with its T2 hue — the same classes DS2 reads",
    async ({ label, value }) => {
      // **The mirror, asserted.** Round 19: *"the chosen cell fills with
      // its T2 hue — cold pink, dialed teal, warm quiet grey — exactly as
      // DS2's row does; --action is never a verdict fill."* A3 filled
      // `bg-ink` whatever the verdict, its board drew `--action` pink
      // whatever the verdict, and the backlog filled by hue — three
      // answers on two surfaces that were ruled to read the same.
      //
      // `verdictHue` is the one table both surfaces read, so asserting A3
      // carries exactly its output is asserting the mirror holds.
      const user = userEvent.setup();
      await renderWithRouter(form());

      await user.click(screen.getByRole("button", { name: label }));

      const chosen = screen.getByRole("button", { name: label });
      expect(chosen).toHaveClass(...verdictHue(value).split(" "));
      expect(chosen).not.toHaveClass("bg-ink");
      // A border on the chosen cell too, so choosing swaps a colour
      // rather than adding a pixel.
      expect(chosen).toHaveClass("border");
    },
  );

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
      "bg-teal",
    );
    expect(screen.getByRole("button", { name: "Log it" })).toBeEnabled();
  });

  it("sends the number, not the label", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("button", { name: "Way warm" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

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

describe("VerdictForm: A3b, every garment's triple", () => {
  it("offers a flag per item, defaulting to none", async () => {
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

    await openSpecifics(user);
    // "Anything specific?" is the board's question for this block.
    expect(
      screen.getByRole("heading", { name: "Anything specific? · optional" }),
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

  it("still asks, with tags alone, when the entry has no garments on it", async () => {
    // An entry saved with a bare kit — which `attachKit` allows — has no
    // garment to flag, but tags are about the run, so the question stays
    // and A3b simply holds no garment groups.
    const user = userEvent.setup();
    await renderWithRouter(form({ entry: { items: [] } }));

    expect(
      screen.getByRole("heading", { name: "Anything specific? · optional" }),
    ).toBeVisible();
    await openSpecifics(user);
    // `flagGroups()`, not every group on the screen: the verdict row is
    // itself a fieldset, and it is there whether or not the kit has
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

    await openSpecifics(user);
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
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
      }),
    );

    await openSpecifics(user);
    expect(chosenFlag(flagGroup(0))).toHaveAccessibleName("Fine");
  });

  it("starts from the flag the item already carries", async () => {
    // Re-opening a verdict used to show every piece as unflagged, so
    // saving again cleared a flag the runner had set.
    const user = userEvent.setup();
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

    await openSpecifics(user);
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
    await user.click(screen.getByRole("button", { name: "Log it" }));

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

    await openSpecifics(user);
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
    await openSpecifics(user);
    await user.click(
      within(flagGroup(0)).getByRole("radio", { name: "Too much" }),
    );
    await user.click(screen.getByRole("button", { name: "Log it" }));

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
    await openSpecifics(user);
    const group = flagGroup(0);
    await user.click(within(group).getByRole("radio", { name: "Too much" }));
    await user.click(within(group).getByRole("radio", { name: "Fine" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: "01JTEMA0000000000000000000", flag: undefined },
    ]);
  });
});

/**
 * A kit whose band record makes the chip rule's choice obvious: the shell
 * has been dialed once in four runs here, the cap three times in four. So
 * a warm verdict suggests the shell first, and a cold one does too.
 */
const SHELL = "01JTEMA0000000000000000000";
const CAP = "01JTEMB0000000000000000000";
const SIGNALS: BandSignals = {
  garments: {
    [SHELL]: { total: 4, dialed: 1, colder: 1, warmer: 2 },
    [CAP]: { total: 4, dialed: 3, colder: 0, warmer: 1 },
  },
  tagUse: { sleeves_damp: 3 },
};
const KIT = [item(SHELL, "Shell"), item(CAP, "Cap")];

/**
The chips row, as the runner sees it: each chip's name, in order.
*/
function chipNames(): string[] {
  const row = document.querySelector("[data-slot='flag-chips']");
  if (!(row instanceof HTMLElement)) throw new Error("no chips row");
  return within(row)
    .getAllByRole("button")
    .map((chip) => chip.textContent);
}

describe("VerdictForm: the generated chips (round 20)", () => {
  it("draws five chips and MORE, garments first once a verdict sets their direction", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({ entry: { items: KIT }, bandSignals: SIGNALS }),
    );

    // Before a verdict: tags only, the runner's most used first.
    expect(chipNames()).toStrictEqual([
      "sleeves damp",
      // Unused tags fill the rest, in the contract's own order.
      "cold first mile",
      "cold throughout",
      "overheated late",
      "chafed",
      "More ›",
    ]);

    await user.click(screen.getByRole("button", { name: "A bit warm" }));
    expect(chipNames().slice(0, 3)).toStrictEqual([
      "Shell too much",
      "Cap too much",
      "sleeves damp",
    ]);
    expect(chipNames()).toHaveLength(6);

    // Changing the verdict recomputes the unchosen chips.
    await user.click(screen.getByRole("button", { name: "A bit cold" }));
    expect(chipNames().slice(0, 2)).toStrictEqual([
      "Shell not enough",
      "Cap not enough",
    ]);
  });

  it("suggests no garment when the run has no band to read", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form({ entry: { items: KIT } }));

    await user.click(screen.getByRole("button", { name: "Way warm" }));
    expect(chipNames()).toStrictEqual([
      "cold first mile",
      "cold throughout",
      "overheated late",
      "sleeves damp",
      "chafed",
      "More ›",
    ]);
  });

  it("chooses the garment chip's flag, keeps it through a verdict change, and sends it", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(
      form({ entry: { items: KIT }, bandSignals: SIGNALS, submitVerdict }),
    );
    await user.click(screen.getByRole("button", { name: "A bit warm" }));

    const shell = screen.getByRole("button", { name: "Shell too much" });
    expect(shell).toHaveAttribute("aria-pressed", "false");
    await user.click(shell);
    expect(
      screen.getByRole("button", { name: "Shell too much" }),
    ).toHaveAttribute("aria-pressed", "true");

    // "Chosen chips stay": a cold verdict would suggest "Shell not
    // enough", but the runner already said too much.
    await user.click(screen.getByRole("button", { name: "A bit cold" }));
    expect(chipNames().slice(0, 2)).toStrictEqual([
      "Shell too much",
      "Cap not enough",
    ]);

    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data.itemFlags).toStrictEqual([
      { itemId: SHELL, flag: "too_much" },
      { itemId: CAP, flag: undefined },
    ]);
  });

  it("puts a chosen garment back to Fine on a second tap, not the other way", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: {
          items: [{ ...item(SHELL, "Shell"), flag: "too_much" as const }],
        },
        bandSignals: SIGNALS,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Shell too much" }));

    expect(
      screen.queryByRole("button", { name: "Shell too much", pressed: true }),
    ).toBeNull();
    const sheet = await openSpecifics(user);
    expect(within(sheet).getByRole("radio", { name: "Fine" })).toBeChecked();
  });

  it("toggles a tag chip on and off, and sends what is on", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ bandSignals: SIGNALS, submitVerdict }));

    await user.click(screen.getByRole("button", { name: "sleeves damp" }));
    await user.click(screen.getByRole("button", { name: "cold first mile" }));
    await user.click(screen.getByRole("button", { name: "cold first mile" }));
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      tags: ["sleeves_damp"],
    });
  });

  it("marks a chosen chip with the close glyph, and only a chosen one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form({ bandSignals: SIGNALS }));
    const damp = screen.getByRole("button", { name: "sleeves damp" });
    expect(damp.querySelector("svg")).toBeNull();
    expect(damp).toHaveClass("border-hairline", "text-quiet");

    await user.click(damp);

    const chosen = screen.getByRole("button", { name: "sleeves damp" });
    expect(chosen.querySelector("svg")).not.toBeNull();
    expect(chosen).toHaveClass("bg-ink", "text-ground");
  });

  it("shows a choice made in A3b as a pressed chip when the sheet closes", async () => {
    // "That is how 'the Harrier was not enough' is said when it wasn't
    // suggested" — and once said, it is on A3 like any other choice.
    const user = userEvent.setup();
    await renderWithRouter(
      form({ entry: { items: KIT }, bandSignals: SIGNALS }),
    );
    await user.click(screen.getByRole("button", { name: "A bit warm" }));

    const sheet = await openSpecifics(user);
    const cap = within(sheet).getByRole("group", { name: "Cap" });
    await user.click(within(cap).getByRole("radio", { name: "Not enough" }));
    await user.click(within(sheet).getByRole("button", { name: "hands cold" }));
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Cap not enough" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "hands cold" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says MORE opens a dialog, and is live until the verdict is noted", async () => {
    await renderWithRouter(form());
    const more = screen.getByRole("button", { name: "More ›" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    // Read-only is the receipt's state, not the resting one.
    expect(more).not.toHaveAttribute("aria-disabled");
  });
});

describe("VerdictForm: tags and sharing", () => {
  it("offers every tag the contract defines, in words, in A3b", async () => {
    // "Plus all nine tags" (round 20) — the chips show five; the sheet is
    // where the other four are said.
    const user = userEvent.setup();
    await renderWithRouter(form());
    const sheet = await openSpecifics(user);
    expect(
      within(sheet).getAllByRole("button", { pressed: false }),
    ).toHaveLength(entryTags.length);
    for (const tag of entryTags) {
      expect(
        within(sheet).getByRole("button", { name: tag.replaceAll("_", " ") }),
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
    await user.click(screen.getByRole("button", { name: "Log it" }));
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
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      tags: ["chafed"],
    });
  });

  it("names the toggle in three words and says what sharing means beneath", async () => {
    // A3's share-toggle as round 19 draws it. The sentence is the
    // checkbox's *description*, not part of its name, so a reader hears
    // "Share to feed, checkbox, checked" and then what that means — rather
    // than one long label, which is what "Share this — the verdict label
    // shows on the post" was.
    await renderWithRouter(form());

    const share = screen.getByRole("checkbox", { name: "Share to feed" });
    expect(share).toHaveAccessibleDescription(
      "Shared runs show your kit, conditions, and your verdict.",
    );
  });

  it("is shared by default, and can be made private", async () => {
    // Entries are public by default with a per-entry toggle.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    const share = screen.getByLabelText("Share to feed");
    expect(share).toBeChecked();

    await user.click(share);
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      isPublic: false,
    });
  });

  it("starts private when the entry already is", async () => {
    await renderWithRouter(form({ entry: { isPublic: false } }));
    expect(screen.getByLabelText("Share to feed")).not.toBeChecked();
  });
});

describe("VerdictForm: the history line beneath the row (D-97)", () => {
  it("shows this runner's history in the band, which the route already loads", async () => {
    // The verdict route has fetched `verdictBandCounts` on every visit and
    // discarded it; round 20 put the line beneath the row.
    await renderWithRouter(
      form({ bandFloor: 5, bandCounts: { "-1": 2, "0": 7, "1": 1 } }),
    );

    expect(
      screen.getByText("[41–50°] · 2 cold · 7 dialed · 1 warm"),
    ).toBeVisible();
  });

  it("draws no line for a run with no band", async () => {
    // No conditions, no band, no counts — nothing to state.
    await renderWithRouter(form({ bandCounts: { "0": 7 } }));

    expect(screen.queryByText(/Five states/)).toBeNull();
  });

  it("draws no line when the counts did not load", async () => {
    await renderWithRouter(form({ bandFloor: 5 }));

    expect(screen.queryByText(/Five states/)).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Log it" }));

    // The band, as board A3 writes it: "Half-zip is now 8 of 9 in
    // 38–46°." 5°C is 41°F, and a band is five degrees Celsius wide.
    const sentence = await screen.findByText(
      "Houdini is now 3 of 5 in 41–50°.",
    );
    expect(sentence).toBeVisible();
    // Announced when it lands: the button just pressed has gone, and this
    // is what took its place.
    const receipt = sentence.closest("[role='status']");
    expect(receipt).not.toBeNull();
    expect(receipt).toHaveTextContent(/^Noted/);
    expect(itemBandWearStat).toHaveBeenCalledWith({
      data: { itemId: "01JTEMA0000000000000000000", bandFloorC: 5 },
    });
  });

  it("locks and lands Noted when the save worked but the count did not come back", async () => {
    // The stat is read after the verdict has landed. A throw from it used
    // to reach the form as the submission's own failure — "Nothing saved",
    // the form unlocked — about a verdict that was saved.
    const user = userEvent.setup();
    const submitVerdict = vi.fn(() => Promise.resolve({ ok: true }));
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        submitVerdict,
        itemBandWearStat: () => Promise.reject(new Error("D1 hiccup")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    const receipt = await waitFor(() => {
      const found = document.querySelector("[data-slot='noted']");
      if (found === null) throw new Error("no receipt yet");
      return found;
    });
    expect(receipt).toHaveTextContent(/^Noted$/u);
    // No empty sentence standing in for the missing one.
    expect(receipt.querySelector("p")).toBeNull();
    expect(screen.queryByText(/Nothing saved/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Log it" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dialed" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(submitVerdict).toHaveBeenCalledTimes(1);
  });

  it("lands a receipt naming the missing weather when there is no band, and stays", async () => {
    // Round 21, ask 3: "Draw a receipt … A3 never navigates; jumping
    // straight to the entry breaks that on exactly the runs where the
    // runner most wonders if it worked." It used to go to the entry.
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
    await user.click(screen.getByRole("button", { name: "Log it" }));

    const sentence = await screen.findByText(
      "Logged. No weather came with this run, so no band record moved.",
    );
    expect(sentence.closest("[role='status']")).toHaveTextContent(/^Noted/);
    expect(router.state.location.pathname).toBe("/");
    // No band, no record to read — the stat is never asked for.
    expect(itemBandWearStat).not.toHaveBeenCalled();
  });

  it("names the missing kit when there is a band but nothing was worn", async () => {
    const user = userEvent.setup();
    const itemBandWearStat = vi.fn(() =>
      Promise.resolve({ worn: 1, total: 1 }),
    );
    const { router } = await renderWithRouter(
      form({ bandFloor: 5, itemBandWearStat }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    expect(
      await screen.findByText(
        "Logged. No kit on this run, so no garment record moved.",
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe("/");
    expect(itemBandWearStat).not.toHaveBeenCalled();
  });

  it("names the weather first when both are missing — the wider gap", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    expect(
      await screen.findByText(
        "Logged. No weather came with this run, so no band record moved.",
      ),
    ).toBeVisible();
  });

  it("lands the receipt in the submit's place, with the answer still on screen", async () => {
    // Design round 20: "Noted is a receipt, not a preview: it lands after
    // Log it in the submit's place, replacing share-toggle and submit; the
    // verdict row and chips stay, read-only, so the receipt is read
    // against the answer. No button in it — the tab bar is the exit."
    //
    // It used to replace the whole screen — "Noted", the sentence and a
    // Done button — so the answer it was a receipt for was gone.
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat: () => Promise.resolve({ worn: 3, total: 5 }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/);

    // In the submit's place: share and submit are gone, and there is no
    // button standing in for them.
    expect(screen.queryByRole("button", { name: "Log it" })).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Share to feed" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    // The answer stays — the chosen verdict still pressed.
    const dialed = screen.getByRole("button", { name: "Dialed" });
    expect(dialed).toHaveAttribute("aria-pressed", "true");
  });

  it("is answerable until it is logged — nothing is read-only on the way in", async () => {
    // The other half of the lock. A form locked from the start is a form
    // nobody can answer, and only a test that looks before Log it can see
    // that.
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
      }),
    );

    for (const step of verdictScale) {
      expect(
        screen.getByRole("button", { name: step.label }),
      ).not.toHaveAttribute("aria-disabled");
    }
    expect(screen.getByRole("button", { name: "chafed" })).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("holds the answer read-only once it is noted, without dropping it from the tab order", async () => {
    // Read-only, not `disabled`: accessibility rule 07 bans taking a
    // control out of the tab order, and a receipt is for reading.
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat: () => Promise.resolve({ worn: 3, total: 5 }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/);

    const wayCold = screen.getByRole("button", { name: "Way cold" });
    expect(wayCold).toHaveAttribute("aria-disabled", "true");
    expect(wayCold).not.toBeDisabled();
    await user.click(wayCold);
    expect(screen.getByRole("button", { name: "Dialed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(wayCold).toHaveAttribute("aria-pressed", "false");

    const tag = screen.getByRole("button", { name: "chafed" });
    expect(tag).toHaveAttribute("aria-disabled", "true");
    await user.click(tag);
    expect(tag).toHaveAttribute("aria-pressed", "false");

    // MORE › leaves with share and submit (round 21, ask 1a): "an inert
    // control that still looks tappable is a lie". Not read-only — gone.
    expect(screen.queryByRole("button", { name: "More ›" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a chosen chip inked once noted, and takes its ✕ away", async () => {
    // Round 21: "the chips stay, read-only (chosen still inked, no ✕)".
    // The ✕ offers to un-choose, and a receipt makes no offers.
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        bandFloor: 5,
        itemBandWearStat: () => Promise.resolve({ worn: 3, total: 5 }),
      }),
    );
    await user.click(screen.getByRole("button", { name: "chafed" }));
    expect(
      screen.getByRole("button", { name: "chafed" }).querySelector("svg"),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/);

    const chafed = screen.getByRole("button", { name: "chafed" });
    expect(chafed).toHaveAttribute("aria-pressed", "true");
    expect(chafed).toHaveClass("bg-ink", "text-ground");
    expect(chafed.querySelector("svg")).toBeNull();
  });

  it("says so when the save fails, and leaves the form standing", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        submitVerdict: () => Promise.reject(new Error("D1 unavailable")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    // The band the contract defines, with the classifier's own sentence —
    // not a pink line of the form's own wording. Pink is action, never
    // failure.
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log it" })).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Log it" }));
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(screen.queryByText("Our end failed. Nothing changed.")).toBeNull();
    });
    pending.resolve(undefined);
  });
});

describe("VerdictForm: the details that go missing silently", () => {
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
      await user.click(screen.getByRole("button", { name: "Log it" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("announces the save before the receipt lands", async () => {
    // Noted takes the submit's place, so the sentence has to be said
    // while the form still stands. It is observable in exactly one
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
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verdict saved.");
    });

    stat.resolve({ worn: 3, total: 7 });
    expect(await screen.findByText(/Houdini is now 3 of 7/)).toBeVisible();
  });
});

describe("VerdictForm: the run header (round 21)", () => {
  // 2026-08-29 11:04 UTC — 6:04 AM in Chicago, the board's own morning.
  const SAT_MORNING = Math.floor(Date.UTC(2026, 7, 29, 11, 4) / 1000);
  const conditions = {
    tempC: 5,
    feelsLikeC: 2,
    precipMm: 1,
    condition: "light rain",
    windKph: 14,
    source: "visualcrossing" as const,
    timeZone: "America/Chicago",
    span: { minTempC: 5, maxTempC: 5, minFeelsLikeC: 2, maxFeelsLikeC: 2 },
  };

  it("dates the run where it happened, and says how far at what", async () => {
    // "SAT AUG 29 · 6:04 AM / 6.2 AT 41°" — the zone is the observation's
    // (D-96), so a Chicago morning is not read as UTC's 11 AM.
    await renderWithRouter(
      form({
        entry: { startedAt: SAT_MORNING, distanceM: 9978, conditions },
      }),
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-slot", "header");
    expect(header).toHaveAttribute("data-ground", "ink");
    expect(within(header).getByText("Sat 29 Aug · 6:04 AM")).toBeVisible();
    expect(within(header).getByText("6.2 at 41°")).toBeVisible();
  });

  it("names the unit instead of a temperature when the run has none", async () => {
    // The nothing-moved frame: "6.2 MI". No conditions, no "at", and the
    // date falls back to UTC.
    await renderWithRouter(
      form({ entry: { startedAt: SAT_MORNING, distanceM: 9978 } }),
    );

    const header = screen.getByRole("banner");
    expect(within(header).getByText("6.2 mi")).toBeVisible();
    expect(within(header).getByText("Sat 29 Aug · 11:04 AM")).toBeVisible();
  });

  it("reads the runner's own units", async () => {
    await renderWithRouter(
      form({
        entry: { distanceM: 9978, conditions },
        units: { temp: "c", distance: "km" },
      }),
    );

    expect(screen.getByText("10.0 at 5°")).toBeVisible();
  });

  it("asks the question once, as the heading, and the row is named by it", async () => {
    await renderWithRouter(form());

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Did it work?");
    expect(within(screen.getByRole("banner")).getByRole("heading")).toBe(
      heading,
    );
    expect(screen.getAllByText("Did it work?")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "Did it work?" })).toBeVisible();
  });

  it("marks the row when a save is refused for want of a verdict", async () => {
    // The sentence lives under the row, where the fix is, on the field
    // message the Form Contract draws.
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Log it" }));

    const group = screen.getByRole("group", { name: "Did it work?" });
    expect(group.querySelector("#verdict-message")).not.toBeNull();
  });
});

describe("VerdictChips and A3b: the 32px chip (round 21)", () => {
  it("draws every chip and MORE at 32, with the seam that makes the hit area 44", async () => {
    // "Chips draw at 32px; a ::before at inset: -6px 0 makes the target
    // 44." `target` would pad the box to 44, which is the height the
    // ruling takes away; the seam is `ui/a11y.css`'s.
    const user = userEvent.setup();
    await renderWithRouter(form());

    const chips = document.querySelector("[data-slot='flag-chips']");
    expect(chips).toHaveClass("gap-x-[7px]", "gap-y-3");
    const cells = [...(chips?.children ?? [])];
    expect(cells).toHaveLength(6);
    for (const chip of cells) {
      expect(chip).toHaveClass("target-seam", "h-8");
      expect(chip).not.toHaveClass("target");
    }

    await user.click(screen.getByRole("button", { name: "chafed" }));
    expect(screen.getByRole("button", { name: "chafed" })).toHaveClass(
      "target-seam",
      "h-8",
    );
  });

  it("says in A3b which verdict the specifics qualify", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    let sheet = await openSpecifics(user);
    expect(within(sheet).getByText("Optional")).toBeVisible();
    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "A bit warm" }));
    sheet = await openSpecifics(user);
    expect(within(sheet).getByText("A bit warm · optional")).toBeVisible();
    // A3b's tags are the same 32px chips, in the same seam-gapped row.
    const tag = within(sheet).getByRole("button", { name: "chafed" });
    expect(tag).toHaveClass("target-seam", "h-8");
    expect(tag.parentElement).toHaveClass("gap-x-[7px]", "gap-y-3");
  });
});

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
