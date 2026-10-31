/**
 * What goes in the export ZIP, and under what name (task 126, ACC-10;
 * round 27 #13: "runs.csv, entries.csv, garments.csv, your original run
 * files and photos, and a README naming each column").
 *
 * Pure: the rows (`exportData`) and the objects actually in R2 in, the
 * texts and the objects to copy out. The column table itself is
 * `export-sheets.ts`'s (split out so `.fallowrc.jsonc` can ignore the
 * table without also ignoring the behaviour here: which files go in, and
 * every sheet's rows, built so each column only reads a field); the
 * CSV/README rendering is `export-format.ts`'s.
 *
 * A file a row names but R2 no longer holds is left out, and its cell is
 * empty: the CSVs never point at a file the ZIP does not have.
 */
import { audienceWord } from "../../lib/contracts";
import { garmentOriginalKey } from "../../lib/garment-photo-key";
import type { ExportData } from "./export";
import {
  csvOf,
  iso,
  list,
  readmeSection,
  type ExportText,
} from "./export-format";
import { buildSheets, type ProfileRow } from "./export-sheets";

/**
Where an object the ZIP copies lives, and the name it takes inside.
*/
export interface ExportObject {
  readonly bucket: "media" | "imports";
  readonly key: string;
  readonly name: string;
  readonly size: number;
}

/**
 * The objects R2 holds under the runner's prefixes, by key, with their
 * sizes — `export-build.ts` lists them before anything is written.
 */
export interface StoredObjects {
  readonly media: ReadonlyMap<string, number>;
  readonly imports: ReadonlyMap<string, number>;
}

type Garment = ExportData["garments"][number];
type Entry = ExportData["entries"][number];
type Upload = ExportData["uploads"][number];

/**
 * The garment's photo, at the most the app keeps: the re-encoded original,
 * or — for a photo stored before originals were — the full size.
 */
function garmentPhoto(
  garment: Garment,
  stored: StoredObjects,
): ExportObject | undefined {
  if (garment.photoKey === null) return undefined;
  const candidates = [
    { key: garmentOriginalKey(garment.photoKey), extension: "jpg" },
    { key: `${garment.photoKey}/full.webp`, extension: "webp" },
  ];
  for (const candidate of candidates) {
    const size = stored.media.get(candidate.key);
    if (size !== undefined) {
      return {
        bucket: "media",
        key: candidate.key,
        name: `photos/closet/${garment.id}.${candidate.extension}`,
        size,
      };
    }
  }
  return undefined;
}

function entryPhoto(
  photo: Entry["photos"][number],
  stored: StoredObjects,
): ExportObject | undefined {
  const size = stored.media.get(photo.photoKey);
  if (size === undefined) return undefined;
  return {
    bucket: "media",
    key: photo.photoKey,
    name: `photos/entries/${photo.entryId}-${String(photo.position + 1)}.jpg`,
    size,
  };
}

/**
An uploaded run file, as uploaded: `run-files/{upload id}.{gpx|fit|tcx}`.
*/
function runFile(
  upload: Upload,
  stored: StoredObjects,
): ExportObject | undefined {
  const size = stored.imports.get(upload.r2Key);
  if (size === undefined) return undefined;
  const extension = upload.r2Key.slice(upload.r2Key.lastIndexOf(".") + 1);
  return {
    bucket: "imports",
    key: upload.r2Key,
    name: `run-files/${upload.id}.${extension}`,
    size,
  };
}

/**
 * `profile.csv`'s one row: the account's address and the day it was made,
 * written out as every other time in the ZIP is (UTC), beside the profile
 * and its default audience in the UI's word (`audienceWord`: `runners`
 * never leaves the server).
 */
function profileRow(data: ExportData): ProfileRow {
  const { account, profile } = data;
  return {
    account:
      account === undefined
        ? undefined
        : {
            email: account.email,
            joinedAt: iso(Math.floor(account.createdAt.getTime() / 1000)),
          },
    profile,
    defaultAudience:
      profile === undefined ? undefined : audienceWord[profile.defaultAudience],
    countInTotals: countsInTotals(data),
  };
}

/**
 * Whether the runner's runs count in anonymous totals, as the guide job
 * reads it (D-108 D): the stored answer, or counted for an account that
 * has no profile row yet — nothing creates one at signup, and the
 * column's default is on. Nothing for an account that is gone.
 */
