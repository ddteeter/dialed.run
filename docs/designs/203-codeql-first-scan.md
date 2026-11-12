# Design: 203 CodeQL's first scan

## Problem

The owner turned on CodeQL default setup, and its first scan opened six
alerts, all rated high by the tool: three in shipped code and three in test
or e2e files. Each is read against the code, and fixed where the fix is
small and makes the code plainly right.

## Approach

Verified for all six: nothing in `src/` renders raw HTML (no
`dangerouslySetInnerHTML`), so text reaches a page only through React,
which escapes it. None of the six was exploitable. All six are fixed in
code; none is dismissed.

| alert | file                                    | what the tool saw                                                | outcome                                                                                                     |
| ----- | --------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 6     | `src/modules/safety/rename.ts`          | a random 16-bit value reduced with `%`, which favours low digits | fixed: a draw outside the largest multiple of 10,000 is drawn again, so every placeholder is equally likely |
| 2     | `src/modules/account/licence-text.ts`   | bracketed parts removed once, so brackets could remain           | fixed: a holder's name keeps no angle bracket at all                                                        |
| 1     | `src/modules/account/legal-markdown.ts` | comments removed once, so a comment opener could remain          | fixed: comments are removed until none is left, an unclosed one to the end of the text                      |
| 3     | `test/lib/community-rules.test.ts`      | the test's own copy of alert 1's expression                      | fixed: the test calls the module's function, not a copy                                                     |
| 4, 5  | `e2e/desk/desk-door.spec.ts`            | a test's reading of script tags is case-sensitive                | fixed: it reads them in any case, with any closing tag                                                      |

Inputs, for the record: the placeholder handle is not a secret; licence
texts come from installed packages at build time; legal texts are this
repo's own files.

No CodeQL config, workflow or suppression comment is added.

## Contract touches

- Schema changes, new routes, new bindings, screens: **none**

## Test plan

All vitest, worker project, beside the existing tests of each file:

- `test/safety/moderation-actions.test.ts`: with the random source stubbed,
  a draw at the cut-off is refused and the next one used; the draw just
  under it is used.
- `test/account/licence-text.test.ts`: a holder with nested or stray angle
  brackets comes out with none.
- `test/account/legal-markdown.test.ts`: a comment that removing another
  would form is removed too; an unclosed comment drops the rest; a closer
  before any opener is kept.
- The e2e spec is exercised by its own run. The alerts close when CodeQL
  scans the PR.

## Issues

- Closes: none (the record is a private draft item in the Project).
- Opens: none.

## Open questions

None.
