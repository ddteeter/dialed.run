import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { drawnText } from "./spoken-text";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type { MatcherFunction } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX, ReactElement, ReactNode } from "react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { entryTags, verdictScale } from "../../src/lib/contracts";
import type { BandRun } from "../../src/modules/feed/band-runs";
import type { BandSignals } from "../../src/modules/feed/band-signals";
import type { Units } from "../../src/lib/contracts";
import { PUBLIC_PREVIEW_LINE } from "../../src/ui/audience";
import { verdictHue } from "../../src/ui/verdict-hue";
import { VerdictForm } from "../../src/modules/feed/components/VerdictForm";
import type { entryDetailForViewer } from "../../src/modules/feed/entries";
import { PrivateRunLine } from "../../src/modules/onboarding/components/PrivateRunLine";
import { UnconfirmedRefusalAnswer } from "../../src/ui/unconfirmed-refusal";
import type { ConfirmGate } from "../../src/ui/unconfirmed-refusal";
import { queryWeatherCredit } from "../ui/weather-credit";
import { carriedSince } from "../ui/carry-spy";
import { atWidth, withBell } from "./feed-fixtures";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

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
    authorUsername: undefined,
    runId: "01JRAN00000000000000000000",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: 1_755_000_000,
    indoor: false,
    deviceName: undefined,
    verdict: undefined,
    audience: "runners",
    createdAt: 1_755_000_000,
    items: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    conditions: undefined,
    underReview: false,
    effort: undefined,
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
  url: undefined,
});

/**
 * The per-item flag groups, in document order.
 *
 * Radio groups since design round 16: a `<select>` beside the kit read as
 * the verdict control, which is what a reviewer took it for on film. Each
 * group is legended with its garment's name, so they are found by role
 * and named rather than by index into a list of comboboxes.
 */
/**
 * A verdict's cell: the label its radio sits in, which is what wears the
 * hue, the brackets and the hit area.
 */
function cell(name: string): HTMLElement {
  const label = screen.getByRole("radio", { name }).closest("label");
  if (label === null) throw new TypeError(`no cell for ${name}`);
  return label;
}

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
  // And A3's audience picker is a radio group too (round 41 #86a), so a
  // flag group is one whose radios are not the audience's.
  return screen.getAllByRole("group").filter((group) =>
    within(group)
      .queryAllByRole("radio")
      .some((radio) => radio.getAttribute("name") !== "audience"),
  );
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
  await user.click(
    screen.getByRole("button", { name: "More, anything specific" }),
  );
  return screen.findByRole("dialog", { name: "Anything specific?" });
}

const nothing = () => Promise.resolve();
const noStat = () => Promise.resolve({ worn: 1, total: 1 });
const privateLineStub = (hintId: string) => (
  <span id={hintId}>The private line.</span>
);

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
    bandRuns?: readonly BandRun[];
    units?: Units;
    submitVerdict?: (input: {
      data: Record<string, unknown>;
    }) => Promise<unknown>;
    itemBandWearStat?: (input: {
      data: { itemId: string; bandFloorC: number };
    }) => Promise<{ worn: number; total: number }>;
    privateLine?: (hintId: string) => ReactNode;
    isVerified?: boolean;
    push?: { isPushed: boolean; onPush: () => void; onDone: () => void };
  } = {},
) {
  return (
    <VerdictForm
      entry={entry(overrides.entry)}
      bandFloor={overrides.bandFloor}
      history={
        overrides.bandCounts === undefined &&
        overrides.bandSignals === undefined &&
        overrides.bandRuns === undefined
          ? undefined
          : {
              counts: overrides.bandCounts ?? {},
              signals: overrides.bandSignals ?? { garments: {}, tagUse: {} },
              runs: overrides.bandRuns ?? [],
            }
      }
      units={overrides.units ?? { temp: "f", distance: "mi" }}
      submitVerdict={overrides.submitVerdict ?? nothing}
      itemBandWearStat={overrides.itemBandWearStat ?? noStat}
      privateLine={overrides.privateLine ?? privateLineStub}
      isVerified={overrides.isVerified ?? true}
      push={overrides.push ?? NOT_PUSHED}
    />
  );
}

function stays(): void {
  // Not pushed, and nowhere to go.
}

const NOT_PUSHED = { isPushed: false, onPush: stays, onDone: stays };

