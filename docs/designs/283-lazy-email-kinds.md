# Design: 283 the email kinds are built on use

> #570 for `src/lib/contracts/email-kinds.ts`, after #1080 (the email
> shard hit the 240-minute cap) and #1081 (the cap is 360 as a stopgap).
> Behaviour-neutral: every schema accepts and returns exactly what it does
> now. **Needs owner** before anything is built (§Open questions).

## Problem

`email-kinds.ts` builds 22 zod objects at module scope, so its ~100 mutants
are static: each one re-runs every test file related to the file, with a
fresh environment. 275 of the 673 test files reach it at runtime
(depcruise, type-only imports left out), so the file alone took about 3 h 40
cold on a PR (#1084). No shard split can reach inside one file.

## Measured: who needs the schemas eagerly

| caller                                                                                                    | takes                                                      | needs a built schema at load?                    |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| `lib/contracts/email.ts:62-107`                                                                           | the 22 kinds, `address`                                    | yes: three module-scope schemas                  |
| `lib/sql/outbox.ts:135`                                                                                   | `emailPayloadSchema`, inside the module-scope outbox union | yes; `outboxKinds` reads that union's `.options` |
| `account/verification/verification.ts:195`                                                                | `address.safeParse`, inside a function                     | no                                               |
| `safety/rules/contracts.ts`, `email/content.ts`                                                           | three string constants only                                | no, but the import runs the whole file           |
| `email/deliver.ts`, `email/content.ts`                                                                    | `EmailKind`, `EmailTemplate` (types)                       | no                                               |
| `test/lib/email.test.ts`, `test/email/deliver.test.ts` (`.options`), `test/safety/takedown-abuse.test.ts` | the schemas as values                                      | no: a call works as well                         |

Cutting the two constant-only imports narrows the related set only from 275
to 252 files, so that alone is not the fix (#570 option 2).

## Approach (recommended)

1. `email-kinds.ts` exports each kind as a function that builds it
   (`verifyEmail()`), and `email.ts` exports `emailTemplateSchema()`,
   `emailRecipientSchema()` and `emailPayloadSchema()`, each **built fresh
   on every call, never cached**. Types become
   `z.infer<ReturnType<typeof emailTemplateSchema>>`: the same types.
   `address` becomes a builder too. The three string constants stay as they
   are (3 static mutants).
2. `lib/sql/outbox.ts` keeps its union eager, so `outboxKinds` is
   unchanged. The `email` field becomes `z.unknown().transform()`, which
   parses through a fresh `emailPayloadSchema()` and passes on its issues and
   its output. It accepts the same rows and returns the same stripped data.
   `readOutboxRow` already discards the issues.
3. The tests call the builders. One new test pins the outbox: the same
   good row, extra keys and bad row parse as they do on `main`.

**Why fresh, not cached.** Stryker's vitest runner (10.1.1) runs a
non-static mutant against only the tests that covered it, filtered by test
id. A cached build, or `z.lazy` (which caches its getter), runs the mutated
code once per file, so only each file's first test would count as covering
it. That gives false survivors. A fresh build costs about 0.2 ms per parse
(measured shallowly, by re-wrapping the 22 objects), once per outbox row
or send.

**Expected effect.** About 97 statics become ordinary mutants, each run
against the tests that parse an email (17 test files name these schemas or
the outbox read) instead of 275 reloaded files. The build's first step
measures this with a Stryker run of `email-kinds.ts` alone and the `json`
reporter (#570 option 1). The PR states the static count and the cold
time, at a 100% score.

## Contract touches

- Schema (D1): **none**. Bindings, queues, crons: **none**. Screens: none.
- The email wire format (`email.ts`, design 126's published interface)
  changes from schema values to builder functions. What it accepts does not.

**Rejected:** a cached builder or `z.lazy` (false survivors, above);
getter fields in the outbox shape (whether zod re-reads them depends on its
internals); `ignoreStatic` and higher timeouts (ruled out on #570).

## Issues

- Addresses #570 (its email part) and follows #1081. Opens #1146, the
  owner question below.

## Open questions

- **Owner:** may the email contract's schemas become builder functions, and
  the outbox's `email` field a transform, as §Approach says? It costs about
  0.2 ms per email parse and a call at every caller. It should take the
  email shard from about 3 h 40 cold to well under the old 240 minutes, so
  the cap could later return to 240. Recommended: yes.
