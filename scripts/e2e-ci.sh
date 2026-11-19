#!/bin/sh
# `npm run e2e:ci` (#877): CI's e2e job, both legs, on this worktree's
# head, under one hold of the machine-wide gate lock. One line per step,
# then one verdict.
#
# What it runs is read out of `.github/workflows/ci.yml` by
# scripts/e2e-ci-plan.ts, so a step CI adds runs here as well. The only
# differences from CI: the machine setup steps are skipped (checkout,
# setup-node, `npm ci`, the Playwright install), and the app runs on a free
# port, with CI's `localhost:3000` in `.dev.vars` moved to it. Each leg
# starts from a fresh local D1, as each CI job does. This worktree's own
# `.wrangler/state`, `.dev.vars` and `.dev.vars.e2e` are set aside and put
# back afterwards. Recorded demo videos in test-results/ are copied out
# first, because any Playwright run deletes that folder.
#
# POSIX sh because a TypeScript file under this repo's eslint config may not
# spawn a command (as scripts/diagram-audit.sh).

set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"
lock="$HOME/.guardrails-gate.lock"

if [ "${E2E_CI_LOCK_HELD:-}" != 1 ]; then
  if ! git diff --quiet HEAD --; then
    echo "e2e:ci: refused: this worktree has uncommitted changes. Commit first, because e2e:ci checks the head you are about to push." >&2
    exit 2
  fi
  for kept in .wrangler/e2e-ci-keep-*; do
    if [ -e "$kept" ]; then
      echo "e2e:ci: refused: $kept holds the local D1 and .dev.vars an interrupted e2e:ci set aside. Move them back (or delete it), then run again." >&2
      exit 2
    fi
  done
  export E2E_CI_LOCK_HELD=1
  echo "e2e:ci: waiting for the gate lock ($lock)"
  if command -v lockf >/dev/null 2>&1; then
    exec lockf -k "$lock" sh "$0" "$@"
  elif command -v flock >/dev/null 2>&1; then
    exec flock "$lock" sh "$0" "$@"
  fi
  echo "e2e:ci: neither lockf nor flock is installed, so the gate lock cannot be taken." >&2
  exit 2
fi

head=$(git rev-parse --short HEAD)
work="${TMPDIR:-/tmp}/e2e-ci-$head-$$"
keep="$root/.wrangler/e2e-ci-keep-$$"
mkdir -p "$work/plan" "$work/logs" "$keep"
echo "e2e:ci: lock held; checking $head (logs in $work/logs)"

npx --no-install tsx scripts/e2e-ci-plan.ts "$work/plan"
port=$(cat "$work/plan/port")
echo "e2e:ci: app on port $port"

if [ -d test-results ] && [ -n "$(find test-results -name '*.mp4' | head -n 1)" ]; then
  mkdir -p "$work/videos"
  find test-results -name '*.mp4' -exec cp {} "$work/videos/" \;
  echo "e2e:ci: copied the demo videos in test-results/ to $work/videos"
fi

# The lane's own local state, and where it is kept meanwhile.
set_aside() {
  if [ -e "$1" ]; then mv "$1" "$keep/$2"; fi
}
put_back() {
  rm -rf "$1"
  if [ -e "$keep/$2" ]; then mv "$keep/$2" "$1"; fi
}
fresh() {
  rm -rf .wrangler/state .dev.vars .dev.vars.e2e
}
restore() {
  put_back .wrangler/state state
  put_back .dev.vars dev.vars
  put_back .dev.vars.e2e dev.vars.e2e
  rmdir "$keep" 2>/dev/null || echo "e2e:ci: $keep still holds files; check it before deleting it." >&2
}
set_aside .wrangler/state state
set_aside .dev.vars dev.vars
set_aside .dev.vars.e2e dev.vars.e2e
trap restore EXIT
trap 'exit 130' INT TERM

verdict() {
  printf 'e2e:ci  %-8s %-8s %7s  %s\n' "$1" "$2" "$3" "$4"
}
elapsed() {
  seconds=$(($(date +%s) - $1))
  printf '%dm%02ds' $((seconds / 60)) $((seconds % 60))
}

red=""
legs=""
for leg in $(cat "$work/plan/legs"); do
  legs="${legs:+$legs and }$leg"
  fresh
  failed=""
  for step in "$work/plan/$leg"/*; do
    case "$step" in
    *.skip)
      verdict "$leg" skip "" "$(cut -f1 "$step") ($(cut -f2 "$step"))"
      ;;
    *.sh)
      label=$(sed -n '1s/^# //p' "$step")
      if [ -n "$failed" ]; then
        verdict "$leg" "not run" "" "$label"
        continue
      fi
      log="$work/logs/$leg-$(basename "$step" .sh).log"
      started=$(date +%s)
      if bash --noprofile --norc -e "$step" >"$log" 2>&1; then
        verdict "$leg" ok "$(elapsed "$started")" "$label"
      else
        verdict "$leg" FAILED "$(elapsed "$started")" "$label"
        tail -n 30 "$log" | sed 's/^/    /'
        echo "    (full log: $log)"
        failed=$label
        red="${red:+$red; }$leg: $label"
      fi
      ;;
    esac
  done
  # The accessibility figure, which only the dev leg measures
  # (e2e/support/a11y-coverage.ts).
  grep -h '^a11y coverage:' "$work/logs/$leg-"*.log 2>/dev/null | sed "s/^/e2e:ci  $leg  /" || true
done

if [ -z "$red" ]; then
  echo "e2e:ci: green: $head passed CI's e2e on $legs"
  exit 0
fi
echo "e2e:ci: red: $head failed $red"
exit 1
