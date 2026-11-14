import { Link, useRouter } from "@tanstack/react-router";
import type { JSX, KeyboardEvent } from "react";
import { Fragment, useState } from "react";

import type { VerdictValue } from "../../../lib/contracts";
import { measuredLine } from "../../../lib/contracts/measures";
import type { Units } from "../../../lib/contracts";
import { dayLabel, proseDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  classifyFailure,
  ControlFailureBand,
  Mono,
  PendingLabel,
  PhoneBell,
  Spoken,
  verdictHue,
  WeatherAttribution,
} from "../../../ui";
import type { ControlFailure } from "../../../ui";
import type {
  BacklogKit,
  BacklogRow,
  BacklogSuggestion,
  Conditions,
} from "../../feed";
import type { VerdictSlot } from "../backlog-keys";
import { actionForKey, rowAfterMove, verdictKeys } from "../backlog-keys";

/**
 * DS2 — the one wide layout v1 earns.
 *
 * *"A row per imported run with no outfit. **Each row is A3's three
 * inputs laid flat** — outfit, verdict, save — not a new form."* The
 * reason it exists is the keyboard: *"the phone version is six S1
 * prompts, each opening an A3 sheet — six round trips for six decisions
 * the runner can make in twelve seconds once the conditions and their
 * usual kit are side by side. The table doesn't add inputs; it removes
 * the trips."*
 *
 * Two things follow from "not a new form" and both are load-bearing.
 * Editing an outfit still opens A2, as the route it already is — a `Link`,
 * not a picker rebuilt here. And a row saves through the same `attachKit`
 * + `submitVerdict` the phone calls, so *"verdicts saved here count
 * exactly like verdicts from the phone. There is no 'bulk' rule — every
 * row is one A3."*
 *
 * A saved row **stays where it is**: *"it leaves the list on the next
 * visit, not on save — motion has no 'row flies away'."*
 */

/**
 * The slot's shape, which is DS2's own: a shrunk, square-cornered mono
 * key, in capitals as MONO.xs is everywhere (D1-11; `ui/Mono` pairs the
 * step with `uppercase`, and the accessible name stays in normal case). Its *colour* is not DS2's to choose — see `ui/verdictHue`, which A3
 * reads too, so the two mirrored surfaces cannot drift apart (round 19).
 */
const SLOT_BASE =
  "inline-flex flex-col items-center justify-center rounded-none border px-0.5 text-center font-mono text-mono-xs uppercase desk:px-2";
const SLOT_RESTING = `${SLOT_BASE} border-hairline-2 font-normal text-quiet`;

/**
 * Resting, or chosen and wearing its verdict's T2 hue.
 *
 * A resting slot is `--quiet` rather than `--muted`, which is the board's
 * own off state. The hue is read from the value's sign by `verdictHue`, so
 * both cold steps are pink and both warm steps grey — round 16: *"hue
 * follows T2 and **position carries the degree**, as AB1 says it must."*
 */
function slotClass(value: VerdictValue, isChosen: boolean): string {
  return isChosen
    ? `${SLOT_BASE} font-bold ${verdictHue(value)}`
    : SLOT_RESTING;
}

/**
 * The day a row's run happened, where it happened (R-96).
 *
 * A late-evening Chicago run is the Monday it was run on, not the Tuesday
 * UTC had reached; the zone comes from the run's own observation. A run
 * with none — indoor, a typed temperature, an hour cached before zones
 * were stored — is dated in UTC, as every row was before.
 *
 * Every date the row shows goes through here — the cell, the rail, and
 * what the live region says on save — so a row cannot be one day in the
 * table and another in the announcement.
 */
function runDay(row: BacklogRow): string {
  return dayLabel(row.startedAt, row.conditions?.timeZone);
}

/**
 * The row's and the rail's conditions, as one measured line.
 *
 * **The actual temperature, and wind in the runner's units.** It led with
 * feels-like and wrote `WIND ${windKph}` — kph for everybody — which is how
 * task 115 misread DS2's `41°F · 88% · MIST · SE 9`. Found by the
 * 2026-09-22 reconciliation sweep, where a runner set to miles read
 * `36° · light rain · WIND 15` for a 41°F morning with a 9mph wind.
 *
 * Still short of the board by two fields, both recorded rather than faked:
 * humidity is in the observations table but not in `Conditions`, and wind
 * *direction* is not stored at all.
 */
