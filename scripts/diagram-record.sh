#!/bin/sh
# `npm run diagrams:record` (design 229, step 4): records the views whose
# hash changed since the branch left origin/main, uncommitted changes
# included, and writes diagrams.demo.mp4 at the repo root for
# `ship --attach` (gitignored as *.demo.mp4, and out of reach of a
# Playwright run, which empties test-results/). Skill pr-ready asks for it
# when docs/diagrams/ changed. With no changed view it writes nothing.
#
# POSIX sh for the git calls, as in diagram-stale.sh: a TypeScript file
# under the repo's eslint config may not spawn git
# (sonarjs/no-os-command-from-path). scripts/diagram-record.ts does the rest.

set -eu

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

base=$(git merge-base HEAD origin/main)
mkdir "$work/base"
if git cat-file -e "$base:docs/diagrams" 2>/dev/null; then
  git archive "$base" docs/diagrams | tar -x -C "$work/base"
fi

likec4 build --output-single-file -o "$work/site" docs/diagrams >/dev/null

tsx scripts/diagram-record.ts "$work/base/docs/diagrams" docs/diagrams \
  "$work/site/index.html" "$work" diagrams.demo.mp4
