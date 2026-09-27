import type { JSX } from "react";
import { useState } from "react";

import { entryTags, verdictScale } from "../../../lib/contracts";
import type { Units, VerdictValue } from "../../../lib/contracts";
import { clockLabel, dayLabel } from "../../../lib/dates";
import { distanceNumber, formatDuration } from "../../../lib/measures";
import { bandLabel, formatTemp, precipClassOf } from "../../../lib/temperature";
import {
  DeskSplit,
  FieldMessage,
  FlowStep,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  LOG_FLOW,
  Mono,
  SubmitButton,
  useFormSubmit,
  RailCard,
  verdictHue,
  WeatherAttribution,
} from "../../../ui";

/**
 * `relative` and a horizontal gutter, because the brackets frame the cell.
 *
 * Design round 18: *"the brackets frame the cell, not the words — they
 * start at the cell's outer edges, vertically centred … the pair never
 * enters the text."* So they are positioned against these edges rather
 * than sitting in the text flow, and `px-3` is the gutter they occupy.
 *
 * The gutter is on every cell, chosen or not. Adding it only to the chosen
 * one would re-flow that cell's label the instant it was picked — a layout
 * shift on the single most important input in the product, and on the one
 * frame the runner is actually watching.
 *
 * `justify-center`: every label sits in the vertical middle of its cell,
 * as round 19's board draws all five (measured: text centre to cell centre,
 * 0px in each). A one-word label — "Dialed" — therefore sits between the
 * two lines of its neighbours rather than on their first line.
 *
 * It was `justify-start` for one round, and that was a misreading of a
 * board that has since changed. Round 18 drew the Dialed cell with *two*
 * lines ("DIALED" and "7 IN BAND"), so centring put its first line level
 * with its neighbours'; the build centred a one-line "Dialed" instead, a
 * layout-signature diff showed it floating off their first line, and
 * `justify-start` "fixed" that. Round 19 moved the count out of the cell,
 * leaving Dialed one line — and the board still centres. The owner saw
 * the top-aligned Dialed on film. The conformance spec now compares each
 * cell's alignment against the board's rather than asserting a rule
 * derived from one round's content.
 */
const VERDICT_BASE =
  "relative flex flex-col items-center justify-center gap-0 rounded-card px-3 py-3 text-center text-micro font-semibold uppercase";

/**
 * A bracket, pinned to one edge of the cell and vertically centred.
 *
 * Out of the flow, which is the whole point of round 18's ruling: an
 * absolutely positioned child is not a flex item, so the cell's `flex-col`
 * cannot stack it as a row of its own, and a label wrapping to two lines
 * cannot split the pair. `inset-y-0` plus `items-center` is the "vertically
 * centred" half — against the cell's full height, so it stays centred
 * whether the label took one line or two.
 */
const BRACKET_BASE = "pointer-events-none absolute inset-y-0 flex items-center";

/**
 * The chosen cell: its verdict's T2 hue, landing in the brackets' beat.
 *
 * **The hue is the verdict's, not "chosen"** (design round 19): *"the
 * chosen cell fills with its T2 hue — cold pink, dialed teal, warm quiet
 * grey — exactly as DS2's row does; --action is never a verdict fill."*
 * It was `bg-ink` here and `--action` pink on the board, so A3 and the
 * backlog that mirrors it read three different ways. `verdictHue` is the
 * one table both surfaces read, so they cannot drift again.
 *
 * `border` on both states, so choosing a cell swaps the border's colour
 * rather than adding one — no one-pixel shift on the frame the runner is
 * watching.
 *
 * `verdict-lock` is only on the chosen cell: the fill lands on the same
 * duration and curve as the brackets, one beat (round 19, `motion.js`).
 * Removed with the class, an un-chosen cell reverts at once.
 */
function verdictChosen(value: VerdictValue): string {
  return `verdict-lock ${VERDICT_BASE} border ${verdictHue(value)}`;
}

const VERDICT_RESTING = `${VERDICT_BASE} border border-hairline`;
import { submitVerdictInput } from "../inputs";
import { BandHistory } from "./BandHistory";
import { NotedReceipt } from "./NotedReceipt";
import { SpecificsSheet } from "./SpecificsSheet";
import { VerdictChips } from "./VerdictChips";
import type { BandSignals } from "../band-signals";
import { suggestChips } from "../chips";
import { notedPlan } from "../noted";
import type { Chip, Flag, ItemFlagChoice } from "../chips";
import type { entryDetailForViewer } from "../entries";
import { toggledIn } from "../../../lib/toggled-in";

