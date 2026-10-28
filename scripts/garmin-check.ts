/**
 * `npm run garmin:check [activityId]`: runs phase 1's own client, unzipper
 * and FIT parser against the real Personal API with the owner's key
 * (plan 157). It is how a change on Garmin's side is found, since every
 * test runs on synthetic answers.
 *
 * **What it checks.** A token, the recent-runs list through the same zod
 * schema the app parses it with, one run's download through the same
 * unzipper, and that file through the same FIT parser, down to the
 * perceived effort. A failure names the step and the client's own reason,
 * as Sentry would see it in production.
 *
 * **Local only, and it keeps nothing.** The key is personal to the owner
 * and rate-limited, so this never runs in CI, and it writes nothing to
 * disk: nothing recorded from a real account is committed (plan 157). It
 * prints dates, distances and the effort, never the token or a body.
 *
 * The key comes from `GARMIN_API_KEY` in the environment, else from
 * `.dev.vars`, where the app reads it.
 */
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import {
  GarminUnavailable,
  createGarminApi,
} from "../src/modules/runs/garmin/api";
import { fitSource } from "../src/modules/runs/parsers/fit";

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

async function check(): Promise<void> {
  const api = createGarminApi(apiKey());

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
    return;
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

try {
  await check();
} catch (error) {
  console.error(`FAILED    ${reasonOf(error)}`);
  process.exitCode = 1;
}
