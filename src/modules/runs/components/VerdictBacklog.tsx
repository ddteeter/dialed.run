import { Link } from "@tanstack/react-router";
import type { JSX, KeyboardEvent } from "react";
import { useState } from "react";

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
  Mono,
  PendingLabel,
  verdictHue,
  WeatherAttribution,
} from "../../../ui";
import type { BacklogRow, BacklogSuggestion, Conditions } from "../../feed";
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
 * The outfit cell: the kit this row will save, or the offer of one.
 *
 * *"Same as Monday? Use · Pick"* — and `Pick` is A2 at its own route,
 * which at width is the centred panel. That is the whole of "editing an
 * outfit still opens A2 in the panel": no picker is rebuilt here.
 */
function OutfitCell({
  runId,
  suggestion,
  chosen,
  onUse,
}: Readonly<{
  runId: string;
  suggestion: BacklogSuggestion | undefined;
  chosen: BacklogSuggestion | undefined;
  onUse: (kit: BacklogSuggestion) => void;
}>): JSX.Element {
  if (chosen !== undefined) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {chosen.itemNames.map((name) => (
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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestion === undefined ? undefined : (
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
}: Readonly<{ row: BacklogRow | undefined; units: Units }>): JSX.Element {
  return (
    <aside
      data-slot="backlog-rail"
      className="flex flex-col gap-4 desk:sticky desk:top-6"
    >
      {row?.conditions === undefined ? undefined : (
        <div className="flex flex-col gap-3 rounded-card border border-hairline bg-panel p-4">
          <Mono step="xs" className="text-muted">
            Selected · {runDay(row)}
          </Mono>
          <Mono step="lg">{conditionsLine(row.conditions, units)}</Mono>
        </div>
      )}
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
  const [kits, setKits] = useState<ReadonlyMap<string, BacklogSuggestion>>(
    new Map(),
  );
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<string | undefined>();
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState("");

  function use(row: BacklogRow, kit: BacklogSuggestion): void {
    setKits(new Map(kits).set(row.runId, kit));
  }

  function choose(row: BacklogRow, value: VerdictValue): void {
    setVerdicts(new Map(verdicts).set(row.runId, value));
  }

  async function save(row: BacklogRow): Promise<void> {
    const verdict = verdicts.get(row.runId);
    const kit = kits.get(row.runId);
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
    // A retry starts clean: leaving last attempt's mark on a row that is
    // being saved again would say "this failed" about something still in
    // flight.
    setFailed(without(failed, row.runId));
    setSaving(row.runId);
    try {
      await saveRow({
        data: { runId: row.runId, itemIds: [...kit.itemIds], verdict },
      });
      setSaved(new Set(saved).add(row.runId));
      setSaid(`Saved ${runDay(row)}.`);
      setSelected(rowAfterMove(selected, 1, rows.length));
    } catch {
      // Law 5, and round 4's §AF: "the control that did the thing says
      // what happened, **in its own place**". So the failure is marked on
      // the row as well as announced — a table where the only sign is a
      // line at the foot leaves a runner clearing a queue with no idea
      // which of fifty rows did not land. The row keeps its kit and its
      // verdict, so Enter tries again.
      //
      // Nothing animates: the failure path is static (task 114's
      // `failure-path-is-static` test says so for the form components,
      // and the rule is the doctrine's, not that file's).
      setFailed(new Set(failed).add(row.runId));
      setSaid(`Could not save ${runDay(row)}. Try again.`);
    } finally {
      setSaving(undefined);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>): void {
    const row = rows[selected];
    const action = actionForKey(event.key);
    // A key the table does not claim stays the browser's — Tab above all,
    // which is how the outfit cell is reached at all.
    if (action === undefined || row === undefined) return;
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

  return (
    <div className="flex flex-col gap-6 px-6 py-8 desk:grid desk:grid-cols-[1.55fr_1fr] desk:items-start desk:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="m-0 font-display text-title uppercase">
            Needs a verdict
          </h1>
          <Mono step="sm" className="text-muted">
            {rows.length} runs · oldest first
          </Mono>
        </div>

        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-hairline">
              {["Run", "Conditions", "Outfit", "Did it work?"].map(
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
          {/* The keys live on the body rather than on each row: `↑`/`↓`
              move between rows, so the handler has to outlive the row that
              had focus when it was pressed. */}
          <tbody onKeyDown={onKeyDown}>
            {rows.map((row, index) => (
              <tr
                key={row.runId}
                // Roving focus: one row is in the tab order and the arrows
                // move which. A table of fifty rows that put every row in
                // the sequence would be fifty tab stops before the rail.
                tabIndex={index === selected ? 0 : -1}
                aria-current={index === selected ? "true" : undefined}
                data-saved={saved.has(row.runId) ? "true" : undefined}
                data-failed={failed.has(row.runId) ? "true" : undefined}
                onFocus={() => {
                  setSelected(index);
                }}
                className={rowClass(saved.has(row.runId), failed.has(row.runId))}
              >
                <td className="px-2 py-2">
                  <span className="block text-body font-semibold">
                    {runDay(row)}
                  </span>
                  <Mono step="sm" className="text-muted">
                    {formatDuration(row.durationS)} ·{" "}
                    {formatDistance(row.distanceM, units.distance)}
                  </Mono>
                </td>
                <td className="px-2 py-2">
                  <Mono step="sm" className="text-quiet">
                    {row.conditions === undefined
                      ? "No conditions"
                      : conditionsLine(row.conditions, units)}
                  </Mono>
                </td>
                <td className="px-2 py-2">
                  <OutfitCell
                    runId={row.runId}
                    suggestion={row.suggestion}
                    chosen={kits.get(row.runId)}
                    onUse={(kit) => {
                      use(row, kit);
                    }}
                  />
                </td>
                <td className="px-2 py-2">
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
                          choose(row, slot.value);
                        }}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap items-center gap-4">
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
          <Mono step="sm" className="ml-auto text-muted">
            {saved.size} of {rows.length} saved
          </Mono>
        </div>

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

      <BacklogRail row={rows[selected]} units={units} />
    </div>
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
 * `set` without `key`. A `Set` has no non-mutating delete, and mutating
 * the one in state would not re-render.
 */
function without(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
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