function conditionsLine(
  conditions: Conditions,
  units: Units,
): { shown: string; said: string } {
  // A line of measures (round 52 #158): drawn, and said in words.
  return measuredLine(
    [
      [{ kind: "temp", tempC: conditions.tempC }],
      [{ kind: "word", word: conditions.condition }],
      [{ kind: "wind", windKph: conditions.windKph }],
    ],
    units,
  );
}

/**
 * A kit as the row draws it: its pieces' names on one line, truncated at
 * the desk rather than stacking chips (Round 55 · 236), in full on a card.
 *
 * An entry saved with nothing on it says so in words, rather than leaving
 * an empty cell that reads as a failed load.
 */
function KitLine({ kit }: Readonly<{ kit: BacklogKit }>): JSX.Element {
  if (kit.itemNames.length === 0) {
    return <span className="text-small text-quiet">No kit on this run</span>;
  }
  return (
    <span
      data-part="kit-line"
      className="block text-small text-quiet desk:truncate"
    >
      {kit.itemNames.join(", ")}
    </span>
  );
}

/**
 * The outfit cell: the kit this row will save, or the offer of one.
 *
 * *"Same as Monday? Use · Pick"* — and `Pick` is A2 at its own route,
 * which at width is the centred panel. That is the whole of "editing an
 * outfit still opens A2 in the panel": no picker is rebuilt here.
 *
 * **A run that already has a kit offers neither.** It is in the backlog
 * for its verdict alone (the owner's ruling), and `attachKit` never
 * replaces a kit — so the row shows the kit the verdict will be saved
 * against, and saves only the verdict.
 */
function OutfitCell({
  runId,
  day,
  suggestion,
  chosen,
  onUse,
}: Readonly<{
  runId: string;
  /**
  The row's day, for Use's and Pick's names, as the verdict buttons have it.
  */
  day: string;
  suggestion: BacklogSuggestion | undefined;
  chosen: BacklogKit | undefined;
  onUse: (kit: BacklogSuggestion) => void;
}>): JSX.Element {
  if (chosen !== undefined) return <KitLine kit={chosen} />;

  return (
    <div className="flex items-center gap-2">
      {/* Round 20: "Same as …?" offers the nearest kit; with nothing near
          enough the cell says so — "No usual kit here · Pick" — rather
          than leaving Pick on its own to explain itself. */}
      {suggestion === undefined ? (
        <span className="shrink-0 text-small text-quiet">
          No usual kit here ·
        </span>
      ) : (
        <>
          <span className="min-w-0 truncate text-small text-quiet">
            Same as {proseDayLabel(suggestion.wornAt)}?
          </span>
          <button
            type="button"
            aria-label={`Use — ${day}`}
            onClick={() => {
              onUse(suggestion);
            }}
            className="target inline-flex shrink-0 items-center px-2 text-body font-semibold text-cold-text"
          >
            Use
          </button>
        </>
      )}
      <Link
        to="/feed/attach/$runId"
        params={{ runId }}
        aria-label={`Pick — ${day}`}
        className="target inline-flex shrink-0 items-center px-2 text-body font-semibold text-cold-text"
      >
        Pick
      </Link>
    </div>
  );
}

/**
 * One verdict slot — A3's button, shrunk.
 *
 * Round 16 made the mirror the rule: *"the verdict cell is A3's five
 * buttons, shrunk, in A3's order and with A3's words."* No digits
 * anywhere on the surface, because the Flow Map forbids numeric scores in
 * the UI and because a runner who saw `1`–`5` on film could not tell what
 * they were. The digits survive as shortcuts, in the legend only.
 *
 * `text-mono-xs` and not the board's 9px: MONO.xs is 10px and `tokens.js`
 * calls it the floor everywhere. The board says so too — "nothing shrinks
 * below MONO.xs" — in the same paragraph it draws 9px, and a contract
 * beats a drawing.
 */
