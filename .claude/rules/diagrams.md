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
- **A story is a claim about the code.** Every step carries a
  `// source: <path> <symbol>` comment, and a number in a note is one you
  read in that source.
- **Nothing generated is committed**: no PNG, no `dist/`, no exported
  Markdown. `likec4 export markdown` writes a `README.md` into this folder
  whatever `-o` says; delete it.
- **Do not draw how sign-in, sessions or the auth gates work inside**
  (`.claude/rules/publishing.md`).
