#!/bin/sh
# Where this repo's git worktrees live, and how they are made, removed and
# pruned. See docs/workflow.md §Worktrees.
#
#   worktrees.sh create        WorktreeCreate hook: reads {"name"} on stdin,
#                              prints the new worktree's path as the only
#                              line of stdout
#   worktrees.sh remove        WorktreeRemove hook: reads {"worktree_path"}
#   worktrees.sh prune [--yes] lists every worktree and local branch whose PR
#                              has merged or closed; --yes removes them
#
# DIALED_WORKTREES_DIR overrides the directory.
#
# ---- Why outside the repo ---------------------------------------------------
#
# Claude Code's default is `.claude/worktrees/<name>`, inside the checkout, so
# every tool that globs from the root sees a full second copy of the project
# per worktree and must be told not to. dependency-cruiser is; tsc, prettier,
# vitest, knip and fallow happen not to look; `eslint .` does, because flat
# config does not read .gitignore: `npm run lint` in the primary checkout
# linted ~2,200 extra files per nested worktree (measured 2026-10-24). A
# sibling `<repo>-worktrees/` is out of every glob's reach, with no ignore
# entry to keep in step.
#
# ---- Why shell ---------------------------------------------------------------
#
# A hook can fire in a checkout with no node_modules, so this may not depend on
# a package; and a TypeScript file under the repo's eslint config may not run
# git (sonarjs/no-os-command-from-path), which is the whole job. Like
# .githooks/, it is POSIX sh. The one JSON read is a `node -e`, since a hook's
# input is JSON and jq is not a given.

set -eu

# One string field of the hook's JSON input on stdin; fails when it is absent,
# empty or not a string.
hook_field() {
  node -e '
    const input = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const value = input === null ? undefined : input[process.argv[1]];
    if (typeof value !== "string" || value === "") {
      console.error(`hook input has no string ${process.argv[1]}`);
      process.exit(1);
    }
    process.stdout.write(value);
  ' "$1"
}

# The primary checkout: the directory holding the shared .git.
primary_checkout() {
  dirname "$(git -C "${1:-.}" rev-parse --path-format=absolute --git-common-dir)"
}

# <repo>-worktrees/ beside the primary checkout, made if missing and resolved
# to a physical path: Claude Code refuses a hook's path with `..` segments or
# one that passes through a symlink.
worktrees_dir() {
  dir=${DIALED_WORKTREES_DIR:-$(dirname "$1")/$(basename "$1")-worktrees}
  mkdir -p "$dir"
  (cd "$dir" && pwd -P)
}

# Untracked files a worktree needs, copied from the primary checkout. The list
# is the new worktree's own .worktreeinclude (tracked, so it comes with the
# checkout), one plain path per line: no globs, no negation. Claude Code copies
# that list itself only when it makes the worktree, which this hook replaces.
copy_includes() {
  [ -f "$2/.worktreeinclude" ] || return 0
  grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$2/.worktreeinclude" |
    while IFS= read -r entry; do
      [ -e "$1/$entry" ] || continue
      mkdir -p "$(dirname "$2/$entry")"
      cp -R "$1/$entry" "$2/$entry"
    done
}

create() {
  name=$(hook_field name)
  case $name in
    .* | *[!A-Za-z0-9._-]*) echo "bad worktree name: $name" >&2; exit 1 ;;
  esac
  repo=$(primary_checkout)
  worktree=$(worktrees_dir "$repo")/$name
  # Offline: branch from the last fetched origin, as Claude Code does.
  git -C "$repo" fetch --quiet origin >&2 || true
  base=$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
  # --no-track: an upstream of origin/main would make a bare `git push` from
  # the new branch aim at main.
  git -C "$repo" worktree add --no-track -b "worktree-$name" "$worktree" "$base" >&2
  copy_includes "$repo" "$worktree" >&2
  echo "$worktree"
}

