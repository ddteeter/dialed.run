#!/bin/sh
# Prints the ids of Mutation's completed push runs on `main`, newest first,
# keeping only a run whose commit is in the history of the ref given:
#
#   sh scripts/main-mutation-runs.sh <ref> <how many runs to look at>
#
# Both seed readers take their runs from here: the local gate's
# (scripts/fetch-mutation-seed.sh, against HEAD) and a PR's shards in CI
# (.github/workflows/mutation.yml, against main as fetched there). The ref
# is passed in full where a tag could share its short name.
set -eu
ref=$1
limit=$2
runs=$(gh run list --workflow mutation.yml --branch main --event push \
  --status completed --limit "$limit" --json databaseId,headSha \
  --jq '.[] | "\(.databaseId):\(.headSha)"')
for run in $runs; do
  if git merge-base --is-ancestor "${run#*:}" "$ref" 2>/dev/null; then
    echo "${run%%:*}"
  fi
done
