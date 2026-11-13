import type { ComponentProps, JSX, ReactNode } from "react";
import { useState } from "react";

import {
  entryTags,
  verdictScale,
  writableAudienceOf,
} from "../../../lib/contracts";
import type {
  Units,
  VerdictValue,
  WritableAudience,
} from "../../../lib/contracts";
import { dayLabel, viewerClockLabel } from "../../../lib/dates";
import { runsLabel } from "../../../lib/runs-label";
import type { BandRun } from "../band-runs";
import { BackToRun } from "./BackToRun";
import { BandRunsCard } from "./BandRunsCard";
import { ThisRunCard } from "./ThisRunCard";
import { bandForms, distanceNumber } from "../../../lib/contracts/measures";
import { formatTemp } from "../../../lib/contracts/temperature";
import {
  AUDIENCE_HINTS,
  AUDIENCE_LABELS,
  ChoiceList,
  DeskSplit,
  FieldMessage,
  FlowStep,
  FormErrorSummary,
  FormFailureBand,
  FormStatus,
  GarminAttribution,
  LOG_FLOW,
  Mono,
  PhoneBell,
  PICKED_AUDIENCES,
  PUBLIC_PREVIEW_LINE,
  RailCard,
  Spoken,
  SubmitButton,
  useFormSubmit,
  useUnconfirmedRefusal,
  verdictHue,
  WeatherAttribution,
} from "../../../ui";
import type { FieldProps } from "../../../ui";

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

/**
 * The cell's focus ring. The radio inside it holds focus, so the ring is
 * drawn on the cell (`has-[:focus-visible]`), as the tap list's chips do.
 */
const VERDICT_FOCUS =
  "cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink";

/**
 * The native radio, filling its cell rather than `sr-only`: a pointer
 * aimed at the cell lands on the control, not on the label's words (the
 * tap list's chips found this; see `TapListForm`).
 */
const VERDICT_RADIO =
  "absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0";
import { submitVerdictInput } from "../inputs";
import { BandHistory } from "./BandHistory";
import { isProvidersReading } from "../strip";
import {
  NotedReceipt,
  notedAnnouncement,
  type NotedSentence,
} from "./NotedReceipt";
import { SpecificsSheet } from "./SpecificsSheet";
import { SpecificsPage } from "./SpecificsPage";
import { PushFrame } from "./PushPage";
import { isAtDesk } from "../kit-push";
import { VerdictChips } from "./VerdictChips";
import type { BandSignals } from "../band-signals";
import { EffortField, useEffortPick } from "./EffortField";
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
  audience: "Who sees this run",
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
 * are the run's own zone (R-96, from the observation), the distance is the
 * runner's unit, and the temperature is the one the run started in. With
 * no conditions the line names the unit instead ("6.2 MI", the
 * nothing-moved frame), since there is no "at" to say.
 *
 * `data-ground="ink-until-wide"` is the product's inverted block (the top
 * bar is the first), so the tokens inside it flip rather than each class
 * naming a dark-on-light pair — **on the phone only.** From `wide` the
 * header is the title line on the page's own ground (Desktop Contract DS0
 * bend 4; round 25's A3 desk: *"The ink header becomes the title line"*):
 * the question as the TYPE.title heading, and one mono sub-line carrying
 * the run — *"SAT AUG 29 · 6:04 AM · 6.2 AT 41°"* — in `--dialed-text`,
 * which is what the ink block's teal already resolves to on paper.
 *
 * **The two widths read in different orders, so each has its own line.**
 * The phone reads run, then question; the desk reads question, then run.
 * Reordering one set of elements with `order-*` would show one sequence
 * and announce the other (WCAG 1.3.2), so the mono line is written twice
 * — once before the heading for the phone, once after it for the desk —
 * and `display: none` keeps the one not shown out of the reading order.
 */