describe("VerdictForm: the scale", () => {
  it("offers every verdict the contract defines, in order", async () => {
    // Read from `verdictScale`, not restated — the labels here and the
    // ones the feed renders are the same list.
    await renderWithRouter(form());

    const labels = verdictScale.map((choice) => choice.label);
    for (const label of labels) {
      expect(screen.getByRole("radio", { name: label })).toBeVisible();
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
              { path: ["audience"], message: "Not allowed for this account." },
            ],
          }),
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    expect(
      await screen.findByRole("button", { name: /Did it work/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /Tags/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Per-item notes/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Who sees this run/ }),
    ).toBeVisible();
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
    // indication of which was picked. Now they are radios (R-84 c), and
    // the chosen one is announced as checked.
    const user = userEvent.setup();
    await renderWithRouter(form());

    const checked = () =>
      screen
        // `queryAll`, because "nothing is chosen yet" is a state this
        // asserts and `getAllByRole` throws on an empty match.
        .queryAllByRole("radio", { checked: true })
        .map((radio) => radio.closest("label")?.textContent);
    const verdicts = () =>
      checked().filter((text) =>
        verdictScale.some((choice) => text?.includes(choice.label)),
      );

    expect(verdicts()).toEqual([]);

    await user.click(screen.getByRole("radio", { name: "Dialed" }));

    expect(verdicts()).toEqual(["[Dialed]"]);

    // And it moves rather than accumulating — two chosen verdicts would
    // be a distribution, which is a different fact from "how you called
    // it".
    await user.click(screen.getByRole("radio", { name: "Way cold" }));

    expect(verdicts()).toEqual(["[Way cold]"]);
  });

  it("marks the chosen one, and only that one", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("radio", { name: "Dialed" }));

    // Teal, because the chosen cell wears its verdict's hue (round 19).
    expect(cell("Dialed")).toHaveClass("bg-teal");
    expect(cell("Way cold")).not.toHaveClass("bg-action");
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

      await user.click(screen.getByRole("radio", { name: label }));

      const chosen = cell(label);
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));

    const other = cell("Way cold");
    expect(other).toHaveClass("border");
    expect(other).not.toHaveClass("bg-ink");
  });

  it("closes the brackets onto the chosen verdict, and locks after", async () => {
    // "The single most important input in the product. The bracket
    // closing is the receipt" (design/motion.js, "Verdict commit").
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("radio", { name: "Dialed" }));

    const chosen = cell("Dialed");
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
    expect(cell("Way cold")).not.toHaveClass("verdict-lock");
  });

  it("gives an unchosen verdict no brackets to close", async () => {
    await renderWithRouter(form());

    expect(
      cell("Dialed").querySelectorAll("[aria-hidden='true']"),
    ).toHaveLength(0);
  });

  it("starts from the verdict the entry already has", async () => {
    // Including 0: dialed is a verdict, and an editor that forgot it would
    // show the form as unanswered.
    await renderWithRouter(form({ entry: { verdict: 0 } }));

    expect(cell("Dialed")).toHaveClass("bg-teal");
    expect(screen.getByRole("radio", { name: "Dialed" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Log it" })).toBeEnabled();
  });

  it("sends the number, not the label", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("radio", { name: "Way warm" }));
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

    const group = screen.getByRole("radiogroup", { name: /Did it work/i });
    for (const label of [
      "Way cold",
      "A bit cold",
      "Dialed",
      "A bit warm",
      "Way warm",
    ]) {
      expect(within(group).getByRole("radio", { name: label })).toBeVisible();
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

    const group = screen.getByRole("radiogroup", { name: /Did it work/i });
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

    expect(cell("Way cold")).toHaveClass(
      "uppercase",
      "text-center",
      "flex-col",
      "target",
    );
  });

  it("draws the focus ring on the cell, and fills the cell with its radio (R-84 c)", async () => {
    // The radio holds focus but is invisible, so the ring is the cell's
    // (`has-[:focus-visible]`). And it fills the cell rather than being
    // `sr-only`, so a press anywhere on the cell lands on the control.
    await renderWithRouter(form({}));

    expect(cell("Way cold")).toHaveClass(
      "has-[:focus-visible]:outline",
      "has-[:focus-visible]:outline-ink",
    );
    expect(screen.getByRole("radio", { name: "Way cold" })).toHaveClass(
      "absolute",
      "inset-0",
      "h-full",
      "w-full",
      "appearance-none",
      "opacity-0",
    );
  });

  it("is five radios in a radiogroup: arrows move and choose, space chooses (R-84 c)", async () => {
    // Accessibility Contract rule 05: "five buttons in a role=radiogroup,
    // arrow keys move, space selects". Native radios, so the browser's own
    // group behaviour is what is being relied on, and asserted.
    const user = userEvent.setup();
    await renderWithRouter(form());

    const group = screen.getByRole("radiogroup", { name: /Did it work/i });
    expect(within(group).getAllByRole("radio")).toHaveLength(
      verdictScale.length,
    );
    for (const radio of within(group).getAllByRole("radio")) {
      expect(radio).toHaveAttribute("name", "verdict");
    }

    const dialed = screen.getByRole("radio", { name: "Dialed" });
    dialed.focus();
    await user.keyboard(" ");
    expect(dialed).toBeChecked();
    expect(cell("Dialed")).toHaveClass("bg-teal");

    await user.keyboard("{ArrowRight}");
    const warm = screen.getByRole("radio", { name: "A bit warm" });
    expect(warm).toHaveFocus();
    expect(warm).toBeChecked();
    expect(dialed).not.toBeChecked();

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "A bit cold" })).toBeChecked();
  });

  it("sends the verdict the keyboard chose", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve(undefined));
    await renderWithRouter(form({ submitVerdict }));

    screen.getByRole("radio", { name: "Way cold" }).focus();
    await user.keyboard(" {ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0].data).toMatchObject({
      verdict: -1,
    });
  });

  it("keeps the scale's order, which is the product rule", async () => {
    // Way cold -> way warm. A set of five buttons in any order is still
    // five buttons; the order is what makes the row readable as a scale.
    await renderWithRouter(form({}));

    const group = screen.getByRole("radiogroup", { name: /Did it work/i });
    const names = within(group)
      .getAllByRole("radio")
      .map((radio) => radio.closest("label")?.textContent);
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
    const names = within(screen.getByRole("dialog"))
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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
  if (!(row instanceof HTMLElement)) throw new TypeError("no chips row");
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
      // Its text; its name is "More, anything specific".
      "More ›",
    ]);

    await user.click(screen.getByRole("radio", { name: "A bit warm" }));
    expect(chipNames().slice(0, 3)).toStrictEqual([
      "Shell too much",
      "Cap too much",
      "sleeves damp",
    ]);
    expect(chipNames()).toHaveLength(6);

    // Changing the verdict recomputes the unchosen chips.
    await user.click(screen.getByRole("radio", { name: "A bit cold" }));
    expect(chipNames().slice(0, 2)).toStrictEqual([
      "Shell not enough",
      "Cap not enough",
    ]);
  });

  it("suggests no garment when the run has no band to read", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form({ entry: { items: KIT } }));

    await user.click(screen.getByRole("radio", { name: "Way warm" }));
    expect(chipNames()).toStrictEqual([
      "cold first mile",
      "cold throughout",
      "overheated late",
      "sleeves damp",
      "chafed",
      // Its text; its name is "More, anything specific".
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
    await user.click(screen.getByRole("radio", { name: "A bit warm" }));

    const shell = screen.getByRole("button", { name: "Shell too much" });
    expect(shell).toHaveAttribute("aria-pressed", "false");
    await user.click(shell);
    expect(
      screen.getByRole("button", { name: "Shell too much" }),
    ).toHaveAttribute("aria-pressed", "true");

    // "Chosen chips stay": a cold verdict would suggest "Shell not
    // enough", but the runner already said too much.
    await user.click(screen.getByRole("radio", { name: "A bit cold" }));
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
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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
    await user.click(screen.getByRole("radio", { name: "A bit warm" }));

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
    const more = screen.getByRole("button", {
      name: "More, anything specific",
    });
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      tags: ["chafed"],
    });
  });

  it("asks who sees this run, PRIVATE / SHARED / PUBLIC, each with what it means (round 41 #86a)", async () => {
    await renderWithRouter(form());

    const group = screen.getByRole("group", { name: "Who sees this run" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toStrictEqual(["private", "runners", "world"]);
    expect(
      within(group).getByRole("radio", { name: "Private Only you." }),
    ).not.toBeChecked();
    expect(
      within(group).getByRole("radio", {
        name: "Shared Runners signed in to dialed.run.",
      }),
    ).toBeChecked();
    expect(
      within(group).getByRole("radio", {
        name: "Public Anyone with the link, no sign-in. Never when or where you ran.",
      }),
    ).not.toBeChecked();
  });

  it("says the private line under the group for PRIVATE, the preview line for PUBLIC, and nothing more for SHARED", async () => {
    const user = userEvent.setup();
    await renderWithRouter(form());
    const shared = screen.getByRole("radio", { name: /^Shared/ });
    expect(shared).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("The private line.")).toBeNull();
    expect(screen.queryByText(PUBLIC_PREVIEW_LINE)).toBeNull();

    const privately = screen.getByRole("radio", { name: /^Private/ });
    await user.click(privately);
    expect(screen.getByText("The private line.")).toBeVisible();
    expect(screen.queryByText(PUBLIC_PREVIEW_LINE)).toBeNull();
    // The line describes the picked radio alone: on the unpicked two it
    // would tell them what the picked one means.
    expect(privately).toHaveAccessibleDescription("The private line.");
    expect(privately).toHaveAttribute("aria-describedby", "verdict-share-hint");
    expect(shared).not.toHaveAttribute("aria-describedby");

    const publicly = screen.getByRole("radio", { name: /^Public/ });
    await user.click(publicly);
    expect(publicly).toHaveAccessibleDescription(PUBLIC_PREVIEW_LINE);
    expect(privately).not.toHaveAttribute("aria-describedby");
    expect(shared).not.toHaveAttribute("aria-describedby");
    expect(screen.getByText(PUBLIC_PREVIEW_LINE)).toHaveClass(
      "text-small",
      "text-muted",
    );
    expect(screen.queryByText("The private line.")).toBeNull();

    await user.click(shared);
    expect(shared).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(PUBLIC_PREVIEW_LINE)).toBeNull();
  });

  it("holds an unconfirmed runner at PRIVATE, every option at full strength (R47·123)", async () => {
    // The entry started SHARED, the runner's default, but D-50 keeps an
    // unconfirmed runner's run private, so the group says so.
    await renderWithRouter(
      form({ entry: { audience: "runners" }, isVerified: false }),
    );

    const privately = screen.getByRole("radio", { name: /^Private/ });
    expect(privately).toBeChecked();
    for (const name of [/^Private/u, /^Shared/u, /^Public/u]) {
      const radio = screen.getByRole("radio", { name });
      expect(radio).not.toHaveAttribute("aria-disabled");
      expect(radio).not.toBeDisabled();
      // Round 27's line is why none but PRIVATE takes, so every option is
      // described by it, not only the checked one.
      expect(radio).toHaveAccessibleDescription("The private line.");
    }
  });

  it("opens the confirm sheet from SHARED or PUBLIC without moving the selection (R47·123)", async () => {
    const user = userEvent.setup();
    const asked: (string | undefined)[] = [];
    const gate: ConfirmGate = {
      sheet: ({ open, trigger }, onClose) => {
        if (open) asked.push(trigger);
        return open ? (
          <div role="dialog" aria-label="Confirm your email first">
            <button type="button" onClick={onClose}>
              Not now
            </button>
          </div>
        ) : undefined;
      },
    };
    await renderWithRouter(
      <UnconfirmedRefusalAnswer gate={gate}>
        {form({ isVerified: false })}
      </UnconfirmedRefusalAnswer>,
    );

    const shared = screen.getByRole("radio", { name: /^Shared/ });
    await user.click(shared);
    expect(
      screen.getByRole("dialog", { name: "Confirm your email first" }),
    ).toBeVisible();
    expect(asked.at(-1)).toBe("share");
    expect(shared).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /^Private/ })).toBeChecked();
    // The press leaves focus on the option pressed, which is where a
    // modal sheet hands it back.
    expect(shared).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    await user.click(screen.getByRole("radio", { name: /^Public/ }));
    expect(asked).toEqual(["share", "share"]);
    expect(screen.getByRole("radio", { name: /^Public/ })).not.toBeChecked();
  });

  it("sends PRIVATE for an unconfirmed runner, whatever the entry started as", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve(undefined));
    await renderWithRouter(
      form({
        entry: { audience: "runners" },
        isVerified: false,
        submitVerdict,
      }),
    );

    // No answer above it (no root), so the press asks nobody, and holds,
    // without throwing.
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent): void => {
      errors.push(event.error);
      event.preventDefault();
    };
    globalThis.addEventListener("error", onError);
    await user.click(screen.getByRole("radio", { name: /^Shared/ }));
    globalThis.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    expect(screen.getByRole("radio", { name: /^Private/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0].data).toMatchObject({
      audience: "private",
    });
  });

  it("draws the audience words as MONO.xs capitals, heard in sentence case (round 41 #86a)", async () => {
    await renderWithRouter(form({ entry: { audience: "private" } }));
    for (const word of ["Private", "Shared", "Public"]) {
      expect(screen.getByText(word)).toHaveClass(
        "font-mono",
        "text-mono-xs",
        "uppercase",
      );
    }
  });

  it("keeps the field's own props on each radio, and points only the picked one at the line", async () => {
    await renderWithRouter(form({ entry: { audience: "private" } }));
    const privately = screen.getByRole("radio", { name: /^Private/ });
    expect(privately).toHaveAttribute("name", "audience");
    expect(privately).toHaveAttribute("aria-describedby", "verdict-share-hint");
    for (const name of [/^Shared/u, /^Public/u]) {
      expect(screen.getByRole("radio", { name })).not.toHaveAttribute(
        "aria-describedby",
      );
    }
  });

  it("opens Change as a sheet and comes back with the form's values kept (round 32, 2a)", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    const saveCountInTotals = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      form({
        entry: { audience: "private" },
        submitVerdict,
        privateLine: (hintId) => (
          <PrivateRunLine
            hintId={hintId}
            isVerified
            countInTotals
            saveCountInTotals={saveCountInTotals}
          />
        ),
      }),
    );
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "chafed" }));

    await user.click(
      screen.getByRole("button", {
        name: "Change whether runs count in the guides",
      }),
    );
    const sheet = screen.getByRole("dialog", { name: "Privacy" });
    await user.click(
      within(sheet).getByRole("checkbox", {
        name: "Count my runs in anonymous totals",
      }),
    );
    await waitFor(() => {
      expect(saveCountInTotals).toHaveBeenCalledWith({
        data: { countInTotals: false },
      });
    });
    await user.click(within(sheet).getByRole("button", { name: "Done" }));

    // Back on the form: the line follows the saved setting, and nothing
    // picked before the sheet opened was lost.
    expect(document.querySelector("#verdict-share-hint")).toHaveTextContent(
      /^Other runners won't see this run\.$/u,
    );
    expect(screen.getByRole("radio", { name: "Dialed" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      verdict: 0,
      audience: "private",
      tags: ["chafed"],
    });
  });

  it("starts at the entry's audience, and sends the one picked", async () => {
    // The runner's default is what the entry started with.
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));
    expect(screen.getByRole("radio", { name: /^Shared/ })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /^Public/ }));
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      audience: "world",
    });
  });

  it("can be made private", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    await renderWithRouter(form({ submitVerdict }));

    await user.click(screen.getByRole("radio", { name: /^Private/ }));
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      audience: "private",
    });
  });

  it("starts private or public when the entry already is", async () => {
    const { unmount } = await renderWithRouter(
      form({ entry: { audience: "private" } }),
    );
    expect(screen.getByRole("radio", { name: /^Private/ })).toBeChecked();
    unmount();

    await renderWithRouter(form({ entry: { audience: "world" } }));
    expect(screen.getByRole("radio", { name: /^Public/ })).toBeChecked();
  });

  it("starts private for a groups entry, which nothing can write yet", async () => {
    // Groups are storable before they are writable (D-109).
    await renderWithRouter(form({ entry: { audience: "groups" } }));
    expect(screen.getByRole("radio", { name: /^Private/ })).toBeChecked();
  });
});

