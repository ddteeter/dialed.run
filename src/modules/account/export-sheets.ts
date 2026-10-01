/**
 * The export ZIP's five sheets themselves — one column table each (task
 * 126, ACC-10; round 27 #13), kept apart from the behaviour that resolves
 * photos, formats times and builds each sheet's rows (`./export-files`),
 * and from the CSV/README rendering (`./export-format`).
 *
 * Split out for the same reason `db/schema-*.ts` and
 * `modules/closet/tap-list-data.ts` are (CLAUDE.md, `.fallowrc.jsonc`): a
 * table's rows all share the shape `{ name, about, value }`, so a semantic
 * clone detector reads a run of one sheet's columns as a duplicate of
 * another sheet's run regardless of which fields each actually names.
 * Moving the table here lets `.fallowrc.jsonc` ignore this file without
 * also blinding itself to `export-files.ts`'s real behaviour.
 *
 * **So every column here is a plain field read** of a row `export-files`
 * built — no lookup, no conversion, no branch. Anything that decides a
 * value belongs on the row-building step, where the clone check still
 * reads it.
 *
 * **Every column is written once**, as a name, a sentence and a value, and
 * both the CSV and the README are read from that one table — so a column
 * the CSV gains is a column the README names.
 */
import type { ExportData } from "./export";
import type { Sheet } from "./export-format";

type Garment = ExportData["garments"][number];
type Run = ExportData["runs"][number];
type Entry = ExportData["entries"][number];
type KitRow = Entry["kit"][number];

/**
 * `profile.csv`'s one row: the account's address and the day it was made
 * (UTC, already written out), and the profile as stored. Either is absent
 * for an account that is gone or never finished onboarding.
 */
export interface ProfileRow {
  readonly account:
    { readonly email: string; readonly joinedAt: string } | undefined;
  readonly profile: ExportData["profile"];
}

/**
A run, its start written out (UTC), and the file it was imported from.
*/
export type RunRow = Omit<Run, "startedAt"> & {
  readonly startedAt: string;
  readonly runFile: string | undefined;
};

/**
An entry, with its tags and photo names as cells and its time written out.
*/
export type EntryRow = Omit<Entry, "tags" | "photos" | "createdAt"> & {
  readonly tags: string;
  readonly photos: string;
  readonly createdAt: string;
};

/**
A garment, its time written out, and its photo's name inside the ZIP.
*/
export type GarmentRow = Omit<Garment, "createdAt"> & {
  readonly createdAt: string;
  readonly photo: string | undefined;
};

/**
Every sheet's rows, as `export-files` builds them.
*/
export interface ExportRows {
  readonly profile: ProfileRow;
  readonly runs: readonly RunRow[];
  readonly entries: readonly EntryRow[];
  readonly kit: readonly KitRow[];
  readonly garments: readonly GarmentRow[];
}

interface ExportSheets {
  readonly profileSheet: Sheet<ProfileRow>;
  readonly runsSheet: Sheet<RunRow>;
  readonly entriesSheet: Sheet<EntryRow>;
  readonly kitSheet: Sheet<KitRow>;
  readonly garmentsSheet: Sheet<GarmentRow>;
}