function VerdictSlotButton({
  slot,
  day,
  isChosen,
  onChoose,
}: Readonly<{
  slot: VerdictSlot;
  day: string;
  isChosen: boolean;
  onChoose: () => void;
}>): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={isChosen}
      // The visible word is the label, so the accessible name adds only
      // what the eye gets from the row it is in. The key is not in the
      // name: it is a shortcut, and reading "key 3" to somebody who
      // cannot see the legend is noise.
      aria-label={`${slot.label} — ${day}`}
      onClick={onChoose}
      // `target` at the site rather than inside `SLOT_BASE`: the 44px hit
      // area is the button's and belongs where a reviewer — and
      // `targets-and-focus`, which reads one level of constant and not a
      // function call — can see it. The treatment is what `slotClass`
      // decides.
      className={`target ${slotClass(slot.value, isChosen)}`}
    >
      {slot.label}
    </button>
  );
}

export interface VerdictBacklogProps {
  rows: readonly BacklogRow[];
  units: Units;
  saveRow: (input: {
    data: { runId: string; itemIds: string[]; verdict: number };
  }) => Promise<unknown>;
}

export function VerdictBacklog({
  rows,
  units,
  saveRow,
}: Readonly<VerdictBacklogProps>): JSX.Element {
  const [selected, setSelected] = useState(0);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, VerdictValue>>(
    new Map(),
  );
  const [kits, setKits] = useState<ReadonlyMap<string, BacklogKit>>(new Map());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<string | undefined>();
  const [failures, setFailures] = useState<ReadonlyMap<string, ControlFailure>>(
    new Map(),
  );
  const [said, setSaid] = useState("");
  const router = useRouter();

  function use(row: BacklogRow, kit: BacklogSuggestion): void {
    setKits(new Map(kits).set(row.runId, kit));
  }

  function choose(row: BacklogRow, value: VerdictValue): void {
    setVerdicts(new Map(verdicts).set(row.runId, value));
  }

  /**
  The kit a row will save: the one its run already has, or the one taken.
  */
  function kitOf(row: BacklogRow): BacklogKit | undefined {
    return row.kit ?? kits.get(row.runId);
  }

  async function save(row: BacklogRow): Promise<void> {
    const verdict = verdicts.get(row.runId);
    const kit = kitOf(row);
    // Both halves, and the message names the missing one: a row is A3's
    // three inputs, and A3 does not save without an outfit either.
    if (kit === undefined) {
      setSaid("Pick an outfit for this run first.");
      return;
    }
    if (verdict === undefined) {
      setSaid("Choose how it felt, 1 to 5.");
      return;
    }
    // A retry starts clean: leaving last attempt's band on a row that is
    // being saved again would say "this failed" about something still in
    // flight.
    setFailures(without(failures, row.runId));
    setSaving(row.runId);
    try {
      await saveRow({
        data: { runId: row.runId, itemIds: [...kit.itemIds], verdict },
      });
      const nowSaved = new Set(saved).add(row.runId);
      setSaved(nowSaved);
      setSaid(`Saved ${runDay(row)}.`);
      setSelected(rowAfterMove(selected, 1, rows.length));
      // The last row cleared: the queue is empty, so the bar's count goes
      // (round 22, item 18) — asked of the server, which is the only thing
      // that knows the count.
      if (rows.every((each) => nowSaved.has(each.runId))) {
        await router.invalidate();
      }
    } catch (error: unknown) {
      // Round 22, item 18: "the row keeps its place and choice, a failure
      // band spans it, Try again inside." A row is a control, not a form
      // (round 23, item 9), so its band is the control's: the kicker names
      // what is still true — the run is not logged — and the cause is the
      // classifier's own, so a dropped connection reads here exactly as it
      // does under Log it.
      //
      // Nothing animates: the failure path is static (task 114's
      // `failure-path-is-static` test says so for the form components,
      // and the rule is the doctrine's, not that file's).
      setFailures(
        new Map(failures).set(row.runId, {
          kicker: "Not logged",
          message: classifyFailure(error).message,
        }),
      );
      setSaid(`Could not save ${runDay(row)}. Try again.`);
    } finally {
      setSaving(undefined);
    }
  }

  function onKeyDown(
    event: KeyboardEvent<HTMLTableRowElement>,
    row: BacklogRow,
  ): void {
    const action = actionForKey(event.key);
    // A key the table does not claim stays the browser's — Tab above all,
    // which is how the outfit cell is reached at all.
    if (action === undefined) return;
    event.preventDefault();
    if (action.kind === "move") {
      setSelected(rowAfterMove(selected, action.by, rows.length));
      return;
    }
    if (action.kind === "verdict") {
      choose(row, action.slot.value);
      setSaid(`${runDay(row)}: ${action.slot.label}.`);
      return;
    }
    void save(row);
  }

  // Every row cleared — on this visit, or before it. "Clearing the last
  // shows [ ALL LOGGED ] and the bar's count goes."
  const isClear = rows.every((row) => saved.has(row.runId));
  // The row the table is on, or none once it is clear — which is also the
  // only way to have no rows at all (a typed URL with an empty queue), so
  // the one question narrows both.
  const current = isClear ? undefined : rows[selected];

  return (
    <div className="mx-auto flex w-full max-w-panel flex-col gap-4 px-6 py-8 desk:max-w-page">
      {/* The phone's bell ends the first row and stays on it while the
          title and its count wrap (Design 169.1). */}
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          {/* Round 55 · 237: VERDICTS, at the runs pages' TYPE.display
              step, so the title is true at zero. */}
          <h1 className="m-0 font-display text-display uppercase">Verdicts</h1>
          {current === undefined ? undefined : (
            <Mono step="sm" className="text-muted">
              {rows.length} need one · oldest first
            </Mono>
          )}
        </div>
        <PhoneBell />
      </div>

      {current === undefined ? (
        <AllLogged />
      ) : (
        <>
          <BacklogTable
            rows={rows}
            units={units}
            selection={{
              selected,
              onSelect: setSelected,
              onKeyDown: (event) => {
                onKeyDown(event, current);
              },
            }}
            rowState={{ saved, failures, kitOf, verdicts }}
            rowActions={{
              onUse: use,
              onChoose: choose,
              onSave: (row) => {
                void save(row);
              },
            }}
          />
          {/* Round 55 · 236: the rail goes, and the credit sits once
              under the table. */}
          <WeatherAttribution />
        </>
      )}

      {/* Rule 07: one live region per screen, and this is the screen's.
          Everything the keyboard does says so here — a table driven by
          keys with nothing announcing them is a table only a sighted
          runner can clear. Flush left, like the words around it. */}
      <p role="status" className="m-0 text-small text-quiet">
        <PendingLabel
          label={said}
          pendingLabel="Saving"
          pending={saving !== undefined}
          align="start"
        />
      </p>
    </div>
  );
}

