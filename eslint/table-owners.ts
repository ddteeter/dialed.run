/**
 * Which module writes which table (design 261, rulings 5 and 6; design
 * 263). `eslint/table-writes.ts` reads this and fails a module that calls
 * `insert`, `update` or `delete` on a table it is not listed for.
 *
 * Each table has one `owner`, which may write it any way. Every other
 * module that writes it today is listed under `others` with what it does:
 * `insert` or `delete`, or `update` with the columns its `.set()` names. A
 * column list is a column group: `safety`'s status columns on the rows it
 * moderates are its own (ruling 6), and the owner of the row keeps the
 * rest.
 *
 * The map landed listing the writers as they were (2026-11-25), right or
 * wrong. A writer a lane is moving says which lane; one that looks wrong
 * and has no lane names its issue. A move edits this file in the same pull
 * request: the old writer's line goes, and the new one's comes.
 *
 * Keys are SQL table names and columns are drizzle's property names, both
 * typed from `src/db`, so a table with no entry, an entry for no table or a
 * column the table does not have is a type error.
 */
import type { Table } from "drizzle-orm";

import type * as auth from "../src/db/schema-auth.ts";
import type * as core from "../src/db/schema-core.ts";
import type * as ops from "../src/db/schema-ops.ts";
import type * as weather from "../src/db/schema-weather.ts";

type Schema = typeof auth & typeof core & typeof ops & typeof weather;

type Tables = {
  [K in keyof Schema]: Schema[K] extends Table ? Schema[K] : never;
}[keyof Schema];

export type TableName = Tables["_"]["name"];

/**
A table's columns; for a union of tables, every column of any of them.
*/
type ColumnOf<N extends TableName> = N extends TableName
  ? keyof Extract<Tables, { _: { name: N } }>["$inferInsert"] & string
  : never;

/**
 * Where a write is made: each module under `src/modules/`, and `src/db`,
 * the one folder outside them that writes a table today (B12 moves its
 * writer to `ops`). `test/eslint/table-owners.node.test.ts` checks this
 * list against the folders both ways, so a module added or removed fails
 * until it is named here; a type cannot read folders.
 */
export const AREAS = [
  "account",
  "auth",
  "closet",
  "dispatch",
  "email",
  "enrichment",
  "feed",
  "notifications",
  "onboarding",
  "ops",
  "products",
  "runs",
  "safety",
  "src/db",
  "weather",
] as const;

export type Area = (typeof AREAS)[number];

/**
One module's writes on another's table, as the rule reads it.
*/
export interface WriterEntry {
  readonly insert?: true;
  readonly delete?: true;
  readonly update?: readonly string[];
  /**
  Why this module writes another's table, and the lane or issue that moves it.
  */
  readonly why: string;
}

/**
A table's writers, as the rule reads them.
*/
export interface OwnersEntry {
  readonly owner: Area;
  readonly others?: Readonly<Partial<Record<Area, WriterEntry>>>;
}

/**
The same, with the columns typed from table `N`.
*/
interface Writer<N extends TableName> extends WriterEntry {
  readonly update?: readonly ColumnOf<N>[];
}

interface Owners<N extends TableName> extends OwnersEntry {
  readonly others?: Readonly<Partial<Record<Area, Writer<N>>>>;
}

const purge = "the purge forgets a runner (ruling 7; design D1)";
const statusColumn = "a moderation status column on the row (ruling 6)";

/**
 * A table its owner writes and the purge deletes from, which is most of
 * the tables that name a runner.
 */
function forgottenBy(owner: Area) {
  return { owner, others: { account: { delete: true, why: purge } } } as const;
}

