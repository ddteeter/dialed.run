/**
 * Outfit entries: attach-the-kit (A2/A2b), the verdict (A3), and entry
 * detail (D). Authorization is enforced here, not at the route layer:
 * every mutation re-checks ownership against the database, never trusts a
 * client-supplied userId beyond the session.
 *
 * Upstream seam: `wardrobe_items` and `runs` are queried directly because
 * lanes 101/102 don't exist yet on this branch (packet-directed). When
 * they land, item/run *lookups* here should move behind their index.ts —
 * the authz *logic* (who may attach to which run, using which items)
 * stays in this module regardless.
 */
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { z } from "zod";

import {
  entryPhotos,
  entryTags as entryTagsTable,
  notifications,
  outfitEntries,
  outfitEntryItems,
  reactions,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { env } from "../../env";
import type { entryTags, itemFlagSchema } from "../../lib/contracts";
import { newUlid } from "../../lib/ids";
import { bandFloorC } from "../../lib/temperature";
import type { Conditions } from "./conditions";
import { observationsForEntries, observationsForRuns } from "./conditions";

type EntryTag = (typeof entryTags)[number];
type ItemFlag = z.infer<typeof itemFlagSchema>;

function db() {
  return drizzle(env.DIALED_CORE);
}

export class ForbiddenError extends Error {
  constructor(message = "not allowed") {
    super(message);
  }
}
export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
  }
}

export interface AttachKitInput {
  userId: string;
  runId: string;
  itemIds: readonly string[];
}

/**
 * Idempotent by design (law 1): re-submitting the same run returns the
 * existing entry instead of erroring, so a retried request never
 * double-attaches.
 */
export async function attachKit(input: AttachKitInput): Promise<string> {
  const database = db();
  const [run] = await database
    .select({ id: runs.id, userId: runs.userId })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);
  if (!run) throw new NotFoundError("run not found");
  if (run.userId !== input.userId) {
    throw new ForbiddenError("cannot attach a kit to another user's run");
  }

  const [existing] = await database
    .select({ id: outfitEntries.id, userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.runId, input.runId))
    .limit(1);
  if (existing) {
    if (existing.userId !== input.userId) {
      throw new ForbiddenError("run already has another user's entry");
    }
    // Already idempotent, and by a natural key: a run has exactly one entry
    // (UNIQUE `entries_run`), so the run id *is* the key and no column is
    // needed — task 108 requirement 1, prefer a natural key over inventing
    // one. Pinned by test/idempotency.test.ts so a refactor cannot quietly
    // drop it.
    return existing.id;
  }

  if (input.itemIds.length > 0) {
    const itemIds = [...input.itemIds];
    const owned = await database
      .select({ id: wardrobeItems.id, userId: wardrobeItems.userId })
      .from(wardrobeItems)
      .where(inArray(wardrobeItems.id, itemIds));
    const ownedIds = new Set(
      owned.filter((row) => row.userId === input.userId).map((row) => row.id),
    );
    for (const itemId of input.itemIds) {
      if (!ownedIds.has(itemId)) {
        throw new ForbiddenError("picker may only use the user's own items");
      }
    }
  }

  const [profile] = await database
    .select({ shareDefault: userProfiles.shareDefault })
    .from(userProfiles)
    .where(eq(userProfiles.userId, input.userId))
    .limit(1);

  const entryId = newUlid();
  // One batch, not two awaits: the entry and the items it contains are the
  // same fact (CLAUDE.md "default to one batch"). Two statements left a
  // kit with no garments in it if the second failed, which renders as an
  // empty entry and cannot be told from a deliberate one.
  //
  // verdict/caption are nullable-no-default columns: omitting them here
  // (rather than writing a literal null) inserts SQL NULL either way.
  const insertEntry = database.insert(outfitEntries).values({
    id: entryId,
    runId: input.runId,
    userId: input.userId,
    isPublic: profile?.shareDefault ?? true,
    createdAt: Math.floor(Date.now() / 1000),
  });
  if (input.itemIds.length === 0) {
    await insertEntry;
    return entryId;
  }
  await database.batch([
    insertEntry,
    database
      .insert(outfitEntryItems)
      .values(input.itemIds.map((itemId) => ({ entryId, itemId }))),
  ]);
  return entryId;
}