# Removes the worktree, and its branch when it is the worktree-<name> one
# `create` made. A branch the session switched to may hold work; prune deletes
# it once its PR merges.
remove() {
  worktree=$(hook_field worktree_path)
  repo=$(primary_checkout "$worktree")
  branch=$(git -C "$worktree" branch --show-current)
  git -C "$repo" worktree remove --force "$worktree"
  case $branch in
    worktree-*) git -C "$repo" branch -D "$branch" ;;
  esac
}

# Each head branch's PR state from one gh call, as "<branch> <state>" lines. A
# branch with several PRs keeps the most alive (OPEN > MERGED > CLOSED), so a
# reopened branch is never pruned.
pr_states() {
  gh pr list --state all --limit 2000 --json headRefName,state \
    --jq '.[] | "\(.headRefName) \(.state)"' |
    awk '
      { rank = $2 == "OPEN" ? 3 : $2 == "MERGED" ? 2 : 1
        if (rank > best[$1]) { best[$1] = rank; state[$1] = $2 } }
      END { for (b in state) print b, state[b] }
    '
}

state_of() {
  awk -v b="$1" '$1 == b { print $2 }' "$states"
}

is_done() {
  case $(state_of "$1") in MERGED | CLOSED) return 0 ;; *) return 1 ;; esac
}

# Uncommitted work, ignoring the PR_BODY.md draft an agent leaves behind.
is_dirty() {
  git -C "$1" status --porcelain | grep -v -x '?? PR_BODY.md' | grep -q .
}

prune() {
  apply=${1:-}
  repo=$(primary_checkout)
  cd "$repo"
  states=$(mktemp)
  held=$(mktemp)
  trap 'rm -f "$states" "$held"' EXIT
  pr_states >"$states"
  { echo main; git branch --show-current; } >"$held"
  verb() { if [ "$apply" = --yes ]; then echo "$2"; else echo "$1"; fi; }

  git worktree list --porcelain |
    awk '/^worktree /{p=substr($0,10)} /^branch /{b=substr($0,19)} /^locked/{l=1}
         /^$/{print p "\t" b "\t" l; p=""; b=""; l=""} END{if(p!="")print p "\t" b "\t" l}' |
    while IFS="$(printf '\t')" read -r path branch locked; do
      [ "$path" = "$repo" ] && continue
      [ -n "$branch" ] && echo "$branch" >>"$held"
      if [ -z "$branch" ] || ! is_done "$branch"; then
        echo "keep     $path (${branch:-detached}: no merged PR)"
      elif is_dirty "$path"; then
        echo "keep     $path (uncommitted changes)"
      else
        echo "$(verb 'remove  ' 'removed ') $path + $branch"
        if [ "$apply" = --yes ]; then
          if [ -n "$locked" ]; then git worktree unlock "$path"; fi
          git worktree remove --force "$path"
          git branch -D "$branch" >/dev/null
        fi
      fi
    done

  git for-each-ref --format='%(refname:short)' refs/heads |
    while IFS= read -r branch; do
      grep -q -x -F "$branch" "$held" && continue
      if ! is_done "$branch"; then
        # No PR and nothing unpushed is an agent's empty worktree-* branch:
        # deleting it loses no commit. Anything else is kept.
        [ -n "$(state_of "$branch")" ] && continue
        [ "$(git rev-list --count "$branch" --not --remotes)" = 0 ] || continue
      fi
      echo "$(verb 'delete  ' 'deleted ') branch $branch"
      if [ "$apply" = --yes ]; then git branch -D "$branch" >/dev/null; fi
    done

  if [ "$apply" != --yes ]; then printf '\nNothing changed. Run with --yes to apply.\n'; fi
}

case ${1:-} in
  create) create ;;
  remove) remove ;;
  prune) prune "${2:-}" ;;
  *) echo "usage: worktrees.sh create|remove|prune [--yes]" >&2; exit 2 ;;
esac