function countsInTotals({ account, profile }: ExportData): boolean | undefined {
  if (profile !== undefined) return profile.countInTotals;
  return account === undefined ? undefined : true;
}

/**
The README's folders: photos always, run files only when the ZIP has one.
*/
const PHOTOS_LINE =
  "photos/ holds your kit photos (photos/entries/) and garment photos (photos/closet/), at the size dialed.run keeps.";
const RUN_FILES_LINE =
  "run-files/ holds the GPX, FIT and TCX files you uploaded, as uploaded.";

/**
 * Everything the ZIP holds: the six CSVs and the README as text, and the
 * photos and run files to copy from R2.
 *
 * Every sheet's rows are built here, each value decided once — a photo
 * resolved against what R2 holds, a time written out, a list joined — so
 * `export-sheets.ts`'s columns only read them. Each resolved file is kept
 * beside the row it belongs to, and the objects list is read from those
 * same pairs: no row is looked back up by id, so none can be missing.
 */
export function exportFiles(
  data: ExportData,
  stored: StoredObjects,
  now: number,
): { texts: ExportText[]; objects: ExportObject[] } {
  const closet = data.garments.map((garment) => ({
    garment,
    photo: garmentPhoto(garment, stored),
  }));
  const kits = data.entries.map((entry) => ({
    entry,
    photos: entry.photos.flatMap((photo) => entryPhoto(photo, stored) ?? []),
  }));
  const uploaded = data.uploads.flatMap((upload) => {
    const file = runFile(upload, stored);
    return file === undefined ? [] : [{ upload, file }];
  });

  const {
    profileSheet,
    runsSheet,
    entriesSheet,
    kitSheet,
    garmentsSheet,
    termsSheet,
  } = buildSheets({
    profile: profileRow(data),
    runs: data.runs.map((run) => ({
      ...run,
      startedAt: iso(run.startedAt),
      // The file a run was imported from: the upload that became it. A
      // duplicate upload names a run too, but it was not the run's
      // source.
      runFile: uploaded.find(
        ({ upload }) => upload.status === "done" && upload.runId === run.id,
      )?.file.name,
    })),
    entries: kits.map(({ entry, photos }) => ({
      ...entry,
      tags: list(entry.tags),
      photos: list(photos.map((photo) => photo.name)),
      createdAt: iso(entry.createdAt),
      audience: audienceWord[entry.audience],
    })),
    kit: data.entries.flatMap((entry) => entry.kit),
    garments: closet.map(({ garment, photo }) => ({
      ...garment,
      createdAt: iso(garment.createdAt),
      photo: photo?.name,
    })),
    terms: data.terms.map((acceptance) => ({
      version: acceptance.version,
      acceptedAt: iso(acceptance.acceptedAt),
      how: acceptance.how ?? undefined,
    })),
  });

  const sheets = [
    csvOf(profileSheet),
    csvOf(runsSheet),
    csvOf(entriesSheet),
    csvOf(kitSheet),
    csvOf(garmentsSheet),
    csvOf(termsSheet),
  ];
  const readme = [
    "dialed.run export",
    `Made ${iso(now)}.`,
    "",
    "Times are UTC. Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
    // D-144: the licence asks for its credit, linked, near the data or
    // anything derived from it; temp_c and feels_like_c are its readings.
    "Weather data provided by Visual Crossing: https://www.visualcrossing.com/",
    // Round 35 #57: a run file is deleted once read (D-116), so the ZIP
    // rarely has one, and the README names `run-files/` only when it does.
    uploaded.length === 0 ? PHOTOS_LINE : `${PHOTOS_LINE} ${RUN_FILES_LINE}`,
    "",
    readmeSection(profileSheet),
    "",
    readmeSection(runsSheet),
    "",
    readmeSection(entriesSheet),
    "",
    readmeSection(kitSheet),
    "",
    readmeSection(garmentsSheet),
    "",
    readmeSection(termsSheet),
    "",
  ].join("\n");
  const objects = [
    ...kits.flatMap(({ photos }) => photos),
    ...closet.flatMap(({ photo }) => photo ?? []),
    ...uploaded.map(({ file }) => file),
  ];
  return { texts: [{ name: "README.txt", text: readme }, ...sheets], objects };
}

export { csvCell, type ExportText } from "./export-format";