interface ItemFlagInput {
  itemId: string;
  flag?: ItemFlag | undefined;
  note?: string | undefined;
}

export interface SubmitVerdictInput {
  userId: string;
  entryId: string;
  verdict: number;
  isPublic: boolean;
  caption?: string | undefined;
  tags: readonly EntryTag[];
  itemFlags: readonly ItemFlagInput[];
}

async function assertOwnsEntry(
  entryId: string,
  userId: string,
): Promise<{ id: string; userId: string; runId: string }> {
  const [entry] = await db()
    .select({ id: outfitEntries.id, userId: outfitEntries.userId, runId: outfitEntries.runId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!entry) throw new NotFoundError("entry not found");
  if (entry.userId !== userId) {
    throw new ForbiddenError("cannot modify another user's entry");
  }
  return entry;
}

/**
 * The verdict, its tags and its per-item flags are one user action, so they
 * land as one D1 batch.
 *
 * They used to be a run of separately awaited statements, which is not a
 * transaction: a failure after the verdict update but before the tag insert
 * left an entry carrying a new verdict and the previous submission's tags,
 * with nothing to reconcile it. D1 has no interactive transactions
 * (CLAUDE.md §D1 query discipline), so `batch()` is the primitive — every
 * statement commits or none does.
 *
 * The entry's item ids still have to be read first: which flags are
 * legitimate depends on what the entry contains, and a batch cannot branch
 * on its own results.
 */
export async function submitVerdict(input: SubmitVerdictInput): Promise<void> {
  const database = db();
  await assertOwnsEntry(input.entryId, input.userId);

  const entryItemRows = await database
    .select({ itemId: outfitEntryItems.itemId })
    .from(outfitEntryItems)
    .where(eq(outfitEntryItems.entryId, input.entryId));
  const entryItemIds = new Set(entryItemRows.map((row) => row.itemId));
  const applicableFlags = input.itemFlags.filter((itemFlag) =>
    entryItemIds.has(itemFlag.itemId),
  );

  const statements = [
    database
      .update(outfitEntries)
      .set({
        verdict: input.verdict,
        isPublic: input.isPublic,
        // A clear-to-null update needs a real SQL NULL, not `undefined`
        // (drizzle drops `undefined` set-values entirely — see mapUpdateSet).
        caption: input.caption ?? sql`NULL`,
      })
      .where(eq(outfitEntries.id, input.entryId)),
    database
      .delete(entryTagsTable)
      .where(eq(entryTagsTable.entryId, input.entryId)),
    ...(input.tags.length > 0
      ? [
          database
            .insert(entryTagsTable)
            .values(
              input.tags.map((tag) => ({ entryId: input.entryId, tag })),
            ),
        ]
      : []),
    ...applicableFlags.map((itemFlag) =>
      database
        .update(outfitEntryItems)
        .set({
          flag: itemFlag.flag ?? sql`NULL`,
          note: itemFlag.note ?? sql`NULL`,
        })
        .where(
          and(
            eq(outfitEntryItems.entryId, input.entryId),
            eq(outfitEntryItems.itemId, itemFlag.itemId),
          ),
        ),
    ),
  ];

  // `batch` needs a non-empty tuple; the first two statements always exist.
  const [first, ...rest] = statements;
  if (first === undefined) return;
  await database.batch([first, ...rest]);
}

interface OwnEntryRow {
  id: string;
  runId: string;
  verdict: number | null;
}

function hasVerdict(entry: OwnEntryRow): entry is OwnEntryRow & { verdict: number } {
  return entry.verdict !== null;
}

/**
 * Distribution of the user's own past verdicts within a 5°C band —
 * calibration context shown under the A3 choices. `excludeEntryId` keeps a
 * not-yet-verdicted entry from counting itself.
 */
export async function verdictBandCounts(
  userId: string,
  targetBandFloorC: number,
  excludeEntryId?: string,
): Promise<Record<number, number>> {
  const counts: Record<number, number> = { "-2": 0, "-1": 0, "0": 0, "1": 0, "2": 0 };
  // Both filters belong in the WHERE clause, and not only to save a scan:
  // filtering after LIMIT 200 returns "the verdicted rows among the first
  // 200", not "the first 200 verdicted rows". A user whose 200 most recent
  // entries are all unverdicted got an all-zero distribution that looked
  // like real data.
  const own = await db()
    .select({
      id: outfitEntries.id,
      runId: outfitEntries.runId,
      verdict: outfitEntries.verdict,
    })
    .from(outfitEntries)
    .where(
      and(
        eq(outfitEntries.userId, userId),
        isNotNull(outfitEntries.verdict),
        excludeEntryId === undefined
          ? undefined
          : ne(outfitEntries.id, excludeEntryId),
      ),
    )
    .orderBy(desc(outfitEntries.createdAt))
    .limit(200);
  const verdicted = own.filter(hasVerdict);
  if (verdicted.length === 0) return counts;
  const observations = await observationsForEntries(db(), verdicted);
  for (const entry of verdicted) {
    const observation = observations.get(entry.runId);
    if (!observation) continue;
    if (bandFloorC(observation.feelsLikeC) !== targetBandFloorC) continue;
    counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;
  }
  return counts;
}

/**
 * "Half-zip is now 8 of 9 in 38–46°" — how often a specific item shows up
 * in the user's own entries within its band, out of entries logged in that
 * band at all.
 */
export async function itemBandWearStat(
  userId: string,
  itemId: string,
  targetBandFloorC: number,
): Promise<{ worn: number; total: number }> {
  // The band filter below genuinely cannot move into SQL: the band comes
  // from a weather observation in DIALED_WEATHER, and DIALED_CORE cannot
  // join across databases (CLAUDE.md §D1 query discipline). The ORDER BY
  // is not decorative — LIMIT without it makes "the 200 rows we looked at"
  // depend on the query plan.
  const own = await db()
    .select({ id: outfitEntries.id, runId: outfitEntries.runId })
    .from(outfitEntries)
    .where(eq(outfitEntries.userId, userId))
    .orderBy(desc(outfitEntries.createdAt))
    .limit(200);
  if (own.length === 0) return { worn: 0, total: 0 };
  const observations = await observationsForEntries(db(), own);
  const inBand = own.filter((entry) => {
    const observation = observations.get(entry.runId);
    return observation !== undefined && bandFloorC(observation.feelsLikeC) === targetBandFloorC;
  });
  if (inBand.length === 0) return { worn: 0, total: 0 };
  const inBandEntryIds = inBand.map((entry) => entry.id);
  const wearingItem = await db()
    .select({ entryId: outfitEntryItems.entryId })
    .from(outfitEntryItems)
    .where(
      and(
        eq(outfitEntryItems.itemId, itemId),
        inArray(outfitEntryItems.entryId, inBandEntryIds),
      ),
    );
  return { worn: wearingItem.length, total: inBand.length };
}

export async function shouldPromptForVerdict(
  userId: string,
  entryId: string,
): Promise<boolean> {
  const [entry] = await db()
    .select({ verdict: outfitEntries.verdict, userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!entry) return false;
  if (entry.userId !== userId || entry.verdict !== null) return false;
  const [prompted] = await db()
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.kind, "verdict_prompt"),
        eq(notifications.subjectId, entryId),
      ),
    )
    .limit(1);
  return prompted === undefined;
}

