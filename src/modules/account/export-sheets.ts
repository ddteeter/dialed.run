/**
 * The export ZIP's five sheets themselves — one column table each (task
 * 126, ACC-10; round 27 #13), kept apart from the behaviour that resolves
 * photos, renders CSV/README text and assembles the ZIP manifest
 * (`./export-files`).
 *
 * Split out for the same reason `db/schema-*.ts` and
 * `modules/closet/tap-list-data.ts` are (CLAUDE.md, `.fallowrc.jsonc`): a
 * table's rows all share the shape `{ name, about, value }`, so a semantic
 * clone detector reads a run of one sheet's columns as a duplicate of
 * another sheet's run regardless of which fields each actually names.
 * Moving the table here lets `.fallowrc.jsonc` ignore this file without
 * also blinding itself to `export-files.ts`'s real behaviour.
 *
 * **Every column is written once**, as a name, a sentence and a value, and
 * both the CSV and the README are read from that one table — so a column
 * the CSV gains is a column the README names.
 */
import type { ExportData } from "./export";
import { iso, list, type Sheet } from "./export-format";

type Garment = ExportData["garments"][number];
type Run = ExportData["runs"][number];
type Entry = ExportData["entries"][number];
type KitRow = Entry["kit"][number];

/**
The one thing a sheet ever reads off a resolved photo or run file: its
name inside the ZIP.
*/
interface SheetFile {
  readonly name: string;
}

/**
 * What `export-files.ts` has already resolved against R2 by the time a
 * sheet is built: each garment's and entry's photo (if kept), and the run
 * a given upload became the source of.
 */
interface ExportSheetInputs {
  readonly data: ExportData;
  readonly runFileOf: ReadonlyMap<string, string>;
  readonly entryPhotos: ReadonlyMap<string, readonly SheetFile[]>;
  readonly garmentPhotos: ReadonlyMap<string, SheetFile | undefined>;
}

interface ExportSheets {
  readonly profileSheet: Sheet<undefined>;
  readonly runsSheet: Sheet<Run>;
  readonly entriesSheet: Sheet<Entry>;
  readonly kitSheet: Sheet<KitRow>;
  readonly garmentsSheet: Sheet<Garment>;
}

export function buildSheets(inputs: ExportSheetInputs): ExportSheets {
  const { data, runFileOf, entryPhotos, garmentPhotos } = inputs;
  const { account, profile } = data;

  const profileSheet: Sheet<undefined> = {
    file: "profile.csv",
    about: "your account and settings, one row.",
    rows: [undefined],
    columns: [
      {
        name: "email",
        about: "the address you log in with.",
        value: () => account?.email,
      },
      {
        name: "joined_at",
        about: "when you made the account (UTC).",
        value: () =>
          account === undefined
            ? undefined
            : iso(Math.floor(account.createdAt.getTime() / 1000)),
      },
      {
        name: "username",
        about: "your handle, without the @.",
        value: () => profile?.username,
      },
      {
        name: "place",
        about: "the place your conditions are read for.",
        value: () => profile?.cityLabel,
      },
      {
        name: "thermal_level",
        about: "your calibration: how warm or cold you run, from -2 to +2.",
        value: () => profile?.thermalLevel,
      },
      { name: "temp_unit", about: "f or c.", value: () => profile?.tempUnit },
      {
        name: "distance_unit",
        about: "mi or km.",
        value: () => profile?.distanceUnit,
      },
      {
        name: "share_new_runs",
        about: "whether a new kit is shared by default.",
        value: () => profile?.shareDefault,
      },
    ],
  };

  const runsSheet: Sheet<Run> = {
    file: "runs.csv",
    about: "every run, oldest first.",
    rows: data.runs,
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
        value: (run) => iso(run.startedAt),
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
        value: (run) => runFileOf.get(run.id),
      },
    ],
  };

  const entriesSheet: Sheet<Entry> = {
    file: "entries.csv",
    about: "every kit you logged, with its verdict.",
    rows: data.entries,
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
        value: (entry) => list(entry.tags),
      },
      {
        name: "photos",
        about: "its photos, in photos/entries/, separated by semicolons.",
        value: (entry) =>
          list((entryPhotos.get(entry.id) ?? []).map((photo) => photo.name)),
      },
      {
        name: "created_at",
        about: "when you logged it (UTC).",
        value: (entry) => iso(entry.createdAt),
      },
    ],
  };

  const kitRows = data.entries.flatMap((entry) => entry.kit);
  const kitSheet: Sheet<KitRow> = {
    file: "kit.csv",
    about: "each garment in each kit, one row a garment.",
    rows: kitRows,
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

  const garmentsSheet: Sheet<Garment> = {
    file: "garments.csv",
    about: "your closet, retired garments included.",
    rows: data.garments,
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
        value: (garment) => iso(garment.createdAt),
      },
      {
        name: "photo",
        about: "its photo, in photos/closet/.",
        value: (garment) => garmentPhotos.get(garment.id)?.name,
      },
    ],
  };

  return { profileSheet, runsSheet, entriesSheet, kitSheet, garmentsSheet };
}
