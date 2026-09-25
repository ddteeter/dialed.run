import { Link, useRouter } from "@tanstack/react-router";
import type { JSX, KeyboardEvent } from "react";
import { Fragment, useState } from "react";

import type { VerdictValue } from "../../../lib/contracts";
import {
  formatDistance,
  formatDuration,
  formatWind,
} from "../../../lib/measures";
import type { Units } from "../../../lib/contracts";
import { dayLabel } from "../../../lib/dates";
import { formatTemp } from "../../../lib/temperature";
import {
  Bracketed,
  classifyFailure,
  ControlFailureBand,
  Mono,
  PendingLabel,
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
 * key. Its *colour* is not DS2's to choose — see `ui/verdictHue`, which A3
 * reads too, so the two mirrored surfaces cannot drift apart (round 19).
 */
const SLOT_BASE =
  "inline-flex flex-col items-center justify-center rounded-none border px-2 text-center font-mono text-mono-xs";
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
 * The day a row's run happened, where it happened (D-96).
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
function conditionsLine(conditions: Conditions, units: Units): string {
  return [
    formatTemp(conditions.tempC, units.temp),
    conditions.condition,
    formatWind(conditions.windKph, units.distance),
  ].join(" · ");
}

/**
 * A kit as the row draws it: its pieces as chips, read-only.
 *
 * An entry saved with nothing on it says so in words, rather than leaving
 * an empty cell that reads as a failed load.
 */
function KitChips({ kit }: Readonly<{ kit: BacklogKit }>): JSX.Element {
  if (kit.itemNames.length === 0) {
    return <span className="text-small text-quiet">No kit on this run</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {kit.itemNames.map((name) => (
        <Mono
          key={name}
          step="xs"
          className="rounded-pill border border-ink px-2 py-1"
        >
          {name}
        </Mono>
      ))}
    </div>
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
  suggestion,
  chosen,
  onUse,
}: Readonly<{
  runId: string;
  suggestion: BacklogSuggestion | undefined;
  chosen: BacklogKit | undefined;
  onUse: (kit: BacklogSuggestion) => void;
}>): JSX.Element {
  if (chosen !== undefined) return <KitChips kit={chosen} />;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Round 20: "Same as …?" offers the nearest kit; with nothing near
          enough the cell says so — "No usual kit here · Pick" — rather
          than leaving Pick on its own to explain itself. */}
      {suggestion === undefined ? (
        <span className="text-small text-quiet">No usual kit here ·</span>
      ) : (
        <>
          <span className="text-small text-quiet">
            Same as {dayLabel(suggestion.wornAt)}?
          </span>
          <button
            type="button"
            onClick={() => {
              onUse(suggestion);
            }}
            className="target inline-flex items-center px-2 text-body font-semibold text-cold-text"
          >
            Use
          </button>
        </>
      )}
      <Link
        to="/feed/attach/$runId"
        params={{ runId }}
        className="target inline-flex items-center px-2 text-body font-semibold text-cold-text"
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

/**
 * The rail — DS2's second column, and the reason Closet and this are the
 * only two screens that get one in v1.
 */
function BacklogRail({
  row,
  units,
}: Readonly<{ row: BacklogRow; units: Units }>): JSX.Element {
  return (
    <aside
      data-slot="backlog-rail"
      className="flex flex-col gap-4 desk:sticky desk:top-6"
    >
      {
        <div className="flex flex-col gap-3 rounded-card border border-hairline bg-panel p-4">
          <Mono step="xs" className="text-muted">
            Selected · {runDay(row)}
          </Mono>
          {/* Round 22, item 18: a row with no conditions keeps the card
              and says so — "No weather on this run." — and the verdict is
              still allowed. */}
          {row.conditions === undefined ? (
            <p className="m-0 text-body">No weather on this run.</p>
          ) : (
            <Mono step="lg">{conditionsLine(row.conditions, units)}</Mono>
          )}
        </div>
      }
      {/* The rail had a paragraph here — "Verdicts saved here count
          exactly like verdicts from the phone…" — which is a *note* on the
          Desktop Contract (`data-annotation`), design explaining the table
          to its builders. It was never copy for a runner. What the board
          draws in its place is the selected run's history and the kit
          they usually wear there; that is drift recorded in the
          2026-09-22 reconciliation report, and
          `test/architecture/annotations-are-not-copy.test.ts` stops the
          next note shipping as copy. */}
      <WeatherAttribution />
    </aside>
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
    event: KeyboardEvent<HTMLTableSectionElement>,
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
    <div className="mx-auto flex w-full max-w-panel flex-col gap-6 px-6 py-8 desk:mx-0 desk:grid desk:max-w-page desk:grid-cols-[1.55fr_1fr] desk:items-start desk:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="m-0 font-display text-title uppercase">
            Needs a verdict
          </h1>
          {current === undefined ? undefined : (
            <Mono step="sm" className="text-muted">
              {rows.length} runs · oldest first
            </Mono>
          )}
        </div>

        {current === undefined ? (
          <Bracketed>All logged</Bracketed>
        ) : (
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
        )}

        {/* Rule 07: one live region per screen, and this is the screen's.
            Everything the keyboard does says so here — a table driven by
            keys with nothing announcing them is a table only a sighted
            runner can clear. */}
        <p role="status" className="m-0 text-small text-quiet">
          <PendingLabel
            label={said}
            pendingLabel="Saving"
            pending={saving !== undefined}
          />
        </p>
      </div>

      {current === undefined ? undefined : (
        <BacklogRail row={current} units={units} />
      )}
    </div>
  );
}

/**
 * A row's place in the layout below the desk threshold.
 *
 * **Between 720 and 1039 there is no table** (round 22, item 18): *"A3,
 * one at a time, in the panel."* So below `desk` only the selected row is
 * drawn, its cells stacked as A3's are, and the rest wait their turn;
 * from `desk` up every row is a table row again. One set of markup, two
 * layouts — the server cannot know the width, and two copies of a row
 * would be two answers to "what is this run's verdict".
 */
const ROW_HERE = "flex flex-col gap-3 py-3 desk:table-row desk:py-0";
const ROW_WAITING = "hidden desk:table-row";

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
  onKeyDown: (event: KeyboardEvent<HTMLTableSectionElement>) => void;
}

