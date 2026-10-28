/**
 * `npm run garmin:check [activityId]`: phase 1's code and its mocks against
 * the real Personal API, with the owner's key (plan 160).
 *
 * **The code.** A token, the recent-runs list through the same zod schema
 * the app parses it with, one run's download through the same unzipper,
 * and that file through the same FIT parser, down to the perceived effort.
 * A failure names the step and the client's own reason, as Sentry would
 * see it in production.
 *
 * **The mocks.** Every test runs on synthetic answers, so this also holds
 * them against the real ones, by structure only: the token's form, the
 * types of the list fields the client reads against the e2e stub's,
 * the zip's layout against the unit tests' `zipOf`, and the types of the
 * FIT session fields the parser reads against `fitFile`'s. A difference
 * fails the check: the mock is wrong, and a test built on it proves
 * nothing about Garmin.
 *
 * **Local only, and it keeps nothing.** The key is personal to the owner
 * and rate-limited, so this never runs in CI, and it writes nothing to
 * disk: nothing recorded from a real account is committed (plan 160). It
 * prints dates, distances, the effort, types and flags, never the token
 * or a body.
 *
 * The key comes from `GARMIN_API_KEY` in the environment, else from
 * `.dev.vars`, where the app reads it.
 */
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import { Decoder, Stream } from "@garmin/fitsdk";

import { GARMIN_STUB_RUNS, stubSummaryOf } from "../e2e/garmin/stub-runs";
import {
  GARMIN_PATHS,
  GARMIN_PERSONAL_ORIGIN,
  GarminUnavailable,
  createGarminApi,
} from "../src/modules/runs/garmin/api";
import type { GarminActivity } from "../src/modules/runs/garmin/api";
import { onlyFileIn } from "../src/modules/runs/garmin/unzip";
import { fitSource } from "../src/modules/runs/parsers/fit";
import { fitFile } from "../test/runs/fit-file";
import { zipLayoutOf, zipOf } from "../test/runs/zip-file";

/**
The session fields `parsers/fit.ts` reads.
*/
const SESSION_FIELDS_READ = [
  "startTime",
  "totalElapsedTime",
  "totalDistance",
  "workoutRpe",
  "totalMovingTime",
  "totalTimerTime",
  "totalAscent",
  "startPositionLat",
  "startPositionLong",
] as const;

function apiKey(): string {
  const fromEnv = process.env.GARMIN_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const match = /^\s*GARMIN_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/u.exec(line);
      if (match?.[1]) return match[1];
    }
  }
  throw new Error(
    "No GARMIN_API_KEY: set it in .dev.vars (see .dev.vars.example).",
  );
}

function day(startedAt: number): string {
  return new Date(startedAt * 1000).toISOString().slice(0, 16);
}

// ---- the code ----------------------------------------------------------

async function checkCode(key: string): Promise<GarminActivity | undefined> {
  const api = createGarminApi(key);

  const runs = await api.recentRuns(10);
  console.log(`list      ok: ${String(runs.length)} runs`);
  for (const run of runs) {
    console.log(
      `          ${run.activityId}  ${day(run.startedAt)}Z  ${(run.distanceM / 1000).toFixed(2)} km  ${String(run.durationS)} s`,
    );
  }

  const wanted = process.argv[2];
  const run =
    wanted === undefined
      ? runs[0]
      : runs.find((candidate) => candidate.activityId === wanted);
  if (run === undefined) {
    console.log(
      wanted === undefined
        ? "download  skipped: no runs on Garmin"
        : `download  skipped: ${wanted} is not among the last 10`,
    );
    return undefined;
  }

  const fit = await api.fitFile(run.activityId);
  console.log(
    `download  ok: ${run.activityId}, one file of ${String(fit.byteLength)} bytes`,
  );

  const draft = await fitSource.parse(fit);
  console.log(
    `parse     ok: ${(draft.distanceM / 1000).toFixed(2)} km, ${String(draft.durationS)} s, ` +
      (draft.rpe === undefined
        ? "no perceived effort (none rated on the watch)"
        : `perceived effort ${String(draft.rpe)} of 10`),
  );
  return run;
}

// ---- the mocks ---------------------------------------------------------

/**
One raw call, for what the client does not hand back: the body itself.
*/
async function raw(
  path: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<Response> {
  const response = await fetch(`${GARMIN_PERSONAL_ORIGIN}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${String(response.status)}`);
  }
  return response;
}

