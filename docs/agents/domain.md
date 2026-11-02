# Domain Docs

How the engineering skills consume this repo's domain documentation. This repo
does not use GLOSSARY.md or docs/adr/: its decisions and vocabulary already live
in the docs below, and a second copy would drift from them (CLAUDE.md §Derive,
don't mirror). Do not create GLOSSARY.md, GLOSSARY-MAP.md or docs/adr/.

## Before exploring, read these

- **`docs/decisions.md`**: the decision log, one `D-NN` row per decision. It
  plays the role of ADRs. Read the rows that touch the area you're working in.
- **`docs/product.md` §Lexicon** and **§Voice**: the user-facing vocabulary
  (the Closet, a Kit, the Call, Verdict, Conditions, Mileage, "useful", never
  "like") and the words the product doesn't use.
- **`docs/contracts.md`**: the entity model and shared TypeScript contracts,
  which hold the internal names (`outfit_entries`, `wardrobe_items`, …).

`design/` and `plan/` are read-only archives. They are not domain docs.

## Use the project's vocabulary

UI copy uses the Lexicon. Code, issues, test names and refactor proposals use
the internal identifiers from `docs/contracts.md`. Don't switch to synonyms the
Voice section rules out. If you need a concept that has no name yet, raise it;
don't invent one.

## Recording decisions and terms

When `/domain-modeling` or another skill wants to write an ADR, append a `D-NN`
row to `docs/decisions.md` instead, using the next free number and its format
(what was decided, what it overrode, why). A new user-facing term is a
wording change, which CLAUDE.md treats as stop-and-ask: put it to the owner
before it goes into `docs/product.md`.

## Flag decision conflicts

If your output contradicts a decision, say so explicitly; don't override it
silently:

> _Contradicts D-05 (per-run verdict), but worth reopening because…_
