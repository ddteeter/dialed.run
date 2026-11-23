/**
 * The Mutation workflow's shard list (`.github/workflows/mutation.yml`,
 * the `scopes` job; design 259).
 *
 *   tsx scripts/mutation-shards.ts                      every shard (a push to main)
 *   tsx scripts/mutation-shards.ts <changes> <reports>  the shards a PR's diff can affect
 *
 * `<changes>` holds `git diff --name-status --no-renames` output, and
 * `<reports>` is where `scripts/main-mutation-reports.sh` put main's shard
 * reports (a missing one keeps its shard). Prints the
 * matrix as one line of JSON, `[{ mutate, name, slug }]`, and says on stderr
 * why each shard was kept. The decisions are in `mutation-shards/select.ts`.
 */
import { readFileSync } from "node:fs";

import strykerConfig from "../stryker.conf.json";
import { readCoverage } from "./mutation-shards/coverage";
import { readGraph } from "./mutation-shards/graph";
import {
  keptShards,
  parseNameStatus,
  selectShards,
  shardsOf,
} from "./mutation-shards/select";

const shards = shardsOf(strykerConfig.mutate);
const [changesFile, reportsDirectory] = process.argv.slice(2);

if (changesFile === undefined) {
  console.log(JSON.stringify(shards));
} else if (reportsDirectory === undefined) {
  throw new Error("usage: tsx scripts/mutation-shards.ts <changes> <reports>");
} else {
  const changes = parseNameStatus(readFileSync(changesFile, "utf8"));
  const selection = selectShards(
    shards,
    changes,
    await readGraph(),
    readCoverage(reportsDirectory, shards),
  );
  if (selection.kind === "all") {
    console.error(`Every shard: ${selection.reason}.`);
  } else {
    for (const [name, why] of selection.kept) console.error(`${name}: ${why}`);
    console.error(
      `${String(selection.kept.size)} of ${String(shards.length)} shards.`,
    );
  }
  console.log(JSON.stringify(keptShards(shards, selection)));
}
