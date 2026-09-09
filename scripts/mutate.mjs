/**
 * Run the mutation ratchet over every scope, one scope at a time.
 *
 * `stryker run` with no arguments reads `mutate` from `stryker.conf.json`,
 * and **silently ignores every entry containing a `!` negation**: an array
 * element is one glob, so `"src/modules/auth/**\/*.ts,!src/modules/auth/functions.ts"`
 * matches a path with a comma in it, which is nothing. Six of the nine
 * scopes are that shape, so a bare `stryker run` was quietly checking
 * `src/lib`, `ops` and `weather` and nothing else — 25 of the 86 files it
 * reports as in scope. Only CI caught the rest, because
 * `.github/workflows/mutation.yml` passes each entry as its own
 * `--mutate` argument and the CLI *does* split that on commas.
 *
 * So this does locally what CI does per shard, from the same single source
 * of truth. It is slow by design; to check one scope while iterating, run
 * that scope's entry directly:
 *
 *   npx stryker run --mutate "src/modules/feed/**\/*.ts,!src/modules/feed/functions.ts"
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const { mutate } = JSON.parse(readFileSync("stryker.conf.json", "utf8"));
const only = process.argv[2];
const scopes = only === undefined ? mutate : mutate.filter((s) => s.includes(only));

if (scopes.length === 0) {
  console.error(`No scope in stryker.conf.json matches "${only}".`);
  process.exit(1);
}

const failed = [];
for (const [index, scope] of scopes.entries()) {
  console.log(`\n=== [${index + 1}/${scopes.length}] ${scope}\n`);
  // Incremental results are keyed to a run's own scope, so a leftover file
  // from the previous scope would be read as "already measured".
  rmSync("reports/stryker-incremental.json", { force: true });
  const result = spawnSync(
    "npx",
    ["stryker", "run", "--mutate", scope],
    { stdio: "inherit" },
  );
  if (result.status !== 0) failed.push(scope);
}

if (failed.length > 0) {
  console.error(`\nBelow 100% in ${String(failed.length)} scope(s):`);
  for (const scope of failed) console.error(`  ${scope}`);
  process.exit(1);
}
console.log(`\nAll ${String(scopes.length)} scopes at 100%.`);
