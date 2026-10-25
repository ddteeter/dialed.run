#!/bin/sh
# Lists every git worktree and local branch whose PR has merged or closed;
# with --yes, removes them. `npm run worktrees:prune [-- --yes]`. See
# docs/workflow.md §Worktrees.
#
# Nothing else cleans these up. Claude Code leaves an isolated agent's
# worktree on disk once the agent has committed, and each one holds about
# 1 GB of node_modules: 27 had piled up to 33 GB by 2026-10-02, and 13 more
# plus 199 local branches by 2026-10-24.
#
# Kept: a worktree with uncommitted changes (a leftover PR_BODY.md draft
# aside), and a branch with no PR that holds commits no remote has.
#
# POSIX sh, like .githooks/: a TypeScript file under the repo's eslint config
# may not spawn git (sonarjs/no-os-command-from-path), which is the whole job.

set -eu

apply=${1:-}
repo=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$repo"
states=$(mktemp)
held=$(mktemp)
trap 'rm -f "$states" "$held"' EXIT

# Each head branch's PR state from one gh call, as "<branch> <state>" lines. A
# branch with several PRs keeps the most alive (OPEN > MERGED > CLOSED), so a
# reopened branch is never pruned.
gh pr list --state all --limit 2000 --json headRefName,state \
  --jq '.[] | "\(.headRefName) \(.state)"' |
  awk '
    { rank = $2 == "OPEN" ? 3 : $2 == "MERGED" ? 2 : 1
      if (rank > best[$1]) { best[$1] = rank; state[$1] = $2 } }
    END { for (b in state) print b, state[b] }
  ' >"$states"

state_of() {
  awk -v b="$1" '$1 == b { print $2 }' "$states"
}

is_done() {
  case $(state_of "$1") in MERGED | CLOSED) return 0 ;; *) return 1 ;; esac
}

is_dirty() {
  git -C "$1" status --porcelain | grep -v -x '?? PR_BODY.md' | grep -q .
}

verb() {
  if [ "$apply" = --yes ]; then echo "$2"; else echo "$1"; fi
}

{ echo main; git branch --show-current; } >"$held"

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