/**
 * Idempotent (UNIQUE dedupe key) — safe to call every time the prompt shows.
 */
export async function recordVerdictPrompted(
  userId: string,
  entryId: string,
): Promise<void> {
  await db()
    .insert(notifications)
    .values({
      id: newUlid(),
      userId,
      kind: "verdict_prompt",
      subjectId: entryId,
      body: "You didn't log a verdict for this run.",
      createdAt: Math.floor(Date.now() / 1000),
    })
    .onConflictDoNothing();
}

interface EntryDetailItem {
  itemId: string;
  name: string;
  brand: string | undefined;
  category: string;
  layer: string | undefined;
  flag: ItemFlag | undefined;
  note: string | undefined;
}

export interface EntryDetail {
  id: string;
  userId: string;
  authorDisplayName: string | undefined;
  runId: string;
  runTitle: string;
  distanceM: number;
  durationS: number;
  startedAt: number;
  indoor: boolean;
  verdict: number | undefined;
  isPublic: boolean;
  caption: string | undefined;
  createdAt: number;
  items: EntryDetailItem[];
  photoKeys: string[];
  tags: string[];
  usefulCount: number;
  conditions: Conditions | undefined;
}

export async function getEntryDetail(
  entryId: string,
  viewerId: string | undefined,
): Promise<EntryDetail | undefined> {
  const database = db();
  const [entry] = await database
    .select()
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId))
    .limit(1);
  if (!entry) return undefined;
  if (!entry.isPublic && entry.userId !== viewerId) return undefined;

  const [run] = await database
    .select()
    .from(runs)
    .where(eq(runs.id, entry.runId))
    .limit(1);
  if (!run) return undefined;

  const [author] = await database
    .select({ displayName: userProfiles.displayName })
    .from(userProfiles)
    .where(eq(userProfiles.userId, entry.userId))
    .limit(1);

  const entryItemRows = await database
    .select()
    .from(outfitEntryItems)
    .where(eq(outfitEntryItems.entryId, entryId));
  const itemIds = entryItemRows.map((row) => row.itemId);
  const garments =
    itemIds.length === 0
      ? []
      : await database
          .select()
          .from(wardrobeItems)
          .where(inArray(wardrobeItems.id, itemIds));
  const garmentsById = new Map(garments.map((g) => [g.id, g]));

  const photos = await database
    .select()
    .from(entryPhotos)
    .where(eq(entryPhotos.entryId, entryId))
    .orderBy(entryPhotos.position);

  const tags = await database
    .select()
    .from(entryTagsTable)
    .where(eq(entryTagsTable.entryId, entryId));

  const usefulRows = await database
    .select({ userId: reactions.userId })
    .from(reactions)
    .where(eq(reactions.entryId, entryId));

  const observations = await observationsForRuns([run]);

  // Per-item flags/notes are never public (docs/contracts.md): only the
  // entry's own owner sees them, regardless of the entry's share state.
  const isOwner = viewerId !== undefined && viewerId === entry.userId;

  return {
    id: entry.id,
    userId: entry.userId,
    authorDisplayName: author?.displayName ?? undefined,
    runId: run.id,
    runTitle: run.title,
    distanceM: run.distanceM,
    durationS: run.durationS,
    startedAt: run.startedAt,
    indoor: run.indoor,
    verdict: entry.verdict ?? undefined,
    isPublic: entry.isPublic,
    caption: entry.caption ?? undefined,
    createdAt: entry.createdAt,
    items: entryItemRows.map((row) => {
      const garment = garmentsById.get(row.itemId);
      return {
        itemId: row.itemId,
        name: garment?.name ?? "[removed item]",
        brand: garment?.brand ?? undefined,
        category: garment?.category ?? "accessory",
        layer: garment?.layer ?? undefined,
        flag: isOwner ? row.flag ?? undefined : undefined,
        note: isOwner ? row.note ?? undefined : undefined,
      };
    }),
    photoKeys: photos.map((p) => p.photoKey),
    tags: tags.map((t) => t.tag),
    usefulCount: usefulRows.length,
    conditions: observations.get(run.id),
  };
}
