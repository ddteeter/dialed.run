#!/bin/sh
# `npm run diagrams:audit` (design 229, step 5; skill diagram-audit).
#
#   due                 which flows are due an audit: never audited, or
#                       answered "re-read" in several merged PRs since
#   brief <flow file>   the deriving reader's brief
#   story <flow file>   the story, for the comparing reader
#
# POSIX sh for the gh calls, as in diagram-stale.sh: a TypeScript file
# under the repo's eslint config may not spawn a command. `due` hands
# scripts/diagram-audit.ts the merged PRs whose bodies hold Diagrams and the
# audit record issues, as one JSON object in a temporary file (a large
# body piped on stdin can come back EAGAIN from a non-blocking read).

set -eu

if [ "${1:-}" = "due" ]; then
  fetched=$(mktemp)
  trap 'rm -f "$fetched"' EXIT
  {
    printf '{"prs":'
    gh pr list --state merged --search 'Diagrams in:body' --limit 1000 \
      --json number,mergedAt,body
    printf ',"audits":'
    gh issue list --state all --search '"Diagram audit:" in:title' \
      --limit 1000 --json title,createdAt
    printf '}'
  } >"$fetched"
  tsx scripts/diagram-audit.ts due "$fetched"
else
  tsx scripts/diagram-audit.ts "$@"
fi
