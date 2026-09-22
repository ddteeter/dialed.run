import { describe, expect, it } from "vitest";

import { verdictScale } from "../../src/lib/contracts";
import {
  actionForKey,
  rowAfterMove,
  verdictKeys,
} from "../../src/modules/runs/backlog-keys";

/**
 * DS2's keyboard — *"the reason the surface exists"*.
 *
 * It is a pure function precisely so these cases exist: a key map written
 * inside a `keydown` closure is only reachable through a rendered grid
 * with a focused row, and half of what matters here is the keys the table
 * **does not** claim.
 */
describe("the backlog's keys", () => {
  it("moves a row on the arrows, in the direction the arrow points", () => {
    expect(actionForKey("ArrowDown")).toStrictEqual({ kind: "move", by: 1 });
    expect(actionForKey("ArrowUp")).toStrictEqual({ kind: "move", by: -1 });
  });

  it("saves on Enter", () => {
    expect(actionForKey("Enter")).toStrictEqual({ kind: "save" });
  });

  it("gives 1–5 the scale in order, coldest key to coldest verdict", () => {
    // Five keys and not DS2's four (owner, 2026-09-21): a verdict saved
    // here "counts exactly like a verdict from the phone", so it gets the
    // phone's whole scale rather than a coarsened three.
    expect(
      verdictKeys.map((slot) => [slot.key, slot.value]),
    ).toStrictEqual([
      ["1", -2],
      ["2", -1],
      ["3", 0],
      ["4", 1],
      ["5", 2],
    ]);
    // …and it is the schema's scale, not a copy of it. If `verdictScale`
    // ever gains a step, this fails rather than the table silently
    // offering one fewer.
    expect(verdictKeys).toHaveLength(verdictScale.length);
    expect(verdictKeys.map((slot) => slot.label)).toStrictEqual(
      verdictScale.map((entry) => entry.label),
    );
  });

  it("carries the verdict's own word with the key", () => {
    // The action carries the label so the table can announce what it did
    // without looking the value back up — a lookup whose miss arm no
    // input can reach.
    expect(actionForKey("3")).toStrictEqual({
      kind: "verdict",
      slot: { key: "3", value: 0, label: "Dialed" },
    });
  });

  it("claims nothing else, so Tab still reaches the outfit cell", () => {
    // The one key the contract hands to the browser by name: "Tab into the
    // outfit cell opens A2 in a panel". An action here would mean
    // `preventDefault`, and the cell would be unreachable.
    for (const key of ["Tab", "Escape", "0", "6", "a", " ", "ArrowLeft"]) {
      expect([key, actionForKey(key)]).toStrictEqual([key, undefined]);
    }
  });
});

describe("where a move lands", () => {
  it("steps by one within the table", () => {
    expect(rowAfterMove(2, 1, 6)).toBe(3);
    expect(rowAfterMove(2, -1, 6)).toBe(1);
  });

  it("clamps rather than wrapping, at both ends", () => {
    // "A backlog is read top to bottom, oldest first" — a `↓` on the last
    // row that jumped back to the first would lose the runner's place in
    // the one surface whose whole job is reaching the end of a list.
    expect(rowAfterMove(5, 1, 6)).toBe(5);
    expect(rowAfterMove(0, -1, 6)).toBe(0);
  });

  it("stays at zero when there is nothing to move through", () => {
    // An empty table still has a selected index, and `count - 1` is -1.
    // Without the second clamp the selection goes negative and the rail
    // reads a row that is not there.
    expect(rowAfterMove(0, 1, 0)).toBe(0);
    expect(rowAfterMove(0, -1, 0)).toBe(0);
  });
});
