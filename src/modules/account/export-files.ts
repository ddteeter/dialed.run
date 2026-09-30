/**
 * What goes in the export ZIP, and under what name (task 126, ACC-10;
 * round 27 #13: "runs.csv, entries.csv, garments.csv, your original run
 * files and photos, and a README naming each column").
 *
 * Pure: the rows (`exportData`) and the objects actually in R2 in, the
 * texts and the objects to copy out. The column table itself is
 * `export-sheets.ts`'s (split out so `.fallowrc.jsonc` can ignore the
 * table without also ignoring the photo/file resolution below, which is
 * this file's own real behaviour); the CSV/README rendering is
 * `export-format.ts`'s.
 *
 * A file a row names but R2 no longer holds is left out, and its cell is
 * empty: the CSVs never point at a file the ZIP does not have.
 */
import type { ExportData } from "./export";
import { csvOf, readmeSection, iso, type ExportText } from "./export-format";
import { buildSheets } from "./export-sheets";

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
    { key: `${garment.photoKey}/original.jpg`, extension: "jpg" },
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
 * Everything the ZIP holds: the five CSVs and the README as text, and the
 * photos and run files to copy from R2.
 */
export function exportFiles(
  data: ExportData,
  stored: StoredObjects,
  now: number,
): { texts: ExportText[]; objects: ExportObject[] } {
  const garmentPhotos = new Map(
    data.garments.map((garment) => [garment.id, garmentPhoto(garment, stored)]),
  );
  const photosByEntry = data.entries.map((entry) => ({
    id: entry.id,
    files: entry.photos.flatMap((photo) => entryPhoto(photo, stored) ?? []),
  }));
  const entryPhotos = new Map(
    photosByEntry.map((entry) => [entry.id, entry.files]),
  );
  const uploaded = data.uploads.flatMap((upload) => {
    const file = runFile(upload, stored);
    return file === undefined ? [] : [{ upload, file }];
  });
  // The file a run was imported from: the upload that became it. A
  // duplicate upload names a run too, but it was not the run's source.
  const runFileOf = new Map(
    uploaded.flatMap(({ upload, file }) =>
      upload.status === "done" && upload.runId !== null
        ? [[upload.runId, file.name] as const]
        : [],
    ),
  );

  const { profileSheet, runsSheet, entriesSheet, kitSheet, garmentsSheet } =
    buildSheets({ data, runFileOf, entryPhotos, garmentPhotos });

  const sheets = [
    csvOf(profileSheet),
    csvOf(runsSheet),
    csvOf(entriesSheet),
    csvOf(kitSheet),
    csvOf(garmentsSheet),
  ];
  const readme = [
    "dialed.run export",
    `Made ${iso(now)}.`,
    "",
    "Times are UTC. Conditions are the reading dialed.run showed for each run: from Visual Crossing, or the band you set yourself.",
    "photos/ holds your kit photos (photos/entries/) and garment photos (photos/closet/), at the size dialed.run keeps. run-files/ holds the GPX, FIT and TCX files you uploaded, as uploaded.",
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
  ].join("\n");
  // Read from the list the map was built from, not looked back up by id:
  // there is no entry the map lacks, so no fallback for one.
  const objects = [
    ...photosByEntry.flatMap((entry) => entry.files),
    ...data.garments.flatMap((garment) => garmentPhotos.get(garment.id) ?? []),
    ...uploaded.map(({ file }) => file),
  ];
  return { texts: [{ name: "README.txt", text: readme }, ...sheets], objects };
}

export { csvCell, type ExportText } from "./export-format";
