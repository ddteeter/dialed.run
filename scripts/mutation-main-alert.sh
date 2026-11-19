#!/bin/sh
# Main's Mutation result, where a coordinator will see it (#876; resilience
# law 6). Run by `.github/workflows/mutation.yml`'s `main-status` job after
# every Mutation run on a push to main:
#
#   sh scripts/mutation-main-alert.sh <run id> <success|failure> <commit>
#
# failure: comments on the open "Mutation is red on main" issue with the
#          run, the commit and the shards that failed, or opens that issue.
# success: closes the open issue, if there is one, saying which run is green.
#
# Re-runnable (law 1): a run already named in the issue is not reported
# twice. DRY_RUN=1 prints what it would do and changes nothing, so it can
# be tried locally against a past run. Needs `gh` with issues:write and
# actions:read.
set -eu

run=${1:?run id}
result=${2:?success or failure}
commit=${3:?commit}
title="Mutation is red on main"
repo=${GH_REPO:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
url="https://github.com/$repo/actions/runs/$run"

act() {
  if [ "${DRY_RUN:-}" = 1 ]; then
    echo "dry run: gh $*"
  else
    gh "$@"
  fi
}

open=$(gh issue list --repo "$repo" --state open --search "\"$title\" in:title" \
  --json number,title --jq "map(select(.title == \"$title\")) | .[0].number // empty")

if [ -n "$open" ] && gh issue view "$open" --repo "$repo" --json body,comments \
  --jq '.body, .comments[].body' | grep -qF "actions/runs/$run"; then
  echo "run $run is already on #$open"
  exit 0
fi

case "$result" in
failure)
  shards=$(gh run view "$run" --repo "$repo" --json jobs --jq '.jobs[]
    | select(.name | startswith("Mutation score"))
    | select(.conclusion != "success" and .conclusion != "skipped")
    | "- \(.name): \(.conclusion) (\(.url))"')
  body=$(printf '%s\n\n%s\n\n%s\n' \
    "Main's Mutation run $url went red on $commit." \
    "${shards:-No shard failed: the scopes job or the gate itself did. See the run.}" \
    "Fix forward: a survivor here turns every PR that touches the file red (\`mutation.yml\`'s header). This issue closes itself when a run on main is green again.")
  if [ -n "$open" ]; then
    act issue comment "$open" --repo "$repo" --body "$body"
  else
    act issue create --repo "$repo" --title "$title" --body "$body" \
      --label area:testing --label kind:build --label sev:important
  fi
  ;;
success)
  if [ -n "$open" ]; then
    act issue close "$open" --repo "$repo" --comment "Main's Mutation run $url is green on $commit."
  else
    echo "main is green and no alert is open"
  fi
  ;;
*)
  echo "mutation-main-alert: result must be success or failure, not $result" >&2
  exit 2
  ;;
esac