describe("VerdictForm: the history line beneath the row (R-97)", () => {
  it("shows this runner's history in the band, which the route already loads", async () => {
    // The verdict route has fetched `verdictBandCounts` on every visit and
    // discarded it; round 20 put the line beneath the row.
    await renderWithRouter(
      form({ bandFloor: 5, bandCounts: { "-1": 2, "0": 7, "1": 1 } }),
    );

    expect(
      screen.getByText(
        (_text, element) =>
          element?.tagName === "SPAN" &&
          drawnText(element) === "[41–50°] · 2 cold · 7 dialed · 1 warm",
      ),
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    // The band, as board A3 writes it: "Half-zip is now 8 of 9 in
    // 38–46°." 5°C is 41°F, and a band is five degrees Celsius wide.
    const sentence = await screen.findByText(
      "Houdini is now 3 of 5 in 41–50°.",
    );
    // Round 53 · 162.3: drawn as the board writes it, said as a range.
    expect(sentence).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByText("Houdini is now 3 of 5 in 41 to 50 degrees."),
    ).toHaveClass("sr-only");
    expect(sentence).toBeVisible();
    // Announced when it lands, in the screen's one region (rule 08): the
    // button just pressed has gone, and this is what took its place.
    expect(sentence.closest("[data-slot='noted']")).toHaveTextContent(/^Noted/);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Noted\. Houdini is now 3 of 5 in 41 to 50 degrees\.$/u,
    );
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    const receipt = await waitFor(() => {
      const found = document.querySelector("[data-slot='noted']");
      if (found === null) throw new Error("no receipt yet");
      return found;
    });
    expect(receipt).toHaveTextContent(/^Noted$/u);
    expect(screen.getByRole("status")).toHaveTextContent(/^Noted\.$/u);
    // No empty sentence standing in for the missing one.
    expect(receipt.querySelector("p")).toBeNull();
    expect(screen.queryByText(/Nothing saved/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Log it" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Dialed" })).toHaveAttribute(
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    const sentence = await screen.findByText(
      "Logged. No weather came with this run, so no temperature record moved.",
    );
    expect(sentence.closest("[data-slot='noted']")).toHaveTextContent(/^Noted/);
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Noted\. Logged\. No weather came with this run/u,
    );
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    expect(
      await screen.findByText(
        "Logged. No weather came with this run, so no temperature record moved.",
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
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/, {
      selector: "[aria-hidden='true']",
    });

    // In the submit's place: share and submit are gone, and there is no
    // button standing in for them.
    expect(screen.queryByRole("button", { name: "Log it" })).toBeNull();
    expect(screen.queryByRole("radio", { name: /^Shared/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();

    // The answer stays — the chosen verdict still pressed.
    const dialed = screen.getByRole("radio", { name: "Dialed" });
    expect(dialed).toBeChecked();
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
        screen.getByRole("radio", { name: step.label }),
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
    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/, {
      selector: "[aria-hidden='true']",
    });

    const wayCold = screen.getByRole("radio", { name: "Way cold" });
    expect(wayCold).toHaveAttribute("aria-disabled", "true");
    expect(wayCold).not.toBeDisabled();
    await user.click(wayCold);
    expect(screen.getByRole("radio", { name: "Dialed" })).toBeChecked();
    expect(wayCold).not.toBeChecked();

    const tag = screen.getByRole("button", { name: "chafed" });
    expect(tag).toHaveAttribute("aria-disabled", "true");
    await user.click(tag);
    expect(tag).toHaveAttribute("aria-pressed", "false");

    // MORE › leaves with share and submit (round 21, ask 1a): "an inert
    // control that still looks tappable is a lie". Not read-only — gone.
    expect(
      screen.queryByRole("button", { name: "More, anything specific" }),
    ).toBeNull();
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await screen.findByText(/Houdini is now 3 of 5/, {
      selector: "[aria-hidden='true']",
    });

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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
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
    await user.click(screen.getByRole("radio", { name: "Dialed" }));

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

  it("announces the save once, with Noted's sentence, when the receipt lands", async () => {
    // One announcement for one save: "Verdict saved." and then Noted's
    // own region said it twice. While the band stat is out the region
    // stays quiet; holding that promise open is what makes the window big
    // enough to assert in.
    const user = userEvent.setup();
    const stat = Promise.withResolvers<{ worn: number; total: number }>();
    await renderWithRouter(
      form({
        bandFloor: -5,
        entry: { items: [item("01JTEMA0000000000000000000", "Houdini")] },
        itemBandWearStat: () => stat.promise,
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Log it" }),
      ).not.toHaveAttribute("aria-busy");
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);

    stat.resolve({ worn: 3, total: 7 });
    expect(
      await screen.findByText(/Houdini is now 3 of 7/, {
        selector: "[aria-hidden='true']",
      }),
    ).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Noted\. Houdini is now 3 of 7/u,
    );
  });
});

/**
 * The element whose whole text is `text`, across the spans inside it —
 * the headline's unit is a span of its own — and none of whose children
 * already is.
 */
function wholeText(text: string): MatcherFunction {
  return (_content, element) =>
    element?.textContent === text &&
    [...element.children].every((child) => child.textContent !== text);
}

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
    // (R-96), so a Chicago morning is not read as UTC's 11 AM.
    await renderWithRouter(
      form({
        entry: { startedAt: SAT_MORNING, distanceM: 9978, conditions },
      }),
    );

    const header = screen.getByRole("banner");
    expect(header).toHaveAttribute("data-slot", "header");
    expect(header).toHaveAttribute("data-ground", "ink-until-wide");
    expect(within(header).getByText("Sat Aug 29 · 6:04 AM")).toBeVisible();
    const headline = within(header).getByText(wholeText("6.2 mi at 41°"));
    expect(headline).toBeVisible();
    // The unit is dropped from the drawing for the temperature, but said:
    // "6.2 at 41°" told a reader neither miles nor kilometres.
    expect(within(headline).getByText("mi")).toHaveClass(
      "sr-only",
      "normal-case",
    );
  });

  it("becomes the title line at width: the question, then the run in one mono line", async () => {
    // Desktop Contract DS0 bend 4, and round 25's A3 desk: "The ink
    // header becomes the title line" — "Did it work?" as the title over
    // "SAT AUG 29 · 6:04 AM · 6.2 AT 41°". happy-dom applies no
    // stylesheet, so what is pinned is the markup each width reads.
    await renderWithRouter(
      form({
        entry: { startedAt: SAT_MORNING, distanceM: 9978, conditions },
      }),
    );

    const header = screen.getByRole("banner");
    // Ink below `wide` only (ui/tokens.css), and flush with the column
    // from it, since there is no block left to bleed.
    expect(header).toHaveClass("-mx-5", "-mt-6", "wide:mx-0", "wide:mt-0");
    const question = within(header).getByRole("heading", {
      level: 1,
      name: "Did it work?",
    });
    expect(question).toHaveClass("wide:font-display", "wide:text-title");
    // **In reading order, never reordered** (WCAG 1.3.2): the phone's run
    // lines come before the question in the markup, the desk's after it,
    // and each width hides the other's — no `order-*` anywhere.
    const phoneWhen = within(header).getByText("Sat Aug 29 · 6:04 AM");
    const phoneHeadline = within(header).getByText(wholeText("6.2 mi at 41°"));
    expect(phoneWhen).toHaveClass("wide:hidden");
    expect(phoneHeadline).toHaveClass("wide:hidden");
    const deskLine = within(header).getByText(
      wholeText("Sat Aug 29 · 6:04 AM · 6.2 mi at 41°"),
    );
    expect(deskLine).toHaveClass("hidden", "wide:block", "text-dialed-text");
    // Visual Crossing's credit closes the header at every width (D-144):
    // the headline is its reading, and below the desk the rail that also
    // credits it is not drawn.
    const credit = queryWeatherCredit(header);
    // "← Back" above it all, at both widths, sharing its row with the
    // phone's bell (Round 55 · 242; Design 169.1).
    const back = within(header).getByRole("link", { name: "Back" });
    expect([...header.children]).toEqual([
      back.parentElement,
      phoneWhen,
      phoneHeadline,
      question,
      deskLine,
      credit,
    ]);
    expect(header.outerHTML).not.toMatch(/\border-/u);
  });

  it("credits nobody in the header for conditions the runner set", async () => {
    await renderWithRouter(
      form({
        entry: {
          startedAt: SAT_MORNING,
          distanceM: 9978,
          conditions: { ...conditions, source: "manual" },
        },
      }),
    );

    expect(queryWeatherCredit(screen.getByRole("banner"))).toBeNull();
  });

  it("names the unit instead of a temperature when the run has none", async () => {
    // The nothing-moved frame: "6.2 MI". No conditions, no "at", and the
    // date falls back to UTC.
    await renderWithRouter(
      form({ entry: { startedAt: SAT_MORNING, distanceM: 9978 } }),
    );

    const header = screen.getByRole("banner");
    expect(within(header).getByText("6.2 mi")).toBeVisible();
    expect(within(header).getByText("Sat Aug 29 · 11:04 AM")).toBeVisible();
  });

  it("reads the runner's own units", async () => {
    await renderWithRouter(
      form({
        entry: { distanceM: 9978, conditions },
        units: { temp: "c", distance: "km" },
      }),
    );

    expect(screen.getByText(wholeText("10.0 km at 5°"))).toBeVisible();
  });

  it("reads the rail's run on the run's own zone, and a run with none on UTC, marked", async () => {
    // A3's entry carries no home zone (P2a-02's fallback is A2's): with no
    // zone of its own, the card says UTC rather than print it bare.
    await renderWithRouter(
      form({ entry: { startedAt: SAT_MORNING, conditions: undefined } }),
    );

    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    if (rail === null) throw new TypeError("no rail");
    expect(
      within(rail).getByRole("heading", {
        name: "This run · Sat Aug 29 · 11:04 AM UTC",
      }),
    ).toBeInTheDocument();
  });

  it("sets the run and the kit being judged in the desk's rail, read-only", async () => {
    // Round 25: A3 at the desk is DS1's two columns, the rail holding
    // "the kit being judged" and the run — never an input.
    await renderWithRouter(
      form({
        entry: {
          startedAt: SAT_MORNING,
          distanceM: 9978,
          durationS: 3098,
          conditions,
          items: [item("a", "Tracksmith Harrier"), item("b", "Bandit split")],
        },
      }),
    );

    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    if (rail === null) throw new Error("no rail");
    // The desk's alone: the phone never had these cards.
    expect(rail).toHaveClass("hidden", "desk:flex");
    expect(
      within(rail).getByRole("heading", {
        name: "This run · Sat Aug 29 · 6:04 AM",
      }),
    ).toBeInTheDocument();
    // Drawn as the board draws it, said with the time in words: "51:38"
    // reads as a time of day.
    expect(within(rail).getByText("6.2 mi · 51:38")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(rail).getByText("6.2 miles, 51 minutes 38 seconds"),
    ).toHaveClass("sr-only");
    // Round 52 #158: the receipt's reading, drawn and said in words.
    const reading = within(rail).getByText("41°F damp · feels 36°");
    expect(reading.parentElement).toHaveClass("text-dialed-text");
    expect(reading).toHaveAttribute("aria-hidden", "true");
    expect(reading.nextElementSibling).toHaveTextContent(
      "41 degrees Fahrenheit, damp, feels like 36 degrees",
    );
    expect(
      within(rail).getByRole("heading", { name: "The kit you’re judging" }),
    ).toBeInTheDocument();
    expect(
      within(rail)
        .getAllByRole("listitem")
        .map((row) => row.textContent),
    ).toStrictEqual(["Tracksmith Harrier", "Bandit split"]);
    expect(rail.querySelector("input, button, [role='radio']")).toBeNull();
  });

  it("draws the rail's credit unheard, so the header's is the one heard", async () => {
    await renderWithRouter(
      form({ entry: { startedAt: SAT_MORNING, distanceM: 9978, conditions } }),
    );

    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    const railCredit = rail?.querySelector<HTMLElement>(
      "a[href='https://www.visualcrossing.com/']",
    );
    expect(railCredit).toHaveTextContent(
      "Weather data provided by Visual Crossing",
    );
    expect(railCredit).toHaveAttribute("aria-hidden", "true");
    expect(railCredit).toHaveAttribute("tabindex", "-1");
    // getByRole throws on two: one credit is heard, and it is the header's.
    const heard = screen.getByRole("link", {
      name: "Weather data provided by Visual Crossing",
    });
    expect(document.querySelector("header")).toContainElement(heard);
  });

  it("credits no one in the rail for a reading the runner typed", async () => {
    await renderWithRouter(
      form({
        entry: {
          startedAt: SAT_MORNING,
          distanceM: 9978,
          conditions: { ...conditions, source: "manual" as const },
        },
      }),
    );

    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    expect(rail).toHaveTextContent("feels");
    expect(rail?.querySelector("a")).toBeNull();
  });

  it("names no conditions in the rail for a run with none", async () => {
    await renderWithRouter(
      form({ entry: { startedAt: SAT_MORNING, distanceM: 9978 } }),
    );

    const rail = document.querySelector<HTMLElement>("[data-part='rail']");
    expect(rail).toHaveTextContent("6.2 mi");
    expect(rail).not.toHaveTextContent("feels");
    expect(rail?.querySelector("a")).toBeNull();
  });

  it("asks the question once, as the heading, and the row is named by it", async () => {
    await renderWithRouter(form());

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Did it work?");
    expect(within(screen.getByRole("banner")).getByRole("heading")).toBe(
      heading,
    );
    expect(screen.getAllByText("Did it work?")).toHaveLength(1);
    expect(
      screen.getByRole("radiogroup", { name: "Did it work?" }),
    ).toBeVisible();
  });

  it("marks the row when a save is refused for want of a verdict", async () => {
    // The sentence lives under the row, where the fix is, on the field
    // message the Form Contract draws.
    const user = userEvent.setup();
    await renderWithRouter(form());

    await user.click(screen.getByRole("button", { name: "Log it" }));

    const group = screen.getByRole("radiogroup", { name: "Did it work?" });
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
    expect(chips).toHaveClass("gap-x-2", "gap-y-3");
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

    await user.click(screen.getByRole("radio", { name: "A bit warm" }));
    sheet = await openSpecifics(user);
    expect(within(sheet).getByText("A bit warm · optional")).toBeVisible();
    // A3b's tags are the same 32px chips, in the same seam-gapped row.
    const tag = within(sheet).getByRole("button", { name: "chafed" });
    expect(tag).toHaveClass("target-seam", "h-8");
    expect(tag.parentElement).toHaveClass("gap-x-2", "gap-y-3");
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

function submitSpy() {
  return vi.fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>(
    () => Promise.resolve(),
  );
}

function effortGroup(): HTMLElement {
  return screen.getByRole("group", { name: /^Effort/u });
}

const EFFORT_LINE =
  "You run warmer the harder you go. Next time, the Call allows for it.";

describe("VerdictForm: effort from the watch (G5)", () => {
  it("draws the watch's pick selected, and says where it came from", async () => {
    await renderWithRouter(
      form({ entry: { effort: { chosen: "steady", watchRpe: 6 } } }),
    );

    const group = effortGroup();
    expect(
      within(group).getByRole("button", { name: "Steady" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Easy" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(group).toHaveTextContent("From your watch · rated 6 of 10");
    expect(group).toHaveAccessibleDescription("From your watch, rated 6 of 10");
    // Rated, the watch line takes the kicker's OPTIONAL slot (round 41 #87).
    expect(group).toHaveAccessibleName("Effort");
    expect(within(group).getByText(EFFORT_LINE)).toHaveClass(
      "text-small",
      "text-quiet",
    );
  });

  it("saves the watch's pick by leaving it alone: nothing to send", async () => {
    const user = userEvent.setup();
    const submitVerdict = submitSpy();
    await renderWithRouter(
      form({
        submitVerdict,
        entry: { effort: { chosen: "steady", watchRpe: 6 } },
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).not.toHaveProperty("effort");
  });

  it("makes any tap the runner's pick, even on the chosen chip, and drops the source", async () => {
    const user = userEvent.setup();
    const submitVerdict = submitSpy();
    await renderWithRouter(
      form({
        submitVerdict,
        entry: { effort: { chosen: "steady", watchRpe: 6 } },
      }),
    );

    await user.click(
      within(effortGroup()).getByRole("button", { name: "Steady" }),
    );

    const group = effortGroup();
    expect(group).not.toHaveTextContent("From your watch");
    expect(group).not.toHaveAttribute("aria-describedby");
    expect(group).toHaveAccessibleName("Effort · optional");
    expect(
      within(group).getByRole("button", { name: "Steady" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      effort: "steady",
    });
  });

  it("sends the effort the runner picked instead", async () => {
    const user = userEvent.setup();
    const submitVerdict = submitSpy();
    await renderWithRouter(
      form({
        submitVerdict,
        entry: { effort: { chosen: "steady", watchRpe: 6 } },
      }),
    );

    await user.click(
      within(effortGroup()).getByRole("button", { name: "Workout" }),
    );
    expect(
      within(effortGroup()).getByRole("button", { name: "Steady" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      effort: "workout",
    });
  });

  it("with no rating picks nothing and names no source", async () => {
    await renderWithRouter(form());

    const group = effortGroup();
    for (const name of ["Easy", "Steady", "Workout", "Race"]) {
      expect(within(group).getByRole("button", { name })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    expect(group).not.toHaveTextContent("From your watch");
    expect(group).toHaveAccessibleName("Effort · optional");
    expect(group).toHaveTextContent(EFFORT_LINE);
  });

  it("shows a runner's own earlier pick without a source line", async () => {
    await renderWithRouter(
      form({ entry: { effort: { chosen: "race", watchRpe: undefined } } }),
    );

    const group = effortGroup();
    expect(within(group).getByRole("button", { name: "Race" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(group).not.toHaveTextContent("From your watch");
  });

  it("is read-only once logged", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      form({
        submitVerdict: submitSpy(),
        entry: { effort: { chosen: "easy", watchRpe: 2 } },
      }),
    );

    await user.click(screen.getByRole("radio", { name: "Dialed" }));
    await user.click(screen.getByRole("button", { name: "Log it" }));

    const race = await waitFor(() => {
      const button = within(effortGroup()).getByRole("button", {
        name: "Race",
      });
      expect(button).toHaveAttribute("aria-disabled", "true");
      return button;
    });
    await user.click(race);
    expect(race).toHaveAttribute("aria-pressed", "false");
    expect(effortGroup()).toHaveTextContent("rated 2 of 10");
  });

  it("draws the pick chips centred and without the ✕", async () => {
    await renderWithRouter(
      form({ entry: { effort: { chosen: "easy", watchRpe: 2 } } }),
    );

    const easy = within(effortGroup()).getByRole("button", { name: "Easy" });
    expect(easy).toHaveClass("justify-center", "bg-ink");
    expect(easy.querySelector("svg")).toBeNull();
    expect(
      within(effortGroup()).getByRole("button", { name: "Race" }),
    ).toHaveClass("justify-center", "border-hairline");
  });
});

describe("VerdictForm: a lapsed session (Au7, D-155)", () => {
  it("carries run to log-in", async () => {
    carriedSince();
    await renderWithRouter(form());

    expect(carriedSince()).toEqual(["run"]);
  });
});

/**
The desk rail.
*/
function railOf(): HTMLElement {
  const rail = document.querySelector<HTMLElement>("[data-part='rail']");
  if (rail === null) throw new Error("no rail");
  return rail;
}

/**
A kit row in the desk rail, by the piece's name.
*/
function kitRow(name: string): HTMLElement {
  const row = within(railOf()).getByText(name).closest("li");
  if (row === null) throw new Error(`no kit row for ${name}`);
  return row;
}

describe("VerdictForm: the rail's band record and history (round 25)", () => {
  const damp = {
    tempC: 5,
    feelsLikeC: 2,
    precipMm: 1,
    condition: "light rain",
    windKph: 14,
    source: "visualcrossing" as const,
    timeZone: "America/Chicago",
    span: { minTempC: 5, maxTempC: 5, minFeelsLikeC: 2, maxFeelsLikeC: 2 },
  };
  const kit = [item("a", "Tracksmith Harrier"), item("b", "Bandit split")];
  const earlier: BandRun[] = [
    {
      id: "01OLD1",
      runId: "01RUN1",
      day: "Aug 14",
      conditions: { ...damp, tempC: 6 },
      verdict: 0,
      pieces: [
        { itemId: "01P0", name: "Harrier" },
        { itemId: "01P1", name: "Bandit split" },
      ],
    },
    {
      id: "01OLD2",
      runId: "01RUN2",
      day: "Aug 3",
      conditions: { ...damp, tempC: 4, precipMm: 4 },
      verdict: -1,
      pieces: [],
    },
  ];

  it("gives each piece its record in the band, drawn n/m and said in words", async () => {
    await renderWithRouter(
      form({
        entry: { conditions: damp, items: kit },
        bandFloor: 0,
        bandSignals: {
          garments: {
            a: { total: 9, dialed: 8, colder: 1, warmer: 0 },
            b: { total: 0, dialed: 0, colder: 0, warmer: 0 },
          },
          tagUse: {},
        },
      }),
    );

    const harrier = kitRow("Tracksmith Harrier");
    expect(within(harrier).getByText("8/9 dialed · 32–41°")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(harrier).getByText("8 of 9 runs dialed in 32 to 41 degrees"),
    ).toHaveClass("sr-only");
    // Never worn here before: no record, rather than "0/0".
    expect(kitRow("Bandit split")).toHaveTextContent(/^Bandit split$/);
  });

  it("says one run in the singular", async () => {
    await renderWithRouter(
      form({
        entry: { conditions: damp, items: kit },
        bandFloor: 0,
        bandSignals: {
          garments: { a: { total: 1, dialed: 1, colder: 0, warmer: 0 } },
          tagUse: {},
        },
      }),
    );
    expect(
      within(kitRow("Tracksmith Harrier")).getByText(
        "1 of 1 run dialed in 32 to 41 degrees",
      ),
    ).toBeInTheDocument();
  });

  it("sets the band history under the kit: day, conditions, verdict and pieces", async () => {
    await renderWithRouter(
      form({
        entry: { conditions: damp, items: kit },
        bandFloor: 0,
        bandRuns: earlier,
      }),
    );

    const card = within(railOf())
      .getByRole("heading", { name: "Before, in 32 to 41 degrees, damp" })
      .closest("section");
    if (card === null) throw new Error("no history card");
    const rows = card.querySelectorAll("[data-part='band-run']");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Aug 14");
    expect(rows[0]).toHaveTextContent("43° damp");
    expect(
      rows[0]?.querySelector("[data-part='verdict-badge']"),
    ).toHaveTextContent("Dialed");
    expect(
      [...(rows[0]?.querySelectorAll(":scope ul li") ?? [])].map(
        (pill) => pill.textContent,
      ),
    ).toStrictEqual(["Harrier", "Bandit split"]);
    // Each row's own sky, whatever the heading's.
    expect(rows[1]).toHaveTextContent("39° wet");
    expect(
      rows[1]?.querySelector("[data-part='verdict-badge']"),
    ).toHaveTextContent("A bit cold");
    expect(rows[1]?.querySelector("ul")).toBeNull();
    // Read-only: a row is never a way to take anything.
    expect(card.querySelector("a, button, input")).toBeNull();
  });

  it("says so when there are no runs in the band yet", async () => {
    await renderWithRouter(
      form({
        entry: { conditions: damp, items: kit },
        bandFloor: 0,
        bandRuns: [],
      }),
    );
    expect(
      within(railOf()).getByRole("heading", {
        name: "Before, in 32 to 41 degrees, damp",
      }),
    ).toBeInTheDocument();
    expect(railOf()).toHaveTextContent("No runs in this band yet.");
  });

  it("shows no record and no history without a band", async () => {
    await renderWithRouter(
      form({
        entry: { conditions: damp, items: kit },
        bandRuns: earlier,
        bandSignals: {
          garments: { a: { total: 9, dialed: 8, colder: 1, warmer: 0 } },
          tagUse: {},
        },
      }),
    );
    expect(railOf()).not.toHaveTextContent("dialed");
    expect(railOf().querySelector("[data-part='band-run']")).toBeNull();
  });

  it("shows no history without the band's history", async () => {
    await renderWithRouter(
      form({ entry: { conditions: damp, items: kit }, bandFloor: 0 }),
    );
    expect(railOf()).not.toHaveTextContent("Before, in");
  });

  it("shows no history for a run with no conditions to name its sky", async () => {
    await renderWithRouter(
      form({ entry: { items: kit }, bandFloor: 0, bandRuns: earlier }),
    );
    expect(railOf()).not.toHaveTextContent("Before, in");
  });
});

describe("VerdictForm: the way back, the Garmin credit and the foot (Round 55 · 242, D2-12, D2-01)", () => {
  it("goes back to the run the verdict is for", async () => {
    await renderWithRouter(
      form({ entry: { runId: "01JRAN00000000000000000009" } }),
    );
    const back = screen.getByRole("link", { name: "Back" });
    expect(back).toHaveAttribute("href", "/runs/01JRAN00000000000000000009");
    expect(back).toHaveClass("target", "inline-flex", "text-ink");
  });

  it("credits Garmin under the title for a run that came through it, once", async () => {
    await renderWithRouter(form({ entry: { deviceName: "Garmin" } }));
    const header = screen.getByRole("banner");
    const credits = screen.getAllByText("Garmin");
    expect(credits).toHaveLength(1);
    expect(credits[0]?.parentElement).toBe(header);
    expect(credits[0]?.previousElementSibling).toBe(
      within(header).getByRole("heading", { level: 1 }),
    );
  });

  it("credits no one for a run the runner brought themselves", async () => {
    await renderWithRouter(form());
    expect(screen.queryByText("Garmin")).toBeNull();
  });

  it("leaves room under Log it, so it never sits on the page's bottom edge", async () => {
    await renderWithRouter(form());
    const submit = screen.getByRole("button", { name: "Log it" });
    expect(submit.closest("form")).toHaveClass("pt-6", "pb-8");
  });
});

describe("VerdictForm: the phone's bell (Design 169.1)", () => {
  it("ends the header's first row, the way back, at every width", async () => {
    await renderWithRouter(withBell(form()));
    const seat = screen
      .getByRole("button", { name: "Notifications" })
      .closest("[data-slot='notification-bell']");
    const row = seat?.parentElement;
    expect(row?.parentElement).toHaveAttribute("data-slot", "header");
    expect(row?.parentElement?.firstElementChild).toBe(row);
    expect(row).not.toHaveClass("wide:hidden");
    expect(row?.firstElementChild).toHaveAccessibleName("Back");
    expect(row?.lastElementChild).toBe(seat);
  });
});

describe("VerdictForm: A3b at the desk is a push (Round 54 · 164.3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pushes from MORE at the desk instead of opening the sheet", async () => {
    const user = userEvent.setup();
    atWidth(true);
    const onPush = vi.fn();
    await renderWithRouter(form({ push: { ...NOT_PUSHED, onPush } }));

    await user.click(
      screen.getByRole("button", { name: "More, anything specific" }),
    );
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(document.querySelector("dialog[open]")).toBeNull();
  });

  it("opens the sheet below the desk, and pushes nowhere", async () => {
    const user = userEvent.setup();
    atWidth(false);
    const onPush = vi.fn();
    await renderWithRouter(form({ push: { ...NOT_PUSHED, onPush } }));

    const sheet = await openSpecifics(user);
    expect(sheet).toBe(document.querySelector("dialog[open]"));
    expect(onPush).not.toHaveBeenCalled();
  });

  it("says MORE opens a dialog below the desk, and nothing of the kind at it", async () => {
    const width = atWidth(false);
    await renderWithRouter(form());
    const more = screen.getByRole("button", {
      name: "More, anything specific",
    });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    act(() => {
      width.resize(true);
    });
    expect(more).not.toHaveAttribute("aria-haspopup");
  });

  it("draws the pushed page in A3's place: back, title, the garments and tags, Done", async () => {
    await renderWithRouter(
      form({
        entry: { items: KIT, verdict: 1 },
        push: { ...NOT_PUSHED, isPushed: true },
      }),
    );

    const page = screen
      .getByRole("heading", { level: 1, name: "Anything specific?" })
      .closest("[data-slot='specifics-page']");
    if (!(page instanceof HTMLElement))
      throw new TypeError("no specifics page");
    const back = within(page).getByRole("link", { name: "Did it work?" });
    // The same page with nothing pushed: the harness renders A3 at "/".
    expect(back).toHaveAttribute("href", "/");
    expect(page.firstElementChild).toBe(back);
    const title = within(page).getByRole("heading", { level: 1 });
    expect(title).toHaveClass("font-display", "text-title");
    expect(within(page).getByText("A bit warm · optional")).toBeVisible();
    expect(within(page).getByRole("group", { name: "Shell" })).toBeVisible();
    expect(within(page).getByRole("group", { name: "Cap" })).toBeVisible();
    for (const tag of entryTags) {
      expect(
        within(page).getByRole("button", { name: tag.replaceAll("_", " ") }),
      ).toBeVisible();
    }
    const done = within(page).getByRole("button", { name: "Done" });
    expect(done).toHaveClass("bg-action", "uppercase", "font-display");
    expect(page.lastElementChild).toBe(done);
    // A3 is not drawn, but it is still there, holding the answer; the
    // sheet is not, so the page's radios are the form's only ones.
    expect(
      screen
        .getByRole("button", { name: "Log it", hidden: true })
        .closest("[hidden]"),
    ).not.toBeNull();
    expect(document.querySelector("dialog")).toBeNull();
    expect(
      document.querySelectorAll(`input[name='flag-${CSS.escape(CAP)}']`),
    ).toHaveLength(3);
  });

  it("keeps the answer made on the page when it comes back to A3, and sends it", async () => {
    const user = userEvent.setup();
    const submitVerdict = vi.fn<
      (input: { data: Record<string, unknown> }) => Promise<unknown>
    >(() => Promise.resolve());
    const onDone = vi.fn();
    function Pushed(): JSX.Element {
      const [isPushed, setIsPushed] = useState(false);
      return form({
        entry: { items: KIT },
        bandSignals: SIGNALS,
        submitVerdict,
        push: {
          isPushed,
          onPush: () => {
            setIsPushed(true);
          },
          onDone: () => {
            onDone();
            setIsPushed(false);
          },
        },
      });
    }
    atWidth(true);
    await renderWithRouter(<Pushed />);
    await user.click(screen.getByRole("radio", { name: "A bit warm" }));
    await user.click(
      screen.getByRole("button", { name: "More, anything specific" }),
    );

    const page = document.querySelector("[data-slot='specifics-page']");
    if (!(page instanceof HTMLElement))
      throw new TypeError("no specifics page");
    expect(within(page).getByText("A bit warm · optional")).toBeVisible();
    const cap = within(page).getByRole("group", { name: "Cap" });
    await user.click(within(cap).getByRole("radio", { name: "Not enough" }));
    await user.click(within(page).getByRole("button", { name: "hands cold" }));
    await user.click(within(page).getByRole("button", { name: "Done" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-slot='specifics-page']")).toBeNull();
    expect(screen.getByRole("radio", { name: "A bit warm" })).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Cap not enough" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Log it" }));
    await waitFor(() => {
      expect(submitVerdict).toHaveBeenCalledTimes(1);
    });
    expect(submitVerdict.mock.calls[0]?.[0]?.data).toMatchObject({
      verdict: 1,
      tags: ["hands_cold"],
      itemFlags: [
        { itemId: SHELL, flag: undefined },
        { itemId: CAP, flag: "not_enough" },
      ],
    });
  });
});