type Entry = NonNullable<Awaited<ReturnType<typeof entryDetailForViewer>>>;

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
/**
 * The id tying the share toggle to the sentence beneath it. One verdict
 * form per page, so a constant is enough and `useId` would be a hook for
 * nothing.
 */
const SHARE_HINT_ID = "verdict-share-hint";

const LABELS = {
  // "Did it work?", not "How it felt": design's A3 board carries this
  // wording and DS2's backlog header already shipped it in round 16, so
  // the two mirrored everywhere except here. Copy is the artboard's
  // domain; owner confirmed 2026-09-21.
  verdict: "Did it work?",
  tags: "Tags",
  itemFlags: "Per-item notes",
  isPublic: "Sharing",
};

/**
 * The header's question, which is also the verdict row's name: the row's
 * `fieldset` is labelled by it rather than carrying a legend of its own,
 * because the board draws the question once, in the header.
 */
const QUESTION_ID = "verdict-question";

/**
 * A3's ink header: the run, where and when it happened, and the question.
 *
 * *"SAT AUG 29 · 6:04 AM / 6.2 AT 41° / Did it work?"* — the date and time
 * are the run's own zone (D-96, from the observation), the distance is the
 * runner's unit, and the temperature is the one the run started in. With
 * no conditions the line names the unit instead ("6.2 MI", the
 * nothing-moved frame), since there is no "at" to say.
 *
 * `data-ground="ink"` is the product's inverted block (the top bar is the
 * first), so the tokens inside it flip rather than each class naming a
 * dark-on-light pair.
 */
function RunHeader({
  entry,
  units,
}: Readonly<{ entry: Entry; units: Units }>): JSX.Element {
  const zone = entry.conditions?.timeZone;
  const distance = distanceNumber(entry.distanceM, units.distance);
  const headline =
    entry.conditions === undefined
      ? `${distance} ${units.distance}`
      : `${distance} at ${formatTemp(entry.conditions.tempC, units.temp)}`;
  return (
    <header
      data-slot="header"
      data-ground="ink"
      className="-mx-5 -mt-6 flex flex-col gap-2 bg-ground px-5 py-5 text-ink"
    >
      <Mono step="xs" className="text-muted">
        {dayLabel(entry.startedAt, zone)} · {clockLabel(entry.startedAt, zone)}
      </Mono>
      <p className="m-0 font-display text-display uppercase">{headline}</p>
      <h1 id={QUESTION_ID} className="m-0 text-body font-normal text-quiet">
        {LABELS.verdict}
      </h1>
    </header>
  );
}

/**
 * The verdict (screen A3) — the one screen the whole product turns on.
 *
 * A verdict is per-run, stored as -2..+2 with 0 meaning dialed, and the
 * per-item signal is a `flag`, not a second verdict (docs/contracts.md).
 *
 * **A3 never navigates** (round 21, ask 3; product.md §5). Logging lands
 * Noted in the submit's place and the tab bar is the exit, on every run —
 * including the two with nothing to count, which used to be sent to their
 * entry instead. And **the photo is not here any more**: round 20 moved
 * the outfit photo to A2, where the kit is chosen.
 */