function RunHeader({
  entry,
  units,
}: Readonly<{ entry: Entry; units: Units }>): JSX.Element {
  const zone = entry.conditions?.timeZone;
  // Marked UTC when the run has no zone, as the This run card is (P2a-02).
  const when = `${dayLabel(entry.startedAt, zone)} · ${viewerClockLabel(entry.startedAt, { homeZone: zone })}`;
  const distance = distanceNumber(entry.distanceM, units.distance);
  // With conditions the board drops the unit to fit the temperature
  // (`6.2 AT 41°`); a reader still needs it, so it is said, not drawn.
  // `normal-case`, so the headline's capitals do not spell it out.
  const headline =
    entry.conditions === undefined ? (
      `${distance} ${units.distance}`
    ) : (
      <>
        {distance}
        <span className="sr-only normal-case">{` ${units.distance}`}</span>
        {` at ${formatTemp(entry.conditions.tempC, units.temp)}`}
      </>
    );
  return (
    <header
      data-slot="header"
      data-ground="ink-until-wide"
      className="-mx-5 -mt-6 flex flex-col gap-2 bg-ground px-5 py-5 text-ink wide:mx-0 wide:mt-0 wide:gap-1 wide:px-0 wide:py-0"
    >
      {/* "← Back" above the title at both widths, sharing its row with
          the phone's bell (Round 55 · 242; Design 169.1). */}
      <div className="flex items-center justify-between gap-3">
        <BackToRun runId={entry.runId} />
        <PhoneBell />
      </div>
      <Mono step="xs" className="text-muted wide:hidden">
        {when}
      </Mono>
      <p className="m-0 font-display text-display uppercase wide:hidden">
        {headline}
      </p>
      <h1
        id={QUESTION_ID}
        className="m-0 text-body font-normal text-quiet wide:font-display wide:text-title wide:text-ink"
      >
        {LABELS.verdict}
      </h1>
      {/* The run came through Garmin's API: its credit is the first line
          under the title (G1; D2-12), once on the screen. */}
      <GarminAttribution deviceName={entry.deviceName} />
      <Mono step="xs" className="hidden text-dialed-text wide:block">
        {when} · {headline}
      </Mono>
      {/* The headline is the provider's reading at every width, and below
          the desk the rail that also credits it is not drawn (D-144). */}
      {isProvidersReading(entry.conditions) ? (
        <WeatherAttribution />
      ) : undefined}
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
  privateLine,
  isVerified,
  // The flow's own move rather than the screen's: A3b's push.
  ...step
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
   * line beneath the row (R-97); `signals`, each kit garment's record and
   * the tag use, for the generated chips (round 20) and the rail's kit
   * record; `runs`, the rail's band history (round 25). Absent when the
   * run has no conditions, and therefore no band — then the line is not
   * drawn, the chips suggest no garment and the rail shows the run alone.
   */
  history:
    | {
        counts: Readonly<Record<number, number>>;
        signals: BandSignals;
        runs: readonly BandRun[];
      }
    | undefined;
  submitVerdict: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  itemBandWearStat: (input: {
    data: { itemId: string; bandFloorC: number };
  }) => Promise<{ worn: number; total: number }>;
  /**
   * The share switch's sub-line in the PRIVATE state (D-108 E, round 32
   * frame 2a), given the id the switch is described by: onboarding's
   * `PrivateRunLine`, which reads the runner's totals setting and whether
   * their address is confirmed. The route's to wire, since a module
   * reaches another only through its barrel.
   */
  privateLine: (hintId: string) => ReactNode;
  /**
   * Whether the runner's address is confirmed. An unconfirmed runner's run
   * saves private (D-50), so the audience is held at PRIVATE for them
   * (R47·123).
   */
  isVerified: boolean;
  /**
   * A3b at the desk (Round 54 · 164.3): whether it is pushed, from A3's
   * URL, and the route's two moves, since it owns the URL — to the page,
   * and back to A3 with the answer still on it.
   */
  push: { isPushed: boolean; onPush: () => void; onDone: () => void };
}>) {
  const { verdict, setVerdict, tags, setTags, flags, setFlags } =
    useAnswer(entry);
  const [audience, setAudience] = useHeldAudience(entry.audience, isVerified);
  // Present once the verdict is saved. The sentence inside it can still be
  // absent: the save landed and only the record's count failed to come
  // back, and the receipt is not held hostage to it.
  const [noted, setNoted] = useState<{
    sentence: NotedSentence | undefined;
  }>();
  const effort = useEffortPick(entry.effort);
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
  async function notedSentence(): Promise<NotedSentence | undefined> {
    const plan = notedPlan(bandFloor, entry.items);
    if (plan.kind === "nothing-moved") {
      return { shown: plan.sentence, said: plan.sentence };
    }
    try {
      const stat = await itemBandWearStat({
        data: { itemId: plan.itemId, bandFloorC: plan.bandFloorC },
      });
      const record = `${plan.name} is now ${String(stat.worn)} of ${String(stat.total)} in`;
      const band = bandForms(plan.bandFloorC, units.temp);
      return {
        shown: `${record} ${band.shown}.`,
        said: `${record} ${band.said}.`,
      };
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
    carry: "run",
    schema: submitVerdictInput,
    action: async (values) => submitVerdict({ data: values }),
    // Nothing here: the save is announced once, by Noted's own sentence,
    // when it lands (`notedAnnouncement` below). A "Verdict saved." first
    // was a second announcement of the same save.
    successMessage: "",
    labels: LABELS,
    onSuccess: async () => {
      setNoted({ sentence: await notedSentence() });
    },
  });

  function payload() {
    return {
      entryId,
      verdict,
      audience,
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
      ...(effort.pickedByRunner && { effort: effort.effort }),
    };
  }

  // After Log it the form becomes its own receipt (design round 20): the
  // answer stays on screen, read-only, and Noted takes the submit's place.
  const isLocked = noted !== undefined;

  const chosenFlags = chosenFlagsOf(flags);
  const chips = suggestChips({
    verdict,
    kit: entry.items,
    ...chipHistory(history?.signals),
    chosenFlags,
    chosenTags: tags,
  });

  function setFlag(itemId: string, flag: ItemFlagChoice): void {
    setFlags((prev) => ({ ...prev, [itemId]: flag }));
  }

  function toggleTag(tag: string): void {
    setTags((prev) => toggledIn(prev, tag));
  }

  // A3b's answer, the sheet's and the page's: A3's own, not a copy.
  const answer = { flagFor, onFlag: setFlag, tags, onTag: toggleTag };
  const specifics = useSpecifics(step.push, {
    verdict,
    items: entry.items,
    answer,
    field: form.field,
  });

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
      <DeskSplit
        rail={
          <VerdictRail
            entry={entry}
            units={units}
            band={railBand(bandFloor, history)}
          />
        }
      >
        <form
          ref={form.formRef}
          noValidate
          // `pb-8`, as A2's column has: at the desk the shell has no tab bar
          // to clear, and Log it sat flush on the page's bottom (D2-01).
          className="mx-auto flex w-full max-w-panel flex-col gap-6 px-5 pt-6 pb-8 wide:max-w-column"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit(payload());
          }}
        >
          <PushFrame pushed={specifics.page}>
            <RunHeader entry={entry} units={units} />
            <FormStatus>
              {noted === undefined
                ? form.status
                : notedAnnouncement(noted.sentence)}
            </FormStatus>
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
            {/* **Five radios in a `radiogroup`** (Accessibility Contract
            rule 05, R-84 c): arrow keys move between them and choose as
            they go, space chooses the one focused, and Tab enters on the
            chosen one, or the first while there is none. They are native
            radios, so the browser does all three. */}
            <fieldset
              role="radiogroup"
              aria-labelledby={QUESTION_ID}
              className="m-0 flex flex-col gap-2 border-0 p-0 wide:max-w-panel"
            >
              <VerdictRow
                verdict={verdict}
                isLocked={isLocked}
                onChoose={setVerdict}
              />
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
              onMore={specifics.onMore}
            />
            {specifics.sheet}

            <EffortField
              effort={effort.effort}
              watchRpe={effort.watchRpe}
              readOnly={isLocked}
              onPick={effort.pick}
            />

            {isLocked ? (
              <NotedReceipt sentence={noted.sentence} />
            ) : (
              <>
                <AudiencePicker
                  audience={audience}
                  isVerified={isVerified}
                  onChange={setAudience}
                  field={form.field}
                  privateLine={privateLine}
                />

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
          </PushFrame>
        </form>
      </DeskSplit>
    </FlowStep>
  );
}