/**
 * A row's saved mark, its failure (if any), and what it currently holds —
 * the three things the table reads per row but a row itself never sets.
 */
interface BacklogRowState {
  saved: ReadonlySet<string>;
  failures: ReadonlyMap<string, ControlFailure>;
  kitOf: (row: BacklogRow) => BacklogKit | undefined;
  verdicts: ReadonlyMap<string, VerdictValue>;
}

/**
 * The three things a row can do, all bubbling up to the screen that owns
 * `save`/`use`/`choose` — grouped so the table's own signature says "state"
 * and "actions" rather than eleven same-shaped props in a row.
 */
interface BacklogRowActions {
  onUse: (row: BacklogRow, kit: BacklogSuggestion) => void;
  onChoose: (row: BacklogRow, value: VerdictValue) => void;
  onSave: (row: BacklogRow) => void;
}

/**
 * Which row has the roving focus, and the two ways that changes — a mouse
 * focus and an arrow key. Grouped for the same reason `BacklogRowState` and
 * `BacklogRowActions` are: one thing the table is told, not three loose
 * same-shaped props.
 */
interface BacklogSelection {
  selected: number;
  onSelect: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => void;
}

/**
 * A cell: a block on a card, a table cell at the desk, where it holds one
 * line — dates and numbers never break (Round 55 · 236).
 */
const CELL =
  "block desk:table-cell desk:px-2 desk:py-1 desk:align-middle desk:whitespace-nowrap";

/**
 * The outfit cell takes what the others leave and truncates in it: at
 * the desk a zero max width with the full width is what lets a table cell
 * shrink below its content.
 */
const OUTFIT_CELL = `${CELL} desk:w-full desk:max-w-0`;

/**
 * The table, its keys, and the count beneath it — everything DS2 draws
 * while there is something left to log. Below the desk each row is a card,
 * as S1 draws a prompt (Round 55 · 236); from the desk up, a table row.
 */
