#!/bin/sh
# `npm run docs:deltas` (#875): every entry in docs/design-deltas/ as one
# document on stdout, in file order, each under a comment naming its file.
# Nothing is written: a generated file every lane regenerated would be the
# shared file the folder exists to avoid. The archive before the folder is
# docs/design-deltas.md.
set -eu
found=0
for entry in docs/design-deltas/*.md; do
  [ "$(basename "$entry")" = README.md ] && continue
  found=1
  printf '<!-- %s -->\n\n' "$entry"
  cat "$entry"
  printf '\n'
done
[ "$found" = 1 ] || echo "docs:deltas: no entries in docs/design-deltas/ yet; the archive is docs/design-deltas.md." >&2