/**
 * The answer as the chip rule reads it: Fine is the default and is never
 * a chip, so "none" is simply not a choice here.
 */
function chosenFlagsOf(
  flags: Readonly<Record<string, ItemFlagChoice>>,
): Record<string, Flag> {
  const chosenFlags: Record<string, Flag> = {};
  for (const [itemId, flag] of Object.entries(flags)) {
    if (flag !== "none") chosenFlags[itemId] = flag;
  }
  return chosenFlags;
}

/**
 * What the chips read of this runner's history in the band: nothing, when
 * the run has no band — then the chips suggest no garment.
 */
function chipHistory(
  signals: BandSignals | undefined,
): Pick<Parameters<typeof suggestChips>[0], "records" | "tagUse"> {
  return {
    records: signals?.garments ?? {},
    tagUse: signals?.tagUse ?? {},
  };
}

/**
 * The answer being given, seeded from the entry rather than from nothing:
 * the verdict, the tags, and each piece's flag.
 *
 * `entry.items[].flag` is what was saved last time, and starting empty
 * meant re-opening a verdict showed every piece as unflagged — so saving
 * again silently cleared flags the runner had set.
 */
function useAnswer(entry: Entry) {
  const [verdict, setVerdict] = useState<number | undefined>(entry.verdict);
  const [tags, setTags] = useState<Set<string>>(new Set(entry.tags));
  const [flags, setFlags] = useState<Record<string, ItemFlagChoice>>(() =>
    Object.fromEntries(
      entry.items.map((item) => [item.itemId, item.flag ?? "none"]),
    ),
  );
  return { verdict, setVerdict, tags, setTags, flags, setFlags };
}