/**
 * The table, its keys, and the count beneath it — everything DS2 draws
 * while there is something left to log.
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
            {["Run", "Conditions", "Outfit", "Did it work?"].map((heading) => (
              <th key={heading} scope="col" className="px-2 pb-2">
                <Mono step="xs" className="text-muted">
                  {heading}
                </Mono>
              </th>
            ))}
          </tr>
        </thead>
        {/* The keys live on the body rather than on each row: `↑`/`↓`
            move between rows, so the handler has to outlive the row that
            had focus when it was pressed. */}
        <tbody onKeyDown={onKeyDown} className="block desk:table-row-group">
          {rows.map((row, index) => {
            const failure = failures.get(row.runId);
            const isHere = index === selected;
            return (
              <Fragment key={row.runId}>
                <tr
                  // Roving focus: one row is in the tab order and the
                  // arrows move which. A table of fifty rows that put every
                  // row in the sequence would be fifty tab stops before the
                  // rail.
                  tabIndex={isHere ? 0 : -1}
                  aria-current={isHere ? "true" : undefined}
                  data-saved={saved.has(row.runId) ? "true" : undefined}
                  data-failed={failure === undefined ? undefined : "true"}
                  onFocus={() => {
                    onSelect(index);
                  }}
                  className={`${rowClass(saved.has(row.runId), failure !== undefined)} ${isHere ? ROW_HERE : ROW_WAITING}`}
                >
                  <td className="block px-2 py-2 desk:table-cell">
                    <span className="block text-body font-semibold">
                      {runDay(row)}
                    </span>
                    <Mono step="sm" className="text-muted">
                      {formatDuration(row.durationS)} ·{" "}
                      {formatDistance(row.distanceM, units.distance)}
                    </Mono>
                  </td>
                  <td className="block px-2 py-2 desk:table-cell">
                    <Mono step="sm" className="text-quiet">
                      {row.conditions === undefined
                        ? "No conditions"
                        : conditionsLine(row.conditions, units)}
                    </Mono>
                  </td>
                  <td className="block px-2 py-2 desk:table-cell">
                    <OutfitCell
                      runId={row.runId}
                      suggestion={row.suggestion}
                      chosen={kitOf(row)}
                      onUse={(kit) => {
                        onUse(row, kit);
                      }}
                    />
                  </td>
                  <td className="block px-2 py-2 desk:table-cell">
                    {/* `aria-pressed`, not a `radiogroup`, and for a
                        sharper reason than A3's: the arrow keys here move
                        between *rows*, so a group promising arrow-key
                        selection would be a promise the table cannot keep.
                        A3 reached the same answer from the other side
                        (D-84), and one answer to "what is a verdict
                        control" is the point. */}
                    <div className="flex gap-1">
                      {verdictKeys.map((slot) => (
                        <VerdictSlotButton
                          key={slot.key}
                          slot={slot}
                          day={runDay(row)}
                          isChosen={verdicts.get(row.runId) === slot.value}
                          onChoose={() => {
                            onChoose(row, slot.value);
                          }}
                        />
                      ))}
                    </div>
                    {/* Below the desk there is no Enter to press and no
                        arrow to move with: A3's own verb, and a way on. */}
                    <div className="mt-3 flex gap-2 desk:hidden">
                      <button
                        type="button"
                        onClick={() => {
                          onSave(row);
                        }}
                        className="target flex-1 rounded-card border-none bg-action px-4 font-display text-body uppercase text-ink"
                      >
                        Log it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(rowAfterMove(selected, 1, rows.length));
                        }}
                        className="target rounded-card border border-hairline bg-transparent px-4 text-body font-semibold"
                      >
                        Skip
                      </button>
                    </div>
                  </td>
                </tr>
                {failure === undefined ? undefined : (
                  // The band spans the row it is about, directly under it.
                  <tr
                    data-slot="row-failure"
                    className={isHere ? "block desk:table-row" : ROW_WAITING}
                  >
                    <td colSpan={4} className="block px-2 pb-3 desk:table-cell">
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
          {LEGEND.map(({ keys, does }) => (
            <span key={does} className="flex items-center gap-2 text-small">
              <Mono step="sm" className="border border-hairline-2 px-2 py-1">
                {keys}
              </Mono>
              {does}
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
const ROW_CLASS = "row-press border-b border-hairline";
const ROW_SAVED_CLASS = "row-press border-b border-hairline bg-tint";
/**
 * The failure mark is **border weight, not hue** — the Form Contract's own
 * rule, one layer out from a field: "pink is action, never failure", and a
 * field error is marked by border weight and a hi-viz band. A row cannot
 * carry a band, so it carries the weight.
 */
const ROW_FAILED_CLASS = "row-press border-b-2 border-ink";

function rowClass(isSaved: boolean, hasFailed: boolean): string {
  if (hasFailed) return ROW_FAILED_CLASS;
  return isSaved ? ROW_SAVED_CLASS : ROW_CLASS;
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
const LEGEND: readonly { keys: string; does: string }[] = [
  { keys: "↑↓", does: "row" },
  { keys: "1–5", does: "way cold → way warm" },
  { keys: "↵", does: "save & next" },
  { keys: "↓", does: "skip" },
  { keys: "Tab", does: "outfit" },
];