function BacklogTable({
  rows,
  units,
  selection,
  rowState,
  rowActions,
}: Readonly<{
  rows: readonly BacklogRow[];
  units: Units;
  selection: Readonly<BacklogSelection>;
  rowState: Readonly<BacklogRowState>;
  rowActions: Readonly<BacklogRowActions>;
}>): JSX.Element {
  const { selected, onSelect, onKeyDown } = selection;
  const { saved, failures, kitOf, verdicts } = rowState;
  const { onUse, onChoose, onSave } = rowActions;
  return (
    <>
      <table className="block w-full border-collapse text-left desk:table">
        <thead className="hidden desk:table-header-group">
          <tr className="border-b border-hairline">
            {["Date", "Run", "Conditions", "Outfit", "Did it work?"].map(
              (heading) => (
                <th key={heading} scope="col" className="px-2 pb-2">
                  <Mono step="xs" className="text-muted">
                    {heading}
                  </Mono>
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="flex flex-col gap-3 desk:table-row-group">
          {rows.map((row, index) => {
            const failure = failures.get(row.runId);
            const isHere = index === selected;
            const day = runDay(row);
            const verdict = verdicts.get(row.runId);
            return (
              <Fragment key={row.runId}>
                <tr
                  // Roving focus: one row is in the tab order and the
                  // arrows move which. A table of fifty rows that put every
                  // row in the sequence would be fifty tab stops.
                  tabIndex={isHere ? 0 : -1}
                  aria-current={isHere ? "true" : undefined}
                  data-saved={saved.has(row.runId) ? "true" : undefined}
                  data-failed={failure === undefined ? undefined : "true"}
                  onFocus={() => {
                    onSelect(index);
                  }}
                  // On the row, the one focusable thing that holds focus
                  // (plan 161 step 7: a key handler on the body is one on
                  // a non-interactive element). Every row has it, and the
                  // one with focus answers: `↑`/`↓` move the selection,
                  // and focus follows it to the next row's handler.
                  onKeyDown={onKeyDown}
                  className={rowClass(isHere, failure !== undefined)}
                >
                  <td className={CELL}>
                    <span className="text-body font-semibold desk:font-mono desk:text-mono-sm desk:font-normal desk:uppercase">
                      {day}
                    </span>
                  </td>
                  <td className={CELL}>
                    {/* `--quiet`, like the conditions beside it: the
                        picked row is tinted, and `--muted` is 4.0:1 on
                        the tint. */}
                    <Mono step="sm" className="text-quiet">
                      <Spoken
                        {...measuredLine(
                          [
                            [{ kind: "duration", durationS: row.durationS }],
                            [{ kind: "distance", distanceM: row.distanceM }],
                          ],
                          units,
                        )}
                      />
                    </Mono>
                  </td>
                  <td className={CELL}>
                    {row.conditions === undefined ? (
                      <Mono step="sm" className="text-quiet">
                        No conditions
                      </Mono>
                    ) : (
                      <Mono step="sm" className="text-dialed-text">
                        <Spoken {...conditionsLine(row.conditions, units)} />
                      </Mono>
                    )}
                  </td>
                  <td className={OUTFIT_CELL}>
                    <OutfitCell
                      runId={row.runId}
                      day={day}
                      suggestion={row.suggestion}
                      chosen={kitOf(row)}
                      onUse={(kit) => {
                        onUse(row, kit);
                      }}
                    />
                  </td>
                  <td className={CELL}>
                    {/* `aria-pressed`, not a `radiogroup`, and for a
                        sharper reason than A3's: the arrow keys here move
                        between *rows*, so a group promising arrow-key
                        selection would be a promise the table cannot keep.
                        A3 reached the same answer from the other side
                        (R-84), and one answer to "what is a verdict
                        control" is the point. */}
                    <div className="grid grid-cols-5 gap-1 desk:flex">
                      {verdictKeys.map((slot) => (
                        <VerdictSlotButton
                          key={slot.key}
                          slot={slot}
                          day={day}
                          isChosen={verdict === slot.value}
                          onChoose={() => {
                            onChoose(row, slot.value);
                          }}
                        />
                      ))}
                    </div>
                    {/* A card has no Enter to press: A3's own verb, once
                        a verdict is picked (Round 55 · 236). */}
                    {verdict === undefined ? undefined : (
                      <button
                        type="button"
                        onClick={() => {
                          onSave(row);
                        }}
                        className="target mt-3 w-full rounded-card border-none bg-action px-4 font-display text-body uppercase text-accent-ink desk:hidden"
                      >
                        Log it
                      </button>
                    )}
                  </td>
                </tr>
                {failure === undefined ? undefined : (
                  // The band spans the row it is about, directly under it.
                  <tr data-slot="row-failure" className="block desk:table-row">
                    <td
                      colSpan={5}
                      className="block desk:table-cell desk:px-2 desk:pb-3"
                    >
                      <ControlFailureBand
                        failure={failure}
                        onRetry={() => {
                          onSave(row);
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-4">
        <span className="hidden flex-wrap items-center gap-4 desk:flex">
          <Mono step="xs" className="text-muted">
            Keys
          </Mono>
          {LEGEND.map(({ keys, does, said }) => (
            <span key={does} className="flex items-center gap-2 text-small">
              {/* The glyphs are read as "up arrow down arrow" or not at
                  all, so each entry is said as a sentence instead. */}
              <Mono step="sm" className="border border-hairline-2 px-2 py-1">
                <span aria-hidden="true">{keys}</span>
              </Mono>
              <span aria-hidden="true">{does}</span>
              <span className="sr-only">{said}</span>
            </span>
          ))}
        </span>
        <Mono step="sm" className="ml-auto text-muted">
          {saved.size} of {rows.length} saved
        </Mono>
      </div>
    </>
  );
}

/**
 * A run below the desk is a card, as S1 draws a prompt; from the desk up
 * it is a table row on a hairline. **The picked row takes the tint**
 * (Round 55 · 236), which is what lets the rail's "Selected" card go.
 */
const ROW_CLASS =
  "row-press flex flex-col gap-2 rounded-card border border-hairline bg-panel p-4 desk:table-row desk:rounded-none desk:border-x-0 desk:border-t-0 desk:bg-transparent desk:p-0";
const ROW_PICKED_CLASS =
  "row-press flex flex-col gap-2 rounded-card border border-hairline bg-panel p-4 desk:table-row desk:rounded-none desk:border-x-0 desk:border-t-0 desk:bg-tint desk:p-0";
/**
 * The failure mark is **border weight, not hue** — the Form Contract's own
 * rule, one layer out from a field: "pink is action, never failure", and a
 * field error is marked by border weight and a hi-viz band. A row cannot
 * carry a band, so it carries the weight.
 */
const ROW_FAILED_CLASS =
  "row-press flex flex-col gap-2 rounded-card border-2 border-ink bg-panel p-4 desk:table-row desk:rounded-none desk:border-x-0 desk:border-t-0 desk:bg-transparent desk:p-0";

function rowClass(isPicked: boolean, hasFailed: boolean): string {
  if (hasFailed) return ROW_FAILED_CLASS;
  return isPicked ? ROW_PICKED_CLASS : ROW_CLASS;
}

/**
 * `map` without `key`. A `Map` in state is replaced, never mutated —
 * mutating the one in state would not re-render.
 */
function without<TValue>(
  map: ReadonlyMap<string, TValue>,
  key: string,
): ReadonlyMap<string, TValue> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

/**
 * The legend is the **only** place a digit appears on this surface (round
 * 16). It is also where skip lives: skip is a key, not a slot, so there
 * is no sixth button offering to do nothing.
 */
const LEGEND: readonly { keys: string; does: string; said: string }[] = [
  {
    keys: "↑↓",
    does: "row",
    said: "Up and down arrows: move between rows.",
  },
  {
    keys: "1–5",
    does: "way cold → way warm",
    said: "1 to 5: way cold to way warm.",
  },
  { keys: "↵", does: "save & next", said: "Enter: save and go to the next." },
  { keys: "↓", does: "skip", said: "Down arrow: skip." },
  { keys: "Tab", does: "outfit", said: "Tab: outfit." },
];

/**
 * Round 55 · 237: nothing waits. The count line is `[ALL LOGGED]` in the
 * dialed text colour, then what happens next and the way on.
 */
function AllLogged(): JSX.Element {
  return (
    <div data-slot="all-logged" className="flex flex-col gap-3">
      <Bracketed className="text-dialed-text">All logged</Bracketed>
      <p className="m-0 text-lead">
        Every run has a verdict. Your next one shows up here once it&rsquo;s
        logged.
      </p>
      <Link
        to="/runs"
        className="target inline-flex items-center self-start text-body font-bold text-cold-text no-underline"
      >
        Go to your runs
      </Link>
    </div>
  );
}