/**
 * Who sees the run, held at PRIVATE for an unconfirmed runner (R47·123):
 * what the group shows is what the save sends, so neither says a run will
 * be shared when D-50 keeps it private.
 */
function useHeldAudience(
  saved: Entry["audience"],
  isVerified: boolean,
): readonly [WritableAudience, (audience: WritableAudience) => void] {
  const [picked, setPicked] = useState<WritableAudience>(
    writableAudienceOf(saved),
  );
  return [isVerified ? picked : "private", setPicked];
}

/**
 * A3's verdict row: five native radios, each filling its cell (R-84 c).
 * Its own component so the form keeps under the complexity bar; the
 * choosing, locking and drawing of a cell are this row's alone.
 */
function VerdictRow({
  verdict,
  isLocked,
  onChoose,
}: Readonly<{
  verdict: number | undefined;
  isLocked: boolean;
  onChoose: (value: VerdictValue) => void;
}>): JSX.Element {
  return (
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
          <label
            key={choice.value}
            // `target` at the site rather than inside
            // `VERDICT_BASE`: the 44px hit area is this cell's,
            // and `targets-and-focus` resolves a double-quoted
            // constant but not a template literal — which both of
            // these now are, since they share a base.
            className={`target ${VERDICT_FOCUS} ${isChosen ? verdictChosen(choice.value) : VERDICT_RESTING}`}
          >
            <input
              type="radio"
              name="verdict"
              value={choice.value}
              // Announced as checked: the ink inversion and the
              // brackets are drawn, and the brackets are
              // `aria-hidden` (rule 01).
              checked={isChosen}
              // Read-only once logged, and still focusable: rule
              // 07 bans `disabled`, and a receipt is for reading.
              aria-disabled={isLocked || undefined}
              onChange={() => {
                if (!isLocked) onChoose(choice.value);
              }}
              className={VERDICT_RADIO}
            />
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
          </label>
        );
      })}
    </div>
  );
}

/**
 * Who sees this run (round 41 #86a): A3's share switch became a three-row
 * radiogroup, PRIVATE / SHARED / PUBLIC, each with what it means under its
 * label. Under the group, the line for the audience picked: the route's
 * `privateLine` for PRIVATE, and for PUBLIC what a link preview keeps.
 * SHARED's own sub-line says all it needs.
 *
 * The line is outside the labels, so a radio's name stays its label and
 * meaning, and it is read straight after the group. It describes the
 * picked radio alone (`optionDescribedBy`): the line is about that
 * choice, and on the unpicked two it would say what they do not do. The
 * runner's default is what the entry started with, and PUBLIC is never
 * picked for them.
 *
 * **An unconfirmed runner** (R47·123): the group is held at PRIVATE, every
 * option at full strength and none disabled. SHARED or PUBLIC opens #17's
 * confirm-email sheet without moving the selection, and the sheet hands
 * focus back to the option pressed (a modal dialog returns focus where it
 * was). Round 27's line, "Confirm your email to share. This run saves
 * private.", sits under the group and describes every option, since it is
 * why none but PRIVATE takes; D-108 E puts it before the totals line.
 */
function AudiencePicker({
  audience,
  isVerified,
  onChange,
  field,
  privateLine,
}: Readonly<{
  audience: WritableAudience;
  isVerified: boolean;
  onChange: (audience: WritableAudience) => void;
  field: (name: string) => FieldProps;
  privateLine: (hintId: string) => ReactNode;
}>): JSX.Element {
  const askToConfirm = useUnconfirmedRefusal();
  // SHARED's own sub-line says all it needs; the other two have a line.
  const hasLine = audience === "private" || audience === "world";
  return (
    <div className="flex flex-col gap-2">
      <ChoiceList
        name="audience"
        legend={LABELS.audience}
        options={PICKED_AUDIENCES}
        optionLabels={AUDIENCE_LABELS}
        // R54·166.5: an option's label is MONO.sm.
        optionStep="sm"
        optionHints={AUDIENCE_HINTS}
        optionDescribedBy={(option) =>
          !isVerified || (hasLine && option === audience)
            ? SHARE_HINT_ID
            : undefined
        }
        value={audience}
        field={field}
        // Held, a change can only be a press on SHARED or PUBLIC: the
        // checked radio fires none. So every one asks for the address.
        onChange={(next) => {
          if (isVerified) onChange(next);
          else askToConfirm?.("share");
        }}
      />
      {audience === "private" ? privateLine(SHARE_HINT_ID) : undefined}
      {audience === "world" ? (
        <span id={SHARE_HINT_ID} className="text-small text-muted">
          {PUBLIC_PREVIEW_LINE}
        </span>
      ) : undefined}
    </div>
  );
}

