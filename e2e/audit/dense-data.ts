/**
 * The audit's dense seed data (design 205, "Seeded data"): every JSON
 * table under `./data/`, zod-parsed once, here, when the module loads.
 *
 * Declarations only, no logic, which is why it sits outside the mutation
 * ratchet beside the JSON it reads: what the tables mean is
 * `dense-seed.ts`'s, which is ratcheted. A table that does not match its
 * schema fails the import, and so every test of the builder.
 *
 * Leaf schemas are named so no schema nests more than three calls deep.
 */
import { z } from "zod";

import { table } from "./table";

import {
  accessRequests,
  gaveUp,
  moderationActions,
  productCorrections,
  reports,
  reviewQueue,
  runs,
} from "../../src/db/schema-core";
import {
  fabricSchema,
  garmentSchema,
  weightSchema,
} from "../../src/lib/contracts";
import accessJson from "./data/access.json";
import deskJson from "./data/desk.json";
import garmentsJson from "./data/garments.json";
import inboxJson from "./data/inbox.json";
import kitsJson from "./data/kits.json";
import peopleJson from "./data/people.json";
import photosJson from "./data/photos.json";
import runsJson from "./data/runs.json";
import summaryJson from "./data/summary.json";

const text = z.string();
const num = z.number();
const int = z.int();
const flag = z.boolean();
const ints = z.array(int);
const texts = z.array(text).min(1);
const maybeTexts = z.array(text.nullable()).min(1);
const verdicts = z.array(int.min(-2).max(2)).min(1);
const runSource = z.enum(runs.source.enumValues);
const runSources = z.array(runSource).min(1);
const efforts = z.array(z.enum(runs.effort.enumValues).nullable()).min(1);
const queueSubject = z.enum(reviewQueue.subjectType.enumValues);
const queueSource = z.enum(reviewQueue.source.enumValues);
const queueStatus = z.enum(reviewQueue.status.enumValues);

const tempF = z.strictObject({ low: num, high: num });
const closetGarment = z.strictObject({
  key: text,
  garment: garmentSchema,
  tempF: tempF.optional(),
  photo: int.optional(),
  retired: z.literal(true).optional(),
  product: z.literal(true).optional(),
});
export type ClosetGarment = z.infer<typeof closetGarment>;
const closetList = z.array(closetGarment);

export const garmentsData = z
  .strictObject({ maya: closetList, pool: closetList, longPool: closetList })
  .parse(garmentsJson);

const runnerSchema = z.strictObject({
  id: text,
  handle: text,
  city: text,
  lat: num,
  lng: num,
  followed: flag,
  followsMaya: flag,
  long: flag,
  entries: int,
});
export type Runner = z.infer<typeof runnerSchema>;

const account = z.strictObject({ id: text, handle: text });
const bannedAccount = account.extend({ reason: text });
const mayaSchema = account.extend({
  name: text,
  city: text,
  lat: num,
  lng: num,
  timeZone: text,
});

export const people = table(peopleJson, {
  maya: mayaSchema,
  runners: z.array(runnerSchema),
  banned: z.array(bannedAccount),
  leaving: z.array(account),
  unconfirmed: z.array(account),
});

const weatherShape = z.strictObject({ precipMm: num, condition: text });
const modes = z.strictObject({
  indoor: ints.optional(),
  manual: ints.optional(),
  failed: ints.optional(),
  pending: ints.optional(),
});
export type Modes = z.infer<typeof modes>;
const longTitle = z.strictObject({ run: int, title: int });
const longTitles = z.array(longTitle);
export type LongTitles = z.infer<typeof longTitles>;
const season = z.strictObject({ withinDays: num, feelsC: num });
const seasons = z.strictObject({ bands: z.array(season), beyondC: num });
const tagTable = z.strictObject({ under: texts, over: texts, dialed: texts });
const mayaPlan = z.strictObject({
  runs: int,
  modes,
  unjudged: ints,
  longTitles,
});
const backlogPlan = mayaPlan.omit({ unjudged: true });

export const runsData = table(runsJson, {
  titles: texts,
  longTitles: texts,
  tags: tagTable,
  verdictCycle: verdicts,
  recentVerdicts: verdicts,
  distancesM: z.array(num).min(1),
  mayaSources: runSources,
  otherSources: runSources,
  efforts,
  devices: maybeTexts,
  skies: texts,
  seasons,
  wet: weatherShape,
  damp: weatherShape,
  rightNow: weatherShape.extend({ feelsC: num }),
  maya: mayaPlan,
  backlog: backlogPlan,
});

const wetOrDry = z.strictObject({ wet: maybeTexts, dry: maybeTexts });
const slotSchema = z.union([maybeTexts, wetOrDry]);
export type Slot = z.infer<typeof slotSchema>;
const slots = z.array(slotSchema);
const band = z.strictObject({ belowC: num, slots });
const kitTable = z.strictObject({
  bands: z.array(band),
  warm: slots,
  shoes: slotSchema,
});
export type KitTable = z.infer<typeof kitTable>;

export const kits = z
  .strictObject({ maya: kitTable, pool: kitTable, indoorFeelsC: num })
  .parse(kitsJson);

