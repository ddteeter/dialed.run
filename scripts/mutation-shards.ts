/**
 * The Mutation workflow's shard list (`.github/workflows/mutation.yml`,
 * the `scopes` job; design 259).
 *
 *   tsx scripts/mutation-shards.ts              every shard (a push to main)
 *   tsx scripts/mutation-shards.ts <changes>    the shards a PR's diff can affect
 *
 * `<changes>` holds `git diff --name-status --no-renames` output. Prints the
 * matrix as one line of JSON, `[{ mutate, name, slug }]`, and says on stderr
 * why each shard was kept. The decisions are in `mutation-shards/select.ts`.
 */
import { readFileSync } from "node:fs";

import strykerConfig from "../stryker.conf.json";
import { readGraph } from "./mutation-shards/graph";
import {
  keptShards,
  parseNameStatus,
  selectShards,
  shardsOf,
} from "./mutation-shards/select";

const shards = shardsOf(strykerConfig.mutate);
const [changesFile] = process.argv.slice(2);

if (changesFile === undefined) {
  console.log(JSON.stringify(shards));
} else {
  const changes = parseNameStatus(readFileSync(changesFile, "utf8"));
  const selection = selectShards(shards, changes, await readGraph());
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