export function VerdictForm({
  entry,
  bandFloor,
  submitVerdict,
  itemBandWearStat,
  units,
  history,
}: Readonly<{
  entry: Entry;
  bandFloor: number | undefined;
  /**
   * The runner's own units, for the header's distance and temperature, the
   * band in the history line, and Noted's sentence ("…8 of 9 in 38–46°").
   */
  units: Units;
  /**
   * This runner's history in the run's band, both halves read over the
   * same in-band entries: `counts`, their verdicts keyed −2..+2, for the
   * line beneath the row (D-97); `signals`, each kit garment's record and
   * the tag use, for the generated chips (round 20). Absent when the run
   * has no conditions, and therefore no band — then the line is not drawn
   * and the chips suggest no garment.
   */
  history:
    | {
        counts: Readonly<Record<number, number>>;
        signals: BandSignals;
      }
    | undefined;
  submitVerdict: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  itemBandWearStat: (input: {
    data: { itemId: string; bandFloorC: number };
  }) => Promise<{ worn: number; total: number }>;
}>) {
  const [verdict, setVerdict] = useState<number | undefined>(entry.verdict);
  const [tags, setTags] = useState<Set<string>>(new Set(entry.tags));
  const [isPublic, setIsPublic] = useState(entry.isPublic);
  // Seeded from the entry, not from nothing.
  //
  // `entry.items[].flag` is what was saved last time, and starting empty
  // meant re-opening a verdict showed every piece as unflagged — so
  // saving again silently cleared flags the runner had set.
  const [flags, setFlags] = useState<Record<string, ItemFlagChoice>>(() =>
    Object.fromEntries(
      entry.items.map((item) => [item.itemId, item.flag ?? "none"]),
    ),
  );
  // Present once the verdict is saved. The sentence inside it can still be
  // absent: the save landed and only the record's count failed to come
  // back, and the receipt is not held hostage to it.
  const [noted, setNoted] = useState<{ sentence: string | undefined }>();
  const [sheetOpen, setSheetOpen] = useState(false);
  // `entry.id`, not an `entryId` prop beside it — the same duplication
  // EntryDetail carried: two sources for one fact, one from the URL params
  // and one from the loader, which a route can silently disagree with
  // itself about.
  const entryId = entry.id;

  // Equivalent mutant on the fallback: every item is seeded above, so the
  // lookup always finds one. The `??` is `noUncheckedIndexedAccess`'s, not
  // the runtime's — and it is hoisted out of the JSX because a `Stryker
  // disable` comment does not attach inside an expression container.
  // Stryker disable next-line StringLiteral
  const flagFor = (itemId: string) => flags[itemId] ?? "none";

  /**
   * Noted's sentence: what the verdict just did to a record, or — when
   * there was nothing to count — which input was missing (`notedPlan`).
   *
   * **Nothing here may fail the save.** This runs after the verdict has
   * landed, and a throw from it used to reach `useFormSubmit` as the
   * submission's own failure: "Nothing saved", the form unlocked, and a
   * runner invited to log a verdict that was already logged. A count that
   * does not come back leaves the receipt without its sentence instead.
   */
  async function notedSentence(): Promise<string | undefined> {
    const plan = notedPlan(bandFloor, entry.items);
    if (plan.kind === "nothing-moved") return plan.sentence;
    try {
      const stat = await itemBandWearStat({
        data: { itemId: plan.itemId, bandFloorC: plan.bandFloorC },
      });
      return `${plan.name} is now ${String(stat.worn)} of ${String(stat.total)} in ${bandLabel(plan.bandFloorC, units.temp)}.`;
    } catch {
      // The count did not come back; the save it would describe did land.
    }
    return undefined;
  }

  /**
   * The whole A3 submission, validated by the same schema the server
   * function validates with — `submitVerdictInput`, not a copy of its
   * rules. The form's state is already the payload's shape, so unlike the
   * closet's there is no transform in between.
   *
   * **No `disabled` on the submit button any more.** The screen used to
   * enforce "pick a verdict" by disabling it, which §5 bans: a disabled
   * button drops focus, stops announcing, and tells nobody why nothing
   * happened. The schema refuses the submission with a reason instead.
   */
  const form = useFormSubmit({
    schema: submitVerdictInput,
    action: async (values) => submitVerdict({ data: values }),
    successMessage: "Verdict saved.",
    labels: LABELS,
    onSuccess: async () => {
      setNoted({ sentence: await notedSentence() });
    },
  });

  function payload() {
    return {
      entryId,
      verdict,
      isPublic,
      tags: [...tags] as (typeof entryTags)[number][],
      itemFlags: entry.items.map((item) => {
        // `=== "none"` alone: an item with no entry reads as undefined,
        // which is already the answer this returns for it.
        const flagValue = flags[item.itemId];
        return {
          itemId: item.itemId,
          flag: flagValue === "none" ? undefined : flagValue,
        };
      }),
    };
  }

  // After Log it the form becomes its own receipt (design round 20): the
  // answer stays on screen, read-only, and Noted takes the submit's place.
  const isLocked = noted !== undefined;

  // The answer as the chip rule reads it: Fine is the default and is never
  // a chip, so "none" is simply not a choice here.
  const chosenFlags: Record<string, Flag> = {};
  for (const [itemId, flag] of Object.entries(flags)) {
    if (flag !== "none") chosenFlags[itemId] = flag;
  }
  const chips = suggestChips({
    verdict,
    kit: entry.items,
    records: history?.signals.garments ?? {},
    tagUse: history?.signals.tagUse ?? {},
    chosenFlags,
    chosenTags: tags,
  });

  function setFlag(itemId: string, flag: ItemFlagChoice): void {
    setFlags((prev) => ({ ...prev, [itemId]: flag }));
  }

  function toggleTag(tag: string): void {
    setTags((prev) => toggledIn(prev, tag));
  }

  /**
   * A chip toggles the one choice it names. A pressed garment chip goes
   * back to Fine, not to the other direction — un-choosing is all a second
   * tap on it can mean.
   */
  function toggleChip(chip: Chip, isPressed: boolean): void {
    if (chip.kind === "tag") toggleTag(chip.tag);
    else setFlag(chip.itemId, isPressed ? "none" : chip.flag);
  }

  return (
    <FlowStep step={LOG_FLOW.verdict}>
      <DeskSplit rail={<VerdictRail entry={entry} units={units} />}>
        <form
          ref={form.formRef}
          noValidate
          className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6 wide:mx-0 wide:max-w-column"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(payload());
          }}
        >
          <RunHeader entry={entry} units={units} />
          <FormStatus>{form.status}</FormStatus>
          <FormErrorSummary
            rows={form.summaryRows}
            onFocusField={form.focusField}
            summaryRef={form.summaryRef}
          />
          {/* **One row at every width — in the 390 panel too; never a
            stack, never wider than the panel** (design round 17). It was
            `flex flex-col`, which put five full-width buttons in a tall
            column and, at desk, a tall column beside a screen of empty
            space. `grid-cols-5` cannot wrap, which is the rule stated as
            a layout rather than remembered: the labels break inside their
            own cell instead of the row breaking.

            A bare `fieldset`, not `FormField`, for the same round-17
            ruling — "neither the row nor the chips sit inside a field box"
            — and because the box was suppressing each button's focus
            ring. Labelled by the header's question rather than by a legend
            of its own: the board asks "Did it work?" once, in the ink
            header, and a second copy on the paper beneath would be the
            question twice. */}
          <fieldset
            aria-labelledby={QUESTION_ID}
            className="m-0 flex flex-col gap-2 border-0 p-0 wide:max-w-panel"
          >
            <div
              // The name design's board gives this region
              // (`data-part="verdict-row"`), so a conformance run can diff
              // the two against each other rather than the whole screen —
              // and so a failure reports as "A3 verdict row". `data-slot` is
              // this repo's existing spelling of the same idea; `top-bar`
              // and `tab-bar` already match design's names for free.
              data-slot="verdict-row"
              className="grid grid-cols-5 gap-1"
            >
              {verdictScale.map((choice) => {
                const isChosen = verdict === choice.value;
                return (
                  <button
                    key={choice.value}
                    type="button"
                    // The chosen one was announced to nobody. Visually it is
                    // an ink inversion plus a pair of brackets, and the
                    // brackets are `aria-hidden` (they are a move, not a
                    // word) — so a reader heard five identical buttons and
                    // no indication of which was picked. Rule 01 is "remove
                    // every colour and the meaning survives", and here it
                    // did not.
                    //
                    // `aria-pressed`, not a `radiogroup`: the contract asks
                    // for five radios with arrow-key navigation, which is a
                    // behaviour change this lane may not make. A
                    // single-select toggle group is honest about what the
                    // control does today and announces the state; the
                    // radiogroup is D-84.
                    aria-pressed={isChosen}
                    // Read-only once logged, and still focusable: rule 07
                    // bans `disabled`, and a receipt is for reading.
                    aria-disabled={isLocked || undefined}
                    onClick={() => {
                      if (!isLocked) setVerdict(choice.value);
                    }}
                    // `target` at the site rather than inside
                    // `VERDICT_BASE`: the 44px hit area is this button's,
                    // and `targets-and-focus` resolves a double-quoted
                    // constant but not a template literal — which both of
                    // these now are, since they share a base.
                    className={`target ${isChosen ? verdictChosen(choice.value) : VERDICT_RESTING}`}
                  >
                    {isChosen ? (
                      <span
                        aria-hidden="true"
                        className={`bracket-close-start ${BRACKET_BASE} left-1`}
                      >
                        [
                      </span>
                    ) : undefined}
                    {choice.label}
                    {isChosen ? (
                      <span
                        aria-hidden="true"
                        className={`bracket-close-end ${BRACKET_BASE} right-1`}
                      >
                        ]
                      </span>
                    ) : undefined}
                  </button>
                );
              })}
            </div>
            <FieldMessage name="verdict" error={form.fieldErrors.verdict} />
          </fieldset>

          {history === undefined || bandFloor === undefined ? undefined : (
            <BandHistory
              counts={history.counts}
              bandFloor={bandFloor}
              units={units}
            />
          )}

          {/* **Chips, never a `<select>`** (design round 16), and since
            round 20 generated rather than listed: five, chosen from this
            runner's history in the band, with everything else one tap away
            in A3b. */}
          <VerdictChips
            chips={chips}
            chosenFlags={chosenFlags}
            chosenTags={tags}
            readOnly={isLocked}
            onToggle={toggleChip}
            onMore={() => {
              setSheetOpen(true);
            }}
          />
          <SpecificsSheet
            open={sheetOpen}
            onClose={() => {
              setSheetOpen(false);
            }}
            verdict={verdict}
            items={entry.items}
            answer={{ flagFor, onFlag: setFlag, tags, onTag: toggleTag }}
            field={form.field}
          />

          {isLocked ? (
            <NotedReceipt sentence={noted.sentence} />
          ) : (
            <>
              {/* A3's share-toggle as round 19 draws it: "Share to feed", with
              what sharing means on the line beneath. The line is outside the
              label and linked with `aria-describedby`, so the checkbox's
              accessible name stays the three words and the sentence is read
              as its description. It was "Share this — the verdict label
              shows on the post", one line inside the label. */}
              <div className="flex flex-col gap-1">
                <label className="target flex items-center gap-2 text-body">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    aria-describedby={SHARE_HINT_ID}
                    onChange={(event) => {
                      setIsPublic(event.target.checked);
                    }}
                  />
                  Share to feed
                </label>
                <span id={SHARE_HINT_ID} className="text-small text-muted">
                  Shared runs show your kit, conditions, and your verdict.
                </span>
              </div>

              <FormFailureBand
                failure={form.failure}
                onRetry={form.retry}
                retryRef={form.retryRef}
              />
              <SubmitButton
                label="Log it"
                pendingLabel="Logging"
                pending={form.pending}
              />
            </>
          )}
        </form>
      </DeskSplit>
    </FlowStep>
  );
}