/**
 * A3's rail at the desk (round 25): the run being judged, the kit worn on
 * it with each piece's record in the band, and the band history beneath,
 * read-only. *"The rail shows the kit being judged, with each piece's
 * record in the band, above the same band history as A2."*
 *
 * The records are the chips' own (`signals`), so the rail shows the
 * record a suggested flag comes from. With no band — no conditions — the
 * kit is listed alone and there is no history to show.
 */
function VerdictRail({
  entry,
  units,
  band,
}: Readonly<{
  entry: Entry;
  units: Units;
  band: RailBand | undefined;
}>): JSX.Element {
  const { conditions } = entry;
  return (
    <>
      {/* A3's entry carries no home zone, so its clock is the run's own,
          and a run without one reads on UTC, marked. */}
      <ThisRunCard
        run={{ ...entry, clockZone: entry.conditions?.timeZone }}
        units={units}
      />
      <RailCard title="The kit you’re judging">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {entry.items.map((item) => (
            <li
              key={item.itemId}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-body font-semibold">{item.name}</span>
              {band === undefined ? undefined : (
                <KitRecord
                  record={band.signals.garments[item.itemId]}
                  bandFloor={band.floor}
                  units={units}
                />
              )}
            </li>
          ))}
        </ul>
      </RailCard>
      {band === undefined || conditions === undefined ? undefined : (
        <BandRunsCard
          lead={() => "Before, in"}
          bandFloor={band.floor}
          precipMm={conditions.precipMm}
          runs={band.runs}
          units={units}
        />
      )}
    </>
  );
}

/**
The rail's band: its floor and the history read for it, or none without both.
*/
function railBand(
  bandFloor: number | undefined,
  history: { signals: BandSignals; runs: readonly BandRun[] } | undefined,
): RailBand | undefined {
  return bandFloor === undefined || history === undefined
    ? undefined
    : { floor: bandFloor, ...history };
}

interface RailBand {
  floor: number;
  signals: BandSignals;
  runs: readonly BandRun[];
}

/**
 * A piece's record in the band, as A3's rail draws it: "8/9 DIALED ·
 * 38–46°", said "8 of 9 runs dialed in 38 to 46 degrees" (round 53 ·
 * 162.3). A piece not worn in the
 * band before has no record to show, so the line is absent.
 */
function KitRecord({
  record,
  bandFloor,
  units,
}: Readonly<{
  record: BandSignals["garments"][string] | undefined;
  bandFloor: number;
  units: Units;
}>): JSX.Element | undefined {
  if (record === undefined || record.total === 0) return;
  const dialed = String(record.dialed);
  const band = bandForms(bandFloor, units.temp);
  return (
    <Mono step="xs" className="shrink-0 text-muted">
      <Spoken
        shown={`${dialed}/${String(record.total)} dialed · ${band.shown}`}
        said={`${dialed} of ${runsLabel(record.total)} dialed in ${band.said}`}
      />
    </Mono>
  );
}

/**
 * A3b's two surfaces, of which one is drawn (Round 54 · 164.3): the page
 * pushed into the column at the desk, or the sheet below it. Never both —
 * they hold the same radios, and one form cannot hold two groups of one
 * name. MORE pushes or opens by the width when it is pressed.
 */
function useSpecifics(
  push: { isPushed: boolean; onPush: () => void; onDone: () => void },
  body: Omit<ComponentProps<typeof SpecificsPage>, "back" | "onDone">,
): { page: ReactNode; sheet: ReactNode; onMore: () => void } {
  const [isOpen, setIsOpen] = useState(false);
  const onMore = (): void => {
    if (isAtDesk()) push.onPush();
    else setIsOpen(true);
  };
  if (push.isPushed) {
    return {
      page: (
        <SpecificsPage back={LABELS.verdict} onDone={push.onDone} {...body} />
      ),
      sheet: undefined,
      onMore,
    };
  }
  return {
    page: undefined,
    sheet: (
      <SpecificsSheet
        open={isOpen}
        onClose={() => {
          setIsOpen(false);
        }}
        {...body}
      />
    ),
    onMore,
  };
}
