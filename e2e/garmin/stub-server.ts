/**
 * A stand-in for Garmin's Personal API, for the Garmin demo (plan 157,
 * step 9). Playwright starts it beside the dev server, and the dev
 * server's `GARMIN_API_ORIGIN` points the app's own client at it.
 *
 * Every answer is synthetic: the list in the shape the client's zod
 * schema reads, and each download a zip of a FIT file built by the unit
 * tests' own helpers. Nothing recorded from a real account is used or
 * committed. `npm run garmin:check` is what checks these shapes against
 * the real API.
 *
 * The runs are dated from when the server starts, so A1 always reads
 * them as recent.
 */
import { createServer } from "node:http";
import process from "node:process";

import { fitFile } from "../../test/runs/fit-file";
import { zipOf } from "../../test/runs/zip-file";
import { GARMIN_STUB_PORT, GARMIN_STUB_RUNS } from "./stub-runs";

const TOKEN = "e2e.stub.token";

const TOKEN_PATH =
  "/personalapitoken-service/personal-api/personal-api-key/token";
const LIST_PATH = "/activitylist-service/activities/search/activities";
const DOWNLOAD_PATH = "/download-service/files/activity/";

const startedAt = Date.now();

/**
"yyyy-MM-dd HH:mm:ss" in UTC, as Garmin writes `startTimeGMT`.
*/
function gmt(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 19).replace("T", " ");
}

const runs = GARMIN_STUB_RUNS.map((run) => ({
  ...run,
  start: startedAt - run.daysAgo * 86_400_000,
}));

const summaries = runs.map((run) => ({
  activityId: run.activityId,
  activityName: "Synthetic Run",
  startTimeGMT: gmt(run.start),
  distance: run.distanceM,
  duration: run.durationS,
}));

async function download(activityId: number): Promise<ArrayBuffer | undefined> {
  const run = runs.find((candidate) => candidate.activityId === activityId);
  if (run === undefined) return undefined;
  const start = new Date(run.start);
  return zipOf(
    fitFile({
      startTime: start,
      timestamp: new Date(run.start + run.durationS * 1000),
      totalElapsedTime: run.durationS,
      totalTimerTime: run.durationS,
      totalDistance: run.distanceM,
      ...(run.workoutRpe !== undefined && { workoutRpe: run.workoutRpe }),
    }),
  );
}

const server = createServer((request, response) => {
  // Only the path is read; the base is never fetched.
  const url = new URL(request.url ?? "/", "https://stub.invalid");

  if (url.pathname === "/health") {
    response.end("ok");
    return;
  }
  const authorization = request.headers.authorization ?? "";
  if (url.pathname === TOKEN_PATH && request.method === "POST") {
    if (!authorization.startsWith("ApiKey ")) {
      response.writeHead(401).end();
      return;
    }
    response.end(TOKEN);
    return;
  }
  if (authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  if (url.pathname === LIST_PATH) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(summaries));
    return;
  }
  if (url.pathname.startsWith(DOWNLOAD_PATH)) {
    const id = Number(url.pathname.slice(DOWNLOAD_PATH.length));
    void download(id).then((zip) => {
      if (zip === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/zip");
      response.end(Buffer.from(zip));
    });
    return;
  }
  response.writeHead(404).end();
});

server.listen(GARMIN_STUB_PORT, () => {
  console.log(`Garmin stub on ${String(GARMIN_STUB_PORT)}`);
});

process.on("SIGTERM", () => {
  server.close();
});