/**
 * A3's rail at the desk (round 25): the run being judged and the kit worn
 * on it, read-only. *"The rail shows the kit being judged."*
 *
 * The board also draws each piece's record in the band and the runner's
 * last runs there. Neither is loaded on this screen yet, so they wait for
 * a read of their own rather than a guess here.
 */
function VerdictRail({
  entry,
  units,
}: Readonly<{ entry: Entry; units: Units }>): JSX.Element {
  const zone = entry.conditions?.timeZone;
  const { conditions } = entry;
  return (
    <>
      <RailCard
        title={`This run · ${dayLabel(entry.startedAt, zone)} · ${clockLabel(entry.startedAt, zone)}`}
      >
        <Mono step="sm">
          {`${distanceNumber(entry.distanceM, units.distance)} ${units.distance} · ${formatDuration(entry.durationS)}`}
        </Mono>
        {conditions === undefined ? undefined : (
          <>
            <Mono step="sm" className="text-dialed-text">
              {`${formatTemp(conditions.tempC, units.temp)}${units.temp.toUpperCase()} ${precipClassOf(conditions.precipMm)} · feels ${formatTemp(conditions.feelsLikeC, units.temp)}`}
            </Mono>
            <WeatherAttribution />
          </>
        )}
      </RailCard>
      <RailCard title="The kit you’re judging">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {entry.items.map((item) => (
            <li key={item.itemId} className="text-body font-semibold">
              {item.name}
            </li>
          ))}
        </ul>
      </RailCard>
    </>
  );
}
