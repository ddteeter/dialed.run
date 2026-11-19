/**
 * The half of `npm run e2e:ci` that is not shell (#877): reads CI's `e2e`
 * job, chooses a free port, and writes the plan `scripts/e2e-ci.sh` runs.
 *
 *   tsx scripts/e2e-ci-plan.ts <plan directory>
 *
 * The directory gets `port`, `legs` (one per line), and per leg one file per
 * step, in CI's order: `NN.sh` to run (its first line is `# <label>`), or
 * `NN.skip` holding `<label>\t<why>`. The decisions are in
 * `scripts/e2e-ci/ci-e2e.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { garminStubPort } from "../e2e/garmin/stub-origin";
import { planLeg, readE2eJob, scriptText } from "./e2e-ci/ci-e2e";

/**
App ports to try. The stub follows at +900, which stays clear of 3000–3999, where lane ports sit.
*/
const FIRST_PORT = 4100;
const PORTS_TO_TRY = 800;

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function freePort(): Promise<number> {
  const start = FIRST_PORT + (process.pid % PORTS_TO_TRY);
  for (let offset = 0; offset < PORTS_TO_TRY; offset += 1) {
    const port = FIRST_PORT + ((start - FIRST_PORT + offset) % PORTS_TO_TRY);
    if ((await isFree(port)) && (await isFree(garminStubPort(port))))
      return port;
  }
  throw new Error(
    `no free port pair between ${String(FIRST_PORT)} and ${String(FIRST_PORT + PORTS_TO_TRY)}`,
  );
}

const [directory] = process.argv.slice(2);
if (directory === undefined) {
  throw new Error("usage: tsx scripts/e2e-ci-plan.ts <plan directory>");
}

const job = readE2eJob(readFileSync(".github/workflows/ci.yml", "utf8"));
const port = await freePort();
writeFileSync(path.join(directory, "port"), `${String(port)}\n`);
writeFileSync(path.join(directory, "legs"), `${job.legs.join("\n")}\n`);
for (const leg of job.legs) {
  const legDirectory = path.join(directory, leg);
  mkdirSync(legDirectory, { recursive: true });
  for (const [index, step] of planLeg(job, leg, port).entries()) {
    const file = path.join(legDirectory, String(index + 1).padStart(2, "0"));
    if (step.kind === "skip") {
      writeFileSync(`${file}.skip`, `${step.label}\t${step.reason}\n`);
    } else {
      writeFileSync(`${file}.sh`, `# ${step.label}\n${scriptText(step)}`);
    }
  }
}
