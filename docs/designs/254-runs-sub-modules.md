# Design: 254 runs sub-modules

> Wave 16, lane 16d's second PR. Closes #887. A move PR, as design 240
> rules them: paths and imports only.

## Problem

`runs` holds two folders that are sub-modules in all but the `index.ts`
(`strava/`, `garmin/`), next to `parsers/`, which already is one. #887 asks
for their doors, and whether the import consumer and the upload path make
a third. Nothing a runner sees changes.

## Approach

Measured on main at `cd21f7ad`, from the imports as dependency-cruiser
reads them.

**Three sub-modules, not four.** The upload path is one: `imports.ts` and
`import-polling.ts` become `runs/imports`. The consumer cannot join it.
`consumer.ts` imports `garmin/config.ts`, and `garmin/service.ts` imports
`imports.ts` (`startImport`, the queue producer type), so the two in one
unit make a cycle between doors. The consumer is also more than the
import queue: it settles Strava deauthorizations and reminders too. It
stays beside the parent's `index.ts`, as the place the three meet.

| unit           | service files                                                                                                                 | components                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `runs/strava`  | `api`, `api-from-env`, `deauthorize`, `oauth`, `prune`, `reminder-email`, `reminder-match`, `webhook`, in place               | `StravaConnect`, `StravaCallbackResult`, `StravaRemindersLine`, `ReminderDayLine`                               |
| `runs/garmin`  | `api`, `config`, `service`, `unzip`, in place                                                                                 | `GarminImport`                                                                                                  |
| `runs/imports` | `imports.ts`, `import-polling.ts`                                                                                             | `UploadForm`, `ParsedCard`                                                                                      |
| `runs/parsers` | unchanged                                                                                                                     |                                                                                                                 |
| `runs`         | `service`, `consumer`, `queue-messages`, `upload-limits`, `core-db` and the other small reads; `index`, `functions`, `inputs` | `ConditionsBlock`, `RunDetail`, `RunList`, `SetConditionsSheet`, `ManualRunForm`, `DeleteRun`, `VerdictBacklog` |

The units' service imports run one way: `garmin -> imports`, and every
sub-module may read the parent's files (`core-db`, `queue-messages`,
`service`, `upload-limits`), which `sub-modules-meet-at-the-door` does
not hold. `upload-limits.ts` stays in the parent: `parsers`, `garmin`,
`imports` and `inputs.ts` all read it, and in `imports` it would put a
door that reaches `env` between `parsers` and a number.

**The parent's own files go through the doors** (`index.ts`,
`consumer.ts`, `functions.ts`), as the CLAUDE.md paragraph says the rest
of a module does. Safety's parent files import files instead, only
because its `rules` door would otherwise have been 50 names. Here the
widths are small: `strava` about 22 names, `imports` 5, `garmin` 4.
Components import files, as always. Routes keep their imports of
`strava/oauth.ts`, `strava/api-from-env.ts` and `strava/webhook.ts`: those
paths do not change.

**Shared files.** `stryker.conf.json`: `imports.ts` and `import-polling.ts`
leave the runs list for `runs/imports/**/*.ts`. Architecture tests that
name a moved component (`failure-path-is-static`,
`routes-stamp-hydration`). The import flow's `// source:` comments in
`docs/diagrams/flows/import.c4` follow `imports.ts` and
`import-polling.ts`; `npm run diagrams:generate`; `npm run modules:pin`
(runs is at the files budget, 50, and leaves it).

## Contract touches

- Schema: **none**. Routes: none new; four change a component path.
  Bindings, queues, crons: **none**.
- **Forbidden zone, granted by the owner (one-time, 2026-11-19, on #887):** `guardrails.config.json` keys
  two `fallow-ignore` grants by path (`runs/imports.ts`,
  `runs/components/ParsedCard.tsx`), and both files move. Path only.
- Waits for #909 (15d, in `runs/parsers/`), which this PR does not touch.

## Test plan

No new behaviour. Full `npm test` (the architecture tests are
default-deny), `diagrams:check`, the commit gate's dependency-cruiser,
`npm run build`, and `npm run e2e:ci` on both legs.

## Issues

- Closes #887. Opens: none expected.

## Open questions

- The name `runs/imports` (the issue says "the upload path"); a guess the
  reviewer may veto.