export function buildSheets(rows: ExportRows): ExportSheets {
  const profileSheet: Sheet<ProfileRow> = {
    file: "profile.csv",
    about: "your account and settings, one row.",
    rows: [rows.profile],
    columns: [
      {
        name: "email",
        about: "the address you log in with.",
        value: (row) => row.account?.email,
      },
      {
        name: "joined_at",
        about: "when you made the account (UTC).",
        value: (row) => row.account?.joinedAt,
      },
      {
        name: "username",
        about: "your handle, without the @.",
        value: (row) => row.profile?.username,
      },
      {
        name: "place",
        about: "the place your conditions are read for.",
        value: (row) => row.profile?.cityLabel,
      },
      {
        name: "thermal_level",
        about: "your calibration: how warm or cold you run, from -2 to +2.",
        value: (row) => row.profile?.thermalLevel,
      },
      {
        name: "temp_unit",
        about: "f or c.",
        value: (row) => row.profile?.tempUnit,
      },
      {
        name: "distance_unit",
        about: "mi or km.",
        value: (row) => row.profile?.distanceUnit,
      },
      {
        name: "share_new_runs",
        about: "whether a new kit is shared by default.",
        value: (row) => row.profile?.shareDefault,
      },
    ],
  };

  const runsSheet: Sheet<RunRow> = {
    file: "runs.csv",
    about: "every run, oldest first.",
    rows: rows.runs,
    columns: [
      {
        name: "id",
        about: "the run's id; entries.csv names it.",
        value: (run) => run.id,
      },
      { name: "title", about: "the run's title.", value: (run) => run.title },
      {
        name: "started_at",
        about: "when it started (UTC).",
        value: (run) => run.startedAt,
      },
      {
        name: "duration_seconds",
        about: "how long it took.",
        value: (run) => run.durationS,
      },
      {
        name: "distance_meters",
        about: "how far.",
        value: (run) => run.distanceM,
      },
      {
        name: "indoor",
        about: "true for a treadmill or track run.",
        value: (run) => run.indoor,
      },
      {
        name: "effort",
        about: "easy, steady, workout or race.",
        value: (run) => run.effort,
      },
      {
        name: "added_from",
        about: "file for an uploaded run, manual for one you typed.",
        value: (run) => run.source,
      },
      {
        name: "conditions_from",
        about: "visualcrossing, or manual for the band you set yourself.",
        value: (run) => run.conditions?.source,
      },
      {
        name: "temp_c",
        about: "temperature, in °C.",
        value: (run) => run.conditions?.tempC,
      },
      {
        name: "feels_like_c",
        about: "feels-like temperature, in °C.",
        value: (run) => run.conditions?.feelsLikeC,
      },
      {
        name: "humidity",
        about: "relative humidity, in %.",
        value: (run) => run.conditions?.humidity,
      },
      {
        name: "wind_kph",
        about: "wind speed, in km/h.",
        value: (run) => run.conditions?.windKph,
      },
      {
        name: "precip_mm",
        about: "precipitation, in mm.",
        value: (run) => run.conditions?.precipMm,
      },
      {
        name: "condition",
        about: "the sky, in the weather provider's words.",
        value: (run) => run.conditions?.condition,
      },
      {
        name: "sky",
        about: "the sky you picked, for a band you set.",
        value: (run) => run.conditions?.sky,
      },
      {
        name: "run_file",
        about: "the file this run was imported from, in run-files/.",
        value: (run) => run.runFile,
      },
    ],
  };

  const entriesSheet: Sheet<EntryRow> = {
    file: "entries.csv",
    about: "every kit you logged, with its verdict.",
    rows: rows.entries,
    columns: [
      {
        name: "id",
        about: "the entry's id; kit.csv names it.",
        value: (entry) => entry.id,
      },
      {
        name: "run_id",
        about: "the run it was worn on, in runs.csv.",
        value: (entry) => entry.runId,
      },
      {
        name: "verdict",
        about: "-2 (too cold) to +2 (too warm); 0 is dialed.",
        value: (entry) => entry.verdict,
      },
      {
        name: "shared",
        about: "true when other runners can see it.",
        value: (entry) => entry.isPublic,
      },
      {
        name: "caption",
        about: "what you wrote.",
        value: (entry) => entry.caption,
      },
      {
        name: "tags",
        about: "its tags, separated by semicolons.",
        value: (entry) => entry.tags,
      },
      {
        name: "photos",
        about: "its photos, in photos/entries/, separated by semicolons.",
        value: (entry) => entry.photos,
      },
      {
        name: "created_at",
        about: "when you logged it (UTC).",
        value: (entry) => entry.createdAt,
      },
    ],
  };

  const kitSheet: Sheet<KitRow> = {
    file: "kit.csv",
    about: "each garment in each kit, one row a garment.",
    rows: rows.kit,
    columns: [
      {
        name: "entry_id",
        about: "the entry, in entries.csv.",
        value: (item) => item.entryId,
      },
      {
        name: "garment_id",
        about: "the garment, in garments.csv.",
        value: (item) => item.itemId,
      },
      {
        name: "flag",
        about: "too_much or not_enough, if you marked it.",
        value: (item) => item.flag,
      },
      {
        name: "note",
        about: "what you wrote about it.",
        value: (item) => item.note,
      },
    ],
  };

  const garmentsSheet: Sheet<GarmentRow> = {
    file: "garments.csv",
    about: "your closet, retired garments included.",
    rows: rows.garments,
    columns: [
      {
        name: "id",
        about: "the garment's id; kit.csv names it.",
        value: (garment) => garment.id,
      },
      {
        name: "category",
        about: "top, bottom, and so on.",
        value: (garment) => garment.category,
      },
      {
        name: "type",
        about: "what kind within the category.",
        value: (garment) => garment.type,
      },
      { name: "brand", about: "the brand.", value: (garment) => garment.brand },
      { name: "name", about: "its name.", value: (garment) => garment.name },
      { name: "size", about: "its size.", value: (garment) => garment.size },
      {
        name: "color",
        about: "the colour family.",
        value: (garment) => garment.color,
      },
      {
        name: "color_name",
        about: "the colour's name.",
        value: (garment) => garment.colorName,
      },
      {
        name: "color_hex",
        about: "the colour, as a hex code.",
        value: (garment) => garment.colorHex,
      },
      {
        name: "layer",
        about: "where it sits in a kit.",
        value: (garment) => garment.layer,
      },
      {
        name: "weight",
        about: "how heavy the fabric is.",
        value: (garment) => garment.weight,
      },
      {
        name: "fabric",
        about: "what it is made of.",
        value: (garment) => garment.fabric,
      },
      {
        name: "wind_resistant",
        about: "true if it blocks wind.",
        value: (garment) => garment.windResistant,
      },
      {
        name: "water_resistant",
        about: "true if it keeps rain out.",
        value: (garment) => garment.waterResistant,
      },
      {
        name: "visibility",
        about: "reflective or hi_viz, if it is built to be seen.",
        value: (garment) => garment.visibilityLevel,
      },
      {
        name: "product_url",
        about: "the product page you pasted.",
        value: (garment) => garment.productUrl,
      },
      {
        name: "retired",
        about: "true once you retired it.",
        value: (garment) => garment.retired,
      },
      {
        name: "added_at",
        about: "when you added it (UTC).",
        value: (garment) => garment.createdAt,
      },
      {
        name: "photo",
        about: "its photo, in photos/closet/.",
        value: (garment) => garment.photo,
      },
    ],
  };

  return { profileSheet, runsSheet, entriesSheet, kitSheet, garmentsSheet };
}
