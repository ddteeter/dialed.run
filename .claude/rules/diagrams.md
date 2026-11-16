---
paths:
  - "docs/diagrams/**"
---

# Architecture diagrams

Loaded when you touch `docs/diagrams/`, the LikeC4 model of the system
(design 229). Load skill `architecture-diagrams` before you change it: it
holds the kinds, how a story states its guards and recovery, and the
validate, render, look loop.

- **`npm run diagrams:check` passes before you commit.** It validates the
  model with no warnings and checks the formatting; `npm run
diagrams:format` fixes the formatting. `npm run diagrams` opens the
  viewer.
- **`structure.generated.c4` is never edited.** It is the databases,
  buckets, queues, crons and modules, and the imports between modules,
  written by `npm run diagrams:generate`. Run it when a binding, a cron, a
  module or a cross-module import changes;
  `test/architecture/diagram-structure.test.ts` fails until you do. A
  generated element's description is a line in `structure.words.json`.
  The generator also throws on a new `wrangler.jsonc` key, handler on
  `main`, or folder beside `src/modules` that it neither draws nor lists:
  draw it, or list it with the reason (skill `architecture-diagrams`).
- **A story is a claim about the code.** Every step carries a
  `// source: <path> <symbol>` comment, and a number in a note is one you
  read in that source.
- **Nothing rendered is committed**: no PNG, no `dist/`, no exported
  Markdown. `likec4 export markdown` writes a `README.md` into this folder
  whatever `-o` says; delete it.
- **Do not draw how sign-in, sessions or the auth gates work inside**
  (`.claude/rules/publishing.md`).
