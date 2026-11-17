#!/bin/sh
# `npm run diagrams:stale` (design 229, step 3): lists the stories that cite
# a file this branch changed since it left origin/main, committed or not.
# Skill pr-ready runs it, and the PR body says whether each was updated or
# re-read. It reports; it never fails.
#
# POSIX sh for the git calls, as in worktrees-prune.sh: a TypeScript file
# under the repo's eslint config may not spawn git
# (sonarjs/no-os-command-from-path). scripts/diagram-stale.ts reads the
# paths on stdin.

set -eu

base=$(git merge-base HEAD origin/main)
{
  git diff --name-only "$base"
  git ls-files --others --exclude-standard
} | tsx scripts/diagram-stale.ts
