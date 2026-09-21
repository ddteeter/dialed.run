import { Link } from "@tanstack/react-router";
import type { JSX, KeyboardEvent } from "react";
import { useState } from "react";

import type { VerdictValue } from "../../../lib/contracts";
import { formatDistance, formatDuration } from "../../../lib/measures";
import type { Units } from "../../../lib/contracts";
import { formatTemp } from "../../../lib/temperature";
import { Mono, PendingLabel, WeatherAttribution } from "../../../ui";
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
 * The chosen verdict slot: pink cold, teal dialed, grey warm — *"same hue
 * meanings as T2"* — with the shape carrying it as well as the hue, since
 * the position of the filled slot differs per verdict (rule 01, colour is
 * never the only channel).
 */
const SLOT_BASE =
  "inline-flex items-center justify-center rounded-none border px-2 font-mono text-mono-sm";
const SLOT_RESTING = `${SLOT_BASE} border-hairline-2 text-muted`;
const SLOT_COLD = `${SLOT_BASE} border-action bg-action text-accent-ink`;
const SLOT_DIALED = `${SLOT_BASE} border-teal bg-teal text-accent-ink`;
const SLOT_WARM = `${SLOT_BASE} border-quiet bg-quiet text-ground`;

/**
 * Which treatment a chosen slot wears, by the sign of the verdict.
 *
 * Read from the value rather than from the key's position, so the three
 * hues stay tied to the meaning T2 gives them and not to how many keys
 * the table happens to offer.
 */
function slotClass(value: VerdictValue, isChosen: boolean): string {
  if (!isChosen) return SLOT_RESTING;
  if (value < 0) return SLOT_COLD;
  if (value > 0) return SLOT_WARM;
  return SLOT_DIALED;
}

function conditionsLine(conditions: Conditions, units: Units): string {
  return [
    formatTemp(conditions.feelsLikeC, units.temp),
    conditions.condition,
    `WIND ${String(Math.round(conditions.windKph))}`,
  ].join(" · ");
}

/**
 * "Mon 2 Sep", the way DS2 labels a row and names the kit it offers.
 *
 * `undefined` locale, so it is the reader's own — the one place this
 * screen shows a date rather than a measured value.
 */
function dayLabel(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
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
 * One verdict slot — a key, drawn.
 *
 * *"Verdict slots are the A3 mark drawn as keyboard keys."* The key's
 * digit is the label a sighted runner reads; the word is what a reader
 * hears, because "3" announces nothing about how a run felt.
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
      aria-label={`${slot.label} — ${day}, key ${slot.key}`}
      onClick={onChoose}
      // `target` at the site rather than inside `SLOT_BASE`: the 44px hit
      // area is the button's and belongs where a reviewer — and
      // `targets-and-focus`, which reads one level of constant and not a
      // function call — can see it. The treatment is what `slotClass`
      // decides.
      className={`target ${slotClass(slot.value, isChosen)}`}
    >
      {slot.key}
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
            Selected · {dayLabel(row.startedAt)}
          </Mono>
          <Mono step="lg">{conditionsLine(row.conditions, units)}</Mono>
        </div>
      )}
      <p className="m-0 bg-tint px-4 py-3 text-small text-quiet">
        Verdicts saved here count exactly like verdicts from the phone.
        There&rsquo;s no bulk rule — every row is one run.
      </p>
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
      setSaid(`Saved ${dayLabel(row.startedAt)}.`);
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
      setSaid(`Could not save ${dayLabel(row.startedAt)}. Try again.`);
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
      setSaid(`${dayLabel(row.startedAt)}: ${action.slot.label}.`);
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
              {["Run", "Conditions", "Outfit", "Verdict · 1–5"].map(
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
                    {dayLabel(row.startedAt)}
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
                        day={dayLabel(row.startedAt)}
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

const LEGEND: readonly { keys: string; does: string }[] = [
  { keys: "↑↓", does: "row" },
  { keys: "1–5", does: "verdict" },
  { keys: "↵", does: "save & next" },
  { keys: "Tab", does: "outfit" },
];