/**
A value's structure: its type, and for a string its form with every digit
a 9 and every letter an a, so a date's layout compares and a name's does
not matter.
*/
function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Date) return "Date";
  if (typeof value === "string") {
    return `string ${value.replaceAll(/\d/gu, "9").replaceAll(/[a-z]/giu, "a")}`;
  }
  return typeof value;
}

/**
Field by field, what differs between the real structure and the mock's,
over the fields the mock has.
*/
function differences(
  what: string,
  real: Record<string, unknown>,
  mock: Record<string, unknown>,
  formOf: (field: string, value: unknown) => string,
): string[] {
  return Object.keys(mock).flatMap((field) => {
    const realShape = formOf(field, real[field]);
    const mockShape = formOf(field, mock[field]);
    return realShape === mockShape
      ? []
      : [`${what}.${field}: real ${realShape}, mock ${mockShape}`];
  });
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/**
The first session's fields the parser reads, as the SDK decodes them.
*/
function sessionOf(fit: ArrayBuffer): Record<string, unknown> {
  const { messages } = new Decoder(Stream.fromArrayBuffer(fit)).read();
  const session = recordOf(messages.sessionMesgs?.[0]);
  return Object.fromEntries(
    SESSION_FIELDS_READ.flatMap((field) =>
      session[field] === undefined ? [] : [[field, session[field]]],
    ),
  );
}

async function realToken(key: string): Promise<string> {
  const response = await raw(GARMIN_PATHS.token, {
    method: "POST",
    headers: { Authorization: `ApiKey ${key}` },
  });
  const token = await response.text();
  return token.trim();
}

async function realListItem(
  auth: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await raw(
    `${GARMIN_PATHS.list}?start=0&limit=1&activityType=running`,
    { headers: auth },
  );
  const list: unknown = await response.json();
  return recordOf(Array.isArray(list) ? list[0] : undefined);
}

async function realZip(
  auth: Record<string, string>,
  activityId: string,
): Promise<ArrayBuffer> {
  const response = await raw(
    `${GARMIN_PATHS.download}${encodeURIComponent(activityId)}`,
    { headers: auth },
  );
  return response.arrayBuffer();
}

/**
Only the start time's form is the client's business; a name is any string.
*/
function listFormOf(field: string, value: unknown): string {
  return field === "startTimeGMT" ? shapeOf(value) : typeof value;
}

async function checkMocks(key: string, activityId: string): Promise<string[]> {
  const token = await realToken(key);
  const auth = { Authorization: `Bearer ${token}` };
  const [stubRun] = GARMIN_STUB_RUNS;
  const stubItem = stubRun === undefined ? {} : stubSummaryOf(stubRun, 0);
  const zip = await realZip(auth, activityId);
  const mockFit = fitFile({ workoutRpe: 20 });
  const mockZip = await zipOf(mockFit);
  const realFit = await onlyFileIn(zip);

  return [
    ...(token.split(".").length === 3
      ? []
      : ["token: real is not three dot-separated parts"]),
    ...differences("list", await realListItem(auth), stubItem, listFormOf),
    ...differences(
      "zip",
      { ...zipLayoutOf(zip) },
      { ...zipLayoutOf(mockZip) },
      (_, value) => String(value),
    ),
    ...differences(
      "fit.session",
      sessionOf(realFit),
      sessionOf(mockFit),
      (_, value) => shapeOf(value),
    ),
  ];
}

/**
The client's own reason, never its cause: a cause can carry a body.
*/
function reasonOf(error: unknown): string {
  if (error instanceof GarminUnavailable) {
    return `Garmin unavailable (${error.reason})`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "an unknown failure";
}

async function check(): Promise<void> {
  const key = apiKey();
  const run = await checkCode(key);
  if (run === undefined) return;
  const found = await checkMocks(key, run.activityId);
  if (found.length === 0) {
    console.log(
      "mocks     ok: the token, list, zip and FIT session match by structure",
    );
    return;
  }
  for (const difference of found)
    console.error(`mocks     DIFFER ${difference}`);
  process.exitCode = 1;
}

try {
  await check();
} catch (error) {
  console.error(`FAILED    ${reasonOf(error)}`);
  process.exitCode = 1;
}
