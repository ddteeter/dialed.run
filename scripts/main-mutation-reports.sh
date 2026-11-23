#!/bin/sh
# Finds the shard reports main's Mutation runs measured under a dependency
# digest, and copies each to <out>/<slug>/stryker-incremental.json:
#
#   sh scripts/main-mutation-reports.sh <digest> <out> <slug>   one shard
#   sh scripts/main-mutation-reports.sh <digest> <out>          every shard
#
# The runs are main's completed push runs whose commit is in main's history
# as fetched (scripts/main-mutation-runs.sh), newest first, red or green. A
# report counts when the artifact downloads, the digest recorded beside it
# is <digest> (a stryker or vitest bump invalidates every stored result),
# and it is a regular file that jq reads as a report.
#
# For one shard, the newest run with a report for it: a PR shard's seed
# (.github/workflows/mutation.yml, "Seed from main's report"). For every
# shard, one download of the newest run that has any: the shard selector's
# coverage (design 259). A main run is not cancelled, so the newest has
# every shard's report, and a shard it lacks is one the selector keeps.
#
# Prints "<slug> <run>" for each report it copies. Exits 1 only when main's
# runs cannot be listed; a report that is not found is simply not printed.
set -eu
digest=$1
out=$2
slug=${3:-}
runs=$(sh "$(dirname "$0")/main-mutation-runs.sh" refs/remotes/origin/main 20)
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
for run in $runs; do
  rm -rf "$work/run"
  if [ -n "$slug" ]; then
    gh run download "$run" --name "stryker-incremental-$slug" \
      --dir "$work/run/stryker-incremental-$slug" 2>/dev/null || continue
  else
    gh run download "$run" --pattern 'stryker-incremental-*' \
      --dir "$work/run" 2>/dev/null || continue
  fi
  found=false
  for artifact in "$work/run"/stryker-incremental-*; do
    report="$artifact/stryker-incremental.json"
    name=${artifact##*/stryker-incremental-}
    [ "$(cat "$artifact/stryker-deps.txt" 2>/dev/null)" = "$digest" ] || continue
    [ -f "$report" ] && [ ! -L "$report" ] || continue
    jq -e '.files | type == "object"' "$report" >/dev/null 2>&1 || continue
    mkdir -p "$out/$name"
    mv "$report" "$out/$name/stryker-incremental.json"
    echo "$name $run"
    found=true
  done
  [ "$found" = true ] && exit 0
done
exit 0