const entryRef = z.strictObject({
  ref: z.literal("entry"),
  runner: text,
  index: int,
});
/**
A row another table points at, by what it is rather than its minted id.
*/
const refSchema = z.discriminatedUnion("ref", [
  z.strictObject({ ref: z.literal("id"), id: text }),
  z.strictObject({ ref: z.literal("fresh") }),
  z.strictObject({ ref: z.literal("maya"), garment: text }),
  z.strictObject({ ref: z.literal("garment"), runner: text, garment: text }),
  entryRef,
  z.strictObject({ ref: z.literal("backlog"), index: int }),
  z.strictObject({ ref: z.literal("productAt"), index: int }),
]);
export type Ref = z.infer<typeof refSchema>;

const notificationPlan = z.strictObject({
  kind: text,
  body: text,
  hoursAgo: num,
  read: flag,
  follower: int.optional(),
  link: refSchema.optional(),
  subject: refSchema.optional(),
});
export const inbox = z
  .strictObject({ notifications: z.array(notificationPlan) })
  .parse(inboxJson);

const note = text.optional();
const queuePlan = z.strictObject({
  subjectType: queueSubject,
  subject: refSchema,
  source: queueSource,
  hoursAgo: num,
  status: queueStatus.optional(),
});
const reportPlan = z.strictObject({
  reporter: text,
  subjectType: z.enum(reports.subjectType.enumValues),
  subject: refSchema,
  reason: z.enum(reports.reason.enumValues),
  hoursAgo: num,
  note,
});
const heldPhotoPlan = z.strictObject({
  entry: entryRef,
  source: queueSource,
  hoursAgo: num,
});
const flaggedPlan = z.strictObject({
  id: text,
  subjectType: z.enum(moderationActions.subjectType.enumValues),
  ownerId: text,
  reason: text,
  hoursAgo: num,
});
const variant = z.strictObject({ name: text, pieces: int });
const dupePlan = z.strictObject({ brand: text, variants: z.array(variant) });
const correctionPlan = z.strictObject({
  product: text,
  garment: refSchema,
  userId: text,
  field: z.enum(productCorrections.field.enumValues),
  value: text,
  hoursAgo: num,
  note,
});
const gaveUpPlan = z.strictObject({
  kind: z.enum(gaveUp.kind.enumValues),
  subject: refSchema,
  reason: text,
  rawError: text.nullable(),
  tries: int,
});

export const desk = table(deskJson, {
  operator: text,
  queue: z.array(queuePlan),
  reports: z.array(reportPlan),
  heldPhotos: z.array(heldPhotoPlan),
  flagged: z.array(flaggedPlan),
  compositions: z.strictObject({ merino: text, other: text }),
  dupes: z.array(dupePlan),
  corrections: z.array(correctionPlan),
  gaveUp: z.array(gaveUpPlan),
});

const codePlan = z.strictObject({
  code: text,
  label: text.nullable(),
  maxUses: int,
  used: int,
  revoked: flag,
});
const requestPlan = z.strictObject({
  email: z.email(),
  note: text.nullable(),
  status: z.enum(accessRequests.status.enumValues),
  hoursAgo: num,
});
export const access = table(accessJson, {
  operator: text,
  codes: z.array(codePlan),
  requests: z.array(requestPlan),
});

const artwork = z.strictObject({
  width: int,
  height: int,
  from: text,
  to: text,
  label: text,
});
const artworks = z.array(artwork).min(1);
export const photoPlan = table(photosJson, {
  sizes: z.record(text, int),
  garments: artworks,
  entries: artworks,
});
/**
The garment variants the closet writes, and the longest side of each.
*/
export const PHOTO_SIZES = photoPlan.sizes;

const nthOf = z.strictObject({ runner: text, index: int });
export const summaryPlan = table(summaryJson, {
  garments: z.record(text, text),
  mayaRuns: z.record(text, int),
  backlogRuns: z.record(text, int),
  mayaEntries: z.record(text, int),
  otherEntries: z.record(text, nthOf),
  handles: z.record(text, text),
});

export const MAYA_ID = people.maya.id;
export const MAYA_HANDLE = people.maya.handle;
export const MAYA = people.maya;

/**
What a spec needs to reach the screens the seed fills.
*/
export const auditSeedSchema = z.strictObject({
  halfZipId: text,
  shoeId: text,
  retiredShoeId: text,
  longNameId: text,
  fullRunId: text,
  indoorRunId: text,
  manualRunId: text,
  backlogRunId: text,
  ownEntryId: text,
  ownPhotoEntryId: text,
  unjudgedEntryId: text,
  publicEntryId: text,
  otherEntryId: text,
  longEntryId: text,
  busyHandle: text,
  longHandle: text,
});
export type AuditSeed = z.infer<typeof auditSeedSchema>;

export type Artwork = z.infer<typeof artwork> & {
  kind: "garment" | "entry";
};

/**
The facts a product row copies from the garment that created it.
*/
export const productFacts = z.object({
  type: z.string().optional(),
  weight: weightSchema.optional(),
  fabric: fabricSchema.optional(),
  windResistant: z.boolean().optional(),
  waterResistant: z.boolean().optional(),
});
