#!/bin/sh
# Seeds the local Stryker cache from CI (guardrails-core 0.14.0,
# `mutationCache.seedFrom`). The gate runs this with GUARDRAILS_SEED_DIR set
# to an empty directory and reads every report it leaves there.
#
# Mutation's run on `main` uploads one `stryker-incremental-<shard>` artifact
# per shard that reached 100 (.github/workflows/mutation.yml). Every artifact
# here comes from one run, so the shards agree on their sources.
#
# Not the run on the merge-base itself: `main` runs queue behind each other
# and a newer push replaces a pending one, so most merge commits never get a
# run. The newest completed `main` run whose commit this branch contains is
# the closest honest measurement. Guardrails checks each report's
# fingerprint (stryker version, config, lockfile) and drops any kill whose
# test file this branch changed, so an older run can't vouch for a newer
# test.
set -eu
: "${GUARDRAILS_SEED_DIR:?}"
for run in $(gh run list --workflow mutation.yml --branch main --event push \
  --status completed --limit 10 --json databaseId,headSha \
  --jq '.[] | "\(.databaseId):\(.headSha)"'); do
  sha=${run#*:}
  if git merge-base --is-ancestor "$sha" HEAD 2>/dev/null; then
    # A run from before the upload step, or one whose every shard failed,
    # has no artifact; try the next older one.
    if gh run download "${run%%:*}" --pattern 'stryker-incremental-*' \
      --dir "$GUARDRAILS_SEED_DIR" 2>/dev/null; then
      exit 0
    fi
  fi
done
echo "no completed mutation run on main that this branch contains has a seed" >&2
exit 1
