import { describe, expect, it } from "vitest";

import deferred from "../../docs/deferred.md?raw";

/**
 * `docs/deferred.md` was frozen on 2026-11-06 (design 181): open work is a
 * GitHub issue now, and the register is an archive whose R-ids code still
 * cites. These pin the freeze, so "add a deferred row" fails loudly instead
 * of quietly reviving a second tracker.
 */

/**
The highest R-id on the day of the freeze.
*/
const LAST_R_ID = 190;

interface Row {
  readonly id: number;
  /**
  What follows " → " in the id cell, for a row open at the freeze.
  */
  readonly target: string | undefined;
}

const idCell = /^(?:~~)?R-(\d+)(?:~~)?$/;

/**
A register row's id cell: `| R-74 → #358 |`, `| ~~R-3~~ |`.
*/
function rowOf(line: string): Row | undefined {
  if (!line.startsWith("|")) return undefined;
  const cell = line.split("|", 2)[1] ?? "";
  const [idPart = "", target] = cell.trim().split(" → ", 2);
  const id = idCell.exec(idPart)?.[1];
  return id === undefined ? undefined : { id: Number(id), target };
}

const rows = deferred
  .split("\n")
  .map((line) => rowOf(line))
  .filter((row) => row !== undefined);

describe("docs/deferred.md is frozen", () => {
  it("has no R-id after the freeze's last", () => {
    const ids = rows.map((row) => row.id);
    expect(ids.length).toBeGreaterThan(100);
    expect(Math.max(...ids)).toBe(LAST_R_ID);
  });

  it("points every row it marks open at the issue or Project item that carries it", () => {
    const targets = rows.map((row) => row.target).filter((target) => target !== undefined);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target).toMatch(/^#\d+$|^the Project \(private until fixed\)$/);
    }
  });

  it("says where open work went", () => {
    expect(deferred).toContain("Frozen on 2026-11-06 (design 181)");
    expect(deferred).toContain("https://github.com/users/ddteeter/projects/2");
  });
});
