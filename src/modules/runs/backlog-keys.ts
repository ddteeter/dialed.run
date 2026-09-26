import { verdictScale, type VerdictValue } from "../../lib/contracts";

/**
 * DS2's keyboard, as a pure function.
 *
 * *"Keyboard, and this is the reason the surface exists: ↑/↓ moves rows,
 * 1–5 sets the verdict, Enter saves, Tab into the outfit cell opens A2 in
 * a panel."* Tab is the browser's and appears nowhere here — the outfit
 * cell holds real links, so tabbing to them is what already happens.
 *
 * It is a function rather than a `switch` inside the handler because the
 * keyboard *is* the feature: a table that beats six sheets does so on the
 * keys, and a key map written inside a `keydown` closure is only reachable
 * through a rendered grid with a focused row.
 */
export type BacklogAction =
  | { kind: "move"; by: number }
  | { kind: "verdict"; slot: VerdictSlot }
  | { kind: "save" };

/**
 * One key and the verdict it sets, with the word the scale gives it.
 *
 * The label travels with the action so the table can announce what it
 * just did without looking the value back up — a lookup whose miss arm no
 * input can reach, which is a mutant nothing can kill.
 */
export interface VerdictSlot {
  key: string;
  value: VerdictValue;
  label: string;
}

/**
 * `1`–`5` in the order T2 draws the scale — coldest key, coldest verdict.
 *
 * Derived from `verdictScale` rather than written out: the scale is the
 * schema's own five values and a second list here would be a rival truth
 * that nothing makes disagree loudly. Five and not DS2's original four is
 * the owner's call of 2026-09-21, which round 16 then drew.
 *
 * **The digits are shortcuts, never labels.** Round 16: *"the row shows
 * A3's five words, never the digits — digits are keyboard shortcuts, not
 * labels (Flow Map: 'no numeric scores in the UI')."* So `key` is what a
 * runner presses and `label` is what the slot says, and the legend is the
 * only place the two are shown together. Skip is `↓`, a key and not a
 * slot.
 */
export const verdictKeys: readonly VerdictSlot[] = verdictScale.map(
  (entry, index) => ({
    key: String(index + 1),
    value: entry.value,
    label: entry.label,
  }),
);

const VERDICT_KEYS: ReadonlyMap<string, VerdictSlot> = new Map(
  verdictKeys.map((slot) => [slot.key, slot]),
);

/**
 * What this key does, or nothing when the table does not claim it.
 *
 * Returning `undefined` rather than a no-op action is what lets the
 * handler decide whether to call `preventDefault` — a key the table does
 * not claim has to stay the browser's, or Tab stops reaching the outfit
 * cell that the same contract sentence requires.
 */
export function actionForKey(key: string): BacklogAction | undefined {
  if (key === "ArrowDown") return { kind: "move", by: 1 };
  if (key === "ArrowUp") return { kind: "move", by: -1 };
  if (key === "Enter") return { kind: "save" };
  const slot = VERDICT_KEYS.get(key);
  return slot === undefined ? undefined : { kind: "verdict", slot };
}

/**
 * The row `by` steps from `from`, clamped to the table.
 *
 * Clamped rather than wrapping: a backlog is read top to bottom, oldest
 * first, and a `↓` on the last row that jumped back to the first would
 * lose the runner's place in the one surface whose whole job is getting
 * to the end of a list.
 */
export function rowAfterMove(from: number, by: number, count: number): number {
  return Math.min(Math.max(from + by, 0), Math.max(count - 1, 0));
}
