import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath } from "./source-text";

/**
 * **Every write of an entry's audience or verdict writes the copy too**
 * (D-175, design 189).
 *
 * The conditions consensus finds its entries through `run_conditions`,
 * whose band index holds only shared entries (`entry_shared`) and whose
 * judged feels-like depends on the verdict. Feed writes that half in the
 * batch that writes the entry (`entryHalfStatement`). A new statement that
 * sets `audience` or `verdict` without it would leave the copy stale: a
 * stale "not shared" quietly drops a shared kit from the consensus, and
 * nothing on screen says so. The audience is still checked live, so the
 * other direction is safe, but the verdict moves the run's band.
 *
 * So: every `insert`/`update` of `outfitEntries` that names either column
 * is counted, and its file must call `entryHalfStatement(` at least as
 * often. Moderation writes (`moderationStatus`) are not counted; the
 * consensus reads moderation live.
 */

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

const ENTRY_WRITE = /\.(?:insert|update)\(outfitEntries\)/gu;

/**
 * The statement starting at `start`: up to its `.where(` for an update, or
 * the close of its `.values({ … })` for an insert, whichever comes first.
 */
function statementAt(source: string, start: number): string {
  const rest = source.slice(start);
  const ends = [rest.indexOf(".where("), rest.indexOf("});")].filter(
    (index) => index >= 0,
  );
  return rest.slice(0, Math.min(...ends));
}

function doesSetCopiedColumns(statement: string): boolean {
  return /\b(?:audience|verdict)\b\s*[:,]/u.test(statement);
}

/**
Each file's count of entry writes that set the audience or the verdict.
*/
function copiedWrites(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [path, source] of Object.entries(production)) {
    if (isInstrumented(source)) continue;
    for (const match of source.matchAll(ENTRY_WRITE)) {
      if (!doesSetCopiedColumns(statementAt(source, match.index))) continue;
      const file = repoPath(path);
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
  }
  return counts;
}

describe("writes of an entry's audience or verdict", () => {
  it("are where the copy's writer is, and no further afield", () => {
    // The scan reached the one file that writes them, so an empty answer
    // elsewhere is not an empty scan. A new writer joins this list in the
    // PR that adds it, beside its `entryHalfStatement`.
    // Three: the kit's insert, the replayed verdict and the save.
    expect(copiedWrites()).toStrictEqual(
      new Map([["src/modules/feed/entries.ts", 3]]),
    );
  });

  it("each write the copy's entry half beside them", () => {
    for (const [file, writes] of copiedWrites()) {
      const source = Object.entries(production).find(
        ([path]) => repoPath(path) === file,
      )?.[1];
      const halves = source?.match(/\bentryHalfStatement\(/gu) ?? [];
      expect({ file, writes, halves: halves.length }).toStrictEqual({
        file,
        writes,
        halves: writes,
      });
    }
  });

  it("does not count a moderation write", () => {
    const moderation = `db.update(outfitEntries).set({ moderationStatus: "removed" }).where(x)`;
    expect(doesSetCopiedColumns(statementAt(moderation, 0))).toBe(false);
    const verdict = `db.update(outfitEntries).set({ verdict: 1 }).where(x)`;
    expect(doesSetCopiedColumns(statementAt(verdict, 0))).toBe(true);
    const audience = `db.insert(outfitEntries).values({ id, audience, });`;
    expect(doesSetCopiedColumns(statementAt(audience, 0))).toBe(true);
  });
});
