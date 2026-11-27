import { eq, getTableColumns, is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import * as authSchema from "../../src/db/schema-auth";
import * as coreSchema from "../../src/db/schema-core";
import * as opsSchema from "../../src/db/schema-ops";
import * as weatherSchema from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { purgeAccount } from "../../src/modules/account/purge/purge";
import { forgetMaker } from "../../src/modules/products";
import { forgetManualBands } from "../../src/modules/weather";

/**
 * Design 264 (design 261 ruling 7): every column in the schema that holds
 * a runner's id is cleared by the purge, or exempt with a reason. The
 * tables come from the schema files, never a list here, so a table added
 * later is checked the day it lands. `purge.test.ts` proves what the purge
 * does with a real account; this proves nothing is outside its reach.
 */

const NOW = 1_757_000_000;

type Db = ReturnType<typeof drizzle>;

/**
Each schema file with the database it lives in.
*/
const SCHEMAS: readonly { readonly db: Db; readonly schema: object }[] = [
  { db: drizzle(env.DIALED_CORE), schema: authSchema },
  { db: drizzle(env.DIALED_CORE), schema: coreSchema },
  { db: drizzle(env.DIALED_OPS), schema: opsSchema },
  { db: drizzle(env.DIALED_WEATHER), schema: weatherSchema },
];

const core = drizzle(env.DIALED_CORE);

interface Table {
  readonly db: Db;
  readonly table: SQLiteTable;
  readonly name: string;
  readonly columns: Readonly<Record<string, SQLiteColumn>>;
}

const TABLES: readonly Table[] = SCHEMAS.flatMap(({ db, schema }) =>
  Object.values(schema)
    .filter((value): value is SQLiteTable => is(value, SQLiteTable))
    .map((table) => ({
      db,
      table,
      name: getTableConfig(table).name,
      columns: getTableColumns(table),
    })),
);

/**
 * What a column named `*_id` or `*_by` holds, by its name. `runner`: a
 * runner's id. `operator`: the Desk operator who acted, whose account is a
 * runner's too. `subject`: a runner's id where the row's `subject_type`
 * can say `profile`. Otherwise, what it names instead. Every such name in
 * the schema must be here (the first test), so a new kind of id is
 * classified the day it lands rather than passing as "not a runner".
 */
const ID_NAMES: Readonly<Record<string, string>> = {
  user_id: "runner",
  follower_id: "runner",
  followee_id: "runner",
  blocker_id: "runner",
  blocked_id: "runner",
  reporter_id: "runner",
  owner_id: "runner",
  uploader_id: "runner",
  subject_owner_id: "runner",
  // `products.created_by` is the runner who first saved the product; the
  // other two are operators.
  created_by: "runner",
  actor_id: "operator",
  added_by: "operator",
  decided_by: "operator",
  resolved_by: "operator",
  counter_notice_by: "operator",
  court_action_by: "operator",
  case_closed_by: "operator",
  subject_id: "subject",
  account_id:
    "the provider's account, or the runner's own id with `user_id` beside it",
  action_id: "a moderation action",
  athlete_id: "a Strava athlete",
  brand_id: "a brand",
  claim_id: "an export build's claim",
  claimed_by: "the queue message working an import",
  code_id: "an invite code",
  entry_id: "an entry",
  garment_id: "a garment",
  garmin_activity_id: "a Garmin activity",
  item_id: "a garment",
  link_id: "what a bell row opens: a garment, or a follower (see EXEMPT)",
  message_id: "a queue message",
  moderation_action_id: "a moderation action",
  ncmec_report_id: "an NCMEC report",
  notification_id: "a bell row",
  object_id: "a Strava object",
  photo_id: "a photo",
  product_id: "a product",
  provider_id: "an auth provider",
  request_id: "an access request",
  review_id: "a review",
  run_id: "a run",
};

const HOLDS_RUNNER = new Set(["runner", "operator", "subject"]);

/**
 * Columns that hold a runner's id under another name: Better Auth's reset
 * link names the runner in `value`, and a bell row opens its follower.
 */
const NAMED_OTHERWISE = new Set([
  "verification.value",
  "notifications.link_id",
]);

/**
 * What still names the runner after their purge, and why. Exactly these
 * (the second test): a leftover missing here is a column the purge does
 * not reach, and one here the purge cleared is an exemption to delete.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "username_history.user_id":
    "the handle is never released (D-56, D-72): given up to a runner who will never exist again",
  "invite_redemptions.user_id":
    "the invite's use stays spent; its address is replaced (2b-1)",
  "reports.subject_id":
    "reports about the runner's profile are kept (SAF-3); the reports they filed are rewritten",
  "review_queue.subject_id":
    "a review of their profile is settled as removed by its runner, and kept (SAF-3)",
  "review_audit.subject_id":
    "the Desk's record of a review of their profile, kept with it (SAF-3)",
  "moderation_actions.subject_id":
    "moderation actions outlive the account as evidence (D-70)",
  "moderation_actions.subject_owner_id":
    "moderation actions outlive the account as evidence (D-70)",
  "quarantined_content.uploader_id":
    "quarantined content is preserved for a year (D-70)",
  ...Object.fromEntries(
    [
      "moderation_actions.actor_id",
      "review_audit.actor_id",
      "review_queue.resolved_by",
      "takedown_requests.resolved_by",
      "product_corrections.decided_by",
      "domain_denylist.added_by",
      "invite_codes.created_by",
      "takedown_blocks.created_by",
      "copyright_holds.counter_notice_by",
      "copyright_holds.court_action_by",
      "copyright_holds.case_closed_by",
    ].map((column) => [
      column,
      "the Desk's record of which operator acted; kept while #1055 is open",
    ]),
  ),
  "copyright_holds.owner_id":
    "a settled hold is the record of a notice and its answer; kept while #1055 is open",
  "notifications.link_id":
    "a follow's row on another bell is found through `follow_notices`, which a row seeded alone has none of; purge.test.ts's 'the follow rows on others' bells' proves it",
};

/**
 * Columns whose filler would stop the purge rather than test it. A live
 * hold keeps the runner's runs, and the purge never claims an account
 * under one (purge.test.ts's "a live copyright hold" tests), so the hold
 * seeded here is a settled one: the record `copyright_holds.owner_id`'s
 * exemption describes.
 */
const FILLED_OTHERWISE: Record<string, unknown> = {
  "copyright_holds.status": "restored",
};

/**
 * The value a column takes when it names nobody: its enum's first value,
 * or a fresh one of its type. No table carries a CHECK, so any value of
 * the right type is accepted.
 */
function filler(column: SQLiteColumn): unknown {
  switch (column.columnType) {
    case "SQLiteText": {
      return column.enumValues?.[0] ?? `${column.name}-${newUlid()}`;
    }
    case "SQLiteTextJson": {
      return {};
    }
    case "SQLiteBoolean": {
      return false;
    }
    case "SQLiteTimestamp": {
      return new Date(NOW * 1000);
    }
    default: {
      return 0;
    }
  }
}

function isIdNamed(name: string): boolean {
  return /_(id|by)$/.test(name);
}

/**
Whether this table's `subject_type` can say `profile`; an untyped one can.
*/
function canNameProfile(table: Table): boolean {
  const type = Object.values(table.columns).find(
    (column) => column.name === "subject_type",
  );
  if (type === undefined) return false;
  const values = type.enumValues;
  return values === undefined || values.includes("profile");
}

function doesReferenceUser(table: Table, column: SQLiteColumn): boolean {
  return getTableConfig(table.table).foreignKeys.some((key) => {
    const { columns, foreignTable } = key.reference();
    return (
      foreignTable === authSchema.user &&
      columns.some((own) => own.name === column.name)
    );
  });
}

function doesHoldRunner(table: Table, column: SQLiteColumn): boolean {
  if (table.table === authSchema.user) return column.name === "id";
  if (
    NAMED_OTHERWISE.has(`${table.name}.${column.name}`) ||
    doesReferenceUser(table, column)
  )
    return true;
  const holds = ID_NAMES[column.name];
  return holds === "subject"
    ? canNameProfile(table)
    : holds !== undefined && HOLDS_RUNNER.has(holds);
}

/**
The property keys of the table's columns that hold a runner's id.
*/
function runnerKeys(table: Table): string[] {
  return Object.entries(table.columns)
    .filter(([, column]) => doesHoldRunner(table, column))
    .map(([key]) => key);
}

const RUNNER_TABLES = TABLES.filter((table) => runnerKeys(table).length > 0);

/**
 * One row of `table` naming `runner` in the column at `key` only: every
 * other column that could name a runner names a stranger, so a delete by
 * another column cannot clear this one.
 */
function rowNaming(
  table: Table,
  key: string,
  runner: string,
): Record<string, unknown> {
  const others = new Set(runnerKeys(table));
  const row: Record<string, unknown> = {};
  for (const [own, column] of Object.entries(table.columns)) {
    if (own === key) row[own] = runner;
    else if (others.has(own)) row[own] = newUlid();
    else if (column.notNull && !column.hasDefault) {
      row[own] =
        FILLED_OTHERWISE[`${table.name}.${column.name}`] ?? filler(column);
    }
  }
  if (table.columns[key]?.name === "subject_id" && "subjectType" in row) {
    row.subjectType = "profile";
  }
  return row;
}

function label(table: Table, key: string): string {
  return `${table.name}.${table.columns[key]?.name ?? key}`;
}

async function seed(runner: string): Promise<string[]> {
  const failed: string[] = [];
  for (const table of RUNNER_TABLES) {
    for (const key of runnerKeys(table)) {
      try {
        await table.db
          .insert(table.table)
          .values(rowNaming(table, key, runner));
      } catch (error) {
        failed.push(`${label(table, key)}: ${String(error)}`);
      }
    }
  }
  return failed;
}

async function stillNaming(runner: string): Promise<string[]> {
  const left: string[] = [];
  for (const table of RUNNER_TABLES) {
    for (const key of runnerKeys(table)) {
      const column = table.columns[key];
      if (column === undefined) continue;
      const count = await table.db.$count(table.table, eq(column, runner));
      if (count > 0) left.push(label(table, key));
    }
  }
  return left;
}

function purge(runner: string) {
  return purgeAccount(
    {
      core,
      forgetBands: forgetManualBands,
      revokeStrava: () => Promise.resolve(),
      importsBucket: env.IMPORTS,
      report: (error) => {
        throw error;
      },
      now: NOW,
      forgetMaker,
    },
    runner,
  );
}

describe("the purge's coverage", () => {
  it("classifies every id column the schema has", () => {
    const names = TABLES.flatMap((table) =>
      Object.values(table.columns).map((column) => column.name),
    );
    const unclassified = [
      ...new Set(names.filter((name) => isIdNamed(name))),
    ].filter((name) => ID_NAMES[name] === undefined);
    expect(unclassified).toEqual([]);
    // Every name classified is one the schema still has.
    expect(
      Object.keys(ID_NAMES).filter((name) => !names.includes(name)),
    ).toEqual([]);
  });

  it("leaves a runner's id only in the columns exempt with a reason", async () => {
    const runner = newUlid();
    const failed = await seed(runner);
    await purge(runner);
    const left = await stillNaming(runner);
    const exempt = Object.keys(EXEMPT);
    expect({
      failed,
      uncovered: left.filter((column) => !exempt.includes(column)),
      cleared: exempt.filter((column) => !left.includes(column)),
    }).toEqual({ failed: [], uncovered: [], cleared: [] });
  });
});