export const tableOwners: { readonly [N in TableName]: Owners<N> } = {
  // Better Auth's tables. Its adapter writes most of what it owns; these
  // are the writes our code makes.
  user: {
    owner: "auth",
    others: {
      account: {
        delete: true,
        update: ["email", "emailVerified", "updatedAt"],
        why: `the address change and its confirmation; ${purge}`,
      },
    },
  },
  session: {
    owner: "auth",
    others: {
      account: { delete: true, why: `the address change; ${purge}` },
      safety: { delete: true, why: "a ban ends the runner's sessions" },
    },
  },
  account: forgottenBy("auth"),
  verification: forgottenBy("auth"),
  rate_limit: { owner: "auth" },
  password_attempts: forgottenBy("auth"),

  // Account and access.
  access_asks: { owner: "account" },
  access_requests: { owner: "account" },
  account_deletions: { owner: "account" },
  closed_addresses: { owner: "account" },
  data_exports: { owner: "account" },
  email_verifications: { owner: "account" },
  invite_codes: { owner: "account" },
  invite_redemptions: { owner: "account" },
  terms_acceptances: { owner: "account" },
  username_history: { owner: "account" },
  user_profiles: {
    // No module holds the profile yet; design D2 settles one. `onboarding`
    // makes the row and writes most of its settings.
    owner: "onboarding",
    others: {
      account: {
        insert: true,
        delete: true,
        update: [
          "username",
          "usernameResetReason",
          "usernameScreen",
          "usernameScreenedAt",
        ],
        why: `the handle and its screening; the theme setting; ${purge}`,
      },
      auth: {
        update: ["d1Bookmark", "d1BookmarkAt"],
        why: "the session's read-your-writes bookmark",
      },
      safety: {
        insert: true,
        update: ["bannedAt", "banReason"],
        why: `the ban, an upsert: ${statusColumn}`,
      },
    },
  },

  // The closet and products.
  wardrobe_items: {
    owner: "closet",
    others: {
      account: { delete: true, why: purge },
      feed: {
        update: ["photoKey", "photoFingerprint", "visibility"],
        why: "a Desk Remove takes a garment's photo off; C1 moves it behind closet's door",
      },
      safety: { update: ["visibility"], why: statusColumn },
    },
  },
  brands: { owner: "products" },
  products: {
    owner: "products",
    others: {
      enrichment: {
        update: [
          "extractionStatus",
          "extractionError",
          "extractionTries",
          "sourceUrl",
        ],
        why: "enrichment's columns of the product (design 260 §5)",
      },
      safety: { update: ["status"], why: statusColumn },
    },
  },
  product_corrections: forgottenBy("products"),
  product_snapshots: { owner: "enrichment" },

  // Kits and the feed.
  outfit_entries: {
    owner: "feed",
    others: { safety: { update: ["moderationStatus"], why: statusColumn } },
  },
  outfit_entry_items: {
    owner: "feed",
    others: {
      closet: {
        delete: true,
        why: "deleting a garment no kit was shared with takes its items",
      },
    },
  },
  entry_photos: {
    owner: "feed",
    others: { safety: { update: ["screenStatus"], why: statusColumn } },
  },
  entry_tags: { owner: "feed" },
  follows: {
    owner: "feed",
    others: {
      account: { delete: true, why: purge },
      safety: { delete: true, why: "a ban or a block ends the follows" },
    },
  },
  follow_notices: forgottenBy("feed"),
  reactions: forgottenBy("feed"),
  run_conditions: {
    // Two halves (D-175, design 189): feed writes the entry's, weather the
    // run's. `test/architecture/run-conditions-writers.test.ts` holds feed's.
    owner: "feed",
    others: {
      account: { delete: true, why: purge },
      weather: {
        insert: true,
        update: [
          "feelsLikeC",
          "minFeelsLikeC",
          "maxFeelsLikeC",
          "precipClass",
          "source",
        ],
        why: "the run's half of the copy",
      },
    },
  },

  // Runs and Strava.
  runs: {
    owner: "runs",
    others: {
      feed: { delete: true, why: "deleting a run from its kit (design D5)" },
      weather: { update: ["weatherStatus"], why: "attaching an observation" },
    },
  },
  imports: {
    owner: "runs",
    others: {
      account: { delete: true, why: purge },
      feed: { delete: true, why: "deleting a run from its kit (design D5)" },
    },
  },
  processed_webhook_events: { owner: "runs" },
  reminder_email_days: forgottenBy("runs"),
  strava_connections: forgottenBy("runs"),
  strava_revocations: { owner: "runs" },

  // Weather.
  weather_observations: { owner: "weather" },
  manual_conditions: { owner: "weather" },

  // Notices and email.
  notifications: {
    owner: "notifications",
    others: {
      account: { delete: true, why: `a handle change; ${purge}` },
      feed: {
        insert: true,
        delete: true,
        update: ["body", "linkId", "createdAt"],
        why: "a kit's and a follow's notices",
      },
      runs: {
        update: ["read", "subjectId"],
        why: "a Strava reminder matched or pruned",
      },
      safety: { delete: true, why: "a ban takes the rings naming the runner" },
    },
  },
  notification_preferences: forgottenBy("email"),
  rate_limits: {
    // B12 moves the counters to `ops/limits`.
    owner: "email",
  },

  // Safety.
  blocks: forgottenBy("safety"),
  copyright_holds: { owner: "safety" },
  domain_denylist: { owner: "safety" },
  held_take_downs: forgottenBy("safety"),
  link_landings: { owner: "safety" },
  moderation_actions: { owner: "safety" },
  photo_screenings: forgottenBy("safety"),
  quarantined_content: { owner: "safety" },
  removed_fingerprints: { owner: "safety" },
  reports: {
    owner: "safety",
    others: { account: { update: ["reporterId"], why: purge } },
  },
  review_audit: { owner: "safety" },
  review_queue: {
    owner: "safety",
    others: {
      feed: { delete: true, why: "deleting a photo takes its queue rows" },
    },
  },
  takedown_blocks: { owner: "safety" },
  takedown_requests: { owner: "safety" },

  // Operations.
  outbox: {
    owner: "ops",
    others: {
      account: { delete: true, why: "a revoked invite's email" },
      runs: {
        delete: true,
        why: "a retried import's file-expiry row, which would delete the file it retries (design 275)",
      },
    },
  },
  gave_up: {
    owner: "ops",
    others: {
      "src/db": {
        insert: true,
        delete: true,
        why: "the gave-up writer; B12 moves it to `ops/gave-up`",
      },
      weather: { delete: true, why: "a run's weather settled" },
    },
  },
  cron_checkpoints: {
    owner: "ops",
    others: { dispatch: { insert: true, why: "the scheduled upkeep's steps" } },
  },
  perf_daily: { owner: "ops" },
  public_photos: { owner: "ops" },
};
