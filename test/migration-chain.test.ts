import { describe, expect, it } from "vitest";

/**
 * The migrations directory is the one resource no lane owns, and a merge is
 * where it breaks. Four branches numbered their migrations from 0002
 * independently, so merging them produced duplicate journal indexes and a
 * snapshot chain that forked three ways off 0001.
 *
 * None of that failed a test. Applying the migrations still worked, because
 * `wrangler d1 migrations apply` reads filenames and the journal, and the
 * SQL happened to touch disjoint tables. What broke was `drizzle-kit
 * generate`, which walks `prevId` and refuses to run at all:
 *
 *   Error: [0003_snapshot.json, 0004_snapshot.json, 0010_snapshot.json] are
 *   pointing to a parent snapshot: ... which is a collision.
 *
 * So the damage landed on the next lane to touch the schema, not on any of
 * the ones that caused it. Same idea as `bindings-conformance`: the artifact
 * is generated and then hand-merged, so something has to check it is still
 * coherent afterwards.
 *
 * Inlined by Vite at build time via `?raw` — the workers pool sandboxes the
 * real filesystem, so `readFileSync` cannot reach these files.
 */

const coreJournal: Record<string, string> = import.meta.glob(
  "../src/db/migrations/core/meta/_journal.json",
  { query: "?raw", import: "default", eager: true },
);

const weatherJournal: Record<string, string> = import.meta.glob(
  "../src/db/migrations/weather/meta/_journal.json",
  { query: "?raw", import: "default", eager: true },
);

const coreSnapshots: Record<string, string> = import.meta.glob(
  "../src/db/migrations/core/meta/[0-9]*_snapshot.json",
  { query: "?raw", import: "default", eager: true },
);

const weatherSnapshots: Record<string, string> = import.meta.glob(
  "../src/db/migrations/weather/meta/[0-9]*_snapshot.json",
  { query: "?raw", import: "default", eager: true },
);

const coreSql: Record<string, string> = import.meta.glob(
  "../src/db/migrations/core/*.sql",
  { query: "?raw", import: "default", eager: true },
);

const weatherSql: Record<string, string> = import.meta.glob(
  "../src/db/migrations/weather/*.sql",
  { query: "?raw", import: "default", eager: true },
);

const ROOT_PREV_ID = "00000000-0000-0000-0000-000000000000";

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Snapshot {
  id: string;
  prevId: string;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function parseJournal(
  files: Record<string, string>,
  label: string,
): JournalEntry[] {
  const raw = Object.values(files)[0];
  if (raw === undefined) throw new Error(`no _journal.json found for ${label}`);
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("entries" in parsed) ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(`${label} journal has no entries array`);
  }
  return parsed.entries.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("idx" in entry) ||
      !("tag" in entry) ||
      typeof entry.idx !== "number" ||
      typeof entry.tag !== "string"
    ) {
      throw new Error(`${label} journal entry is not {idx, tag}`);
    }
    return { idx: entry.idx, tag: entry.tag };
  });
}

/**
Snapshots by their filename's numeric prefix, e.g. "0004".
*/
function snapshotsByPrefix(
  files: Record<string, string>,
  label: string,
): Map<string, Snapshot> {
  const byPrefix = new Map<string, Snapshot>();
  for (const [path, raw] of Object.entries(files)) {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("id" in parsed) ||
      !("prevId" in parsed) ||
      typeof parsed.id !== "string" ||
      typeof parsed.prevId !== "string"
    ) {
      throw new Error(`${label} snapshot ${path} has no id/prevId`);
    }
    const prefix = basename(path).split("_", 1)[0];
    if (prefix === undefined) throw new Error(`unparseable snapshot ${path}`);
    byPrefix.set(prefix, { id: parsed.id, prevId: parsed.prevId });
  }
  return byPrefix;
}

describe.each([
  { name: "core", journal: coreJournal, snapshots: coreSnapshots, sql: coreSql },
  {
    name: "weather",
    journal: weatherJournal,
    snapshots: weatherSnapshots,
    sql: weatherSql,
  },
])("$name migrations", ({ name, journal, snapshots, sql }) => {
  it("journal indexes are 0..n with no gaps or duplicates", () => {
    const entries = parseJournal(journal, name);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.idx)).toEqual(
      entries.map((_, index) => index),
    );
  });

  it("each tag is prefixed with its own index", () => {
    // drizzle applies in journal order; a human scanning the directory
    // assumes filename order. Pinning the prefix to the index is what stops
    // those two from disagreeing after a renumber.
    const entries = parseJournal(journal, name);
    for (const entry of entries) {
      expect(entry.tag.startsWith(`${String(entry.idx).padStart(4, "0")}_`)).toBe(
        true,
      );
    }
  });

  it("every journal tag has a .sql file, and vice versa", () => {
    // The failure this catches is two branches both writing `0002_*.sql`:
    // one filename survives the merge and the other tag dangles, or the
    // journal keeps an entry with no file behind it.
    const entries = parseJournal(journal, name);
    const tags = new Set(entries.map((entry) => entry.tag));
    const files = new Set(
      Object.keys(sql).map((path) => basename(path).replace(/\.sql$/, "")),
    );
    expect([...tags].filter((tag) => !files.has(tag))).toEqual([]);
    expect([...files].filter((file) => !tags.has(file))).toEqual([]);
  });

  it("snapshots form one unbroken chain in journal order", () => {
    // The actual merge break: 0003, 0004 and 0010 each claimed 0001 as their
    // parent, because every branch generated against a base that did not
    // include the others. drizzle-kit refuses to run against a fork.
    //
    // Hand-written data migrations have no snapshot (the brand seed is one),
    // so the chain is over the snapshots that exist, walked in journal order.
    const entries = parseJournal(journal, name);
    const byPrefix = snapshotsByPrefix(snapshots, name);

    let previousId = ROOT_PREV_ID;
    const seen = new Set<string>();
    for (const entry of entries) {
      const snapshot = byPrefix.get(String(entry.idx).padStart(4, "0"));
      if (snapshot === undefined) continue;
      expect(`${entry.tag} -> ${snapshot.prevId}`).toBe(
        `${entry.tag} -> ${previousId}`,
      );
      expect(seen.has(snapshot.id)).toBe(false);
      seen.add(snapshot.id);
      previousId = snapshot.id;
    }
    expect(seen.size).toBe(byPrefix.size);
  });
});
