# Tasks 121–124 — Build to rounds 21–23 (four parallel lanes)

Design rounds 21, 22 and 23 answered the reconciliation and coverage requests:
every state the app renders now has a drawing or a ruling. These four lanes
build the app to match, one area each, in parallel worktrees:

| task | lane                                                       | packet               |
| ---- | ---------------------------------------------------------- | -------------------- |
| 121  | Logging — A1, A2, A3, DS2, runs, Strava                    | `121-logging.md`     |
| 122  | Closet — C, F, edit, garment detail                        | `122-closet.md`      |
| 123  | Feed & social — E1/E2, D, G/H, search, notifications, bell | `123-feed-social.md` |
| 124  | Auth, shell, onboarding, settings, safety, the Call teaser | `124-auth-shell.md`  |

## Read first

1. `CLAUDE.md`, then your packet.
2. `docs/design-deltas.md` — "Answered in round 21", "Answered in round 22"
   (which includes round 23's item-9 addendum). These are the rulings.
3. `docs/reconciliation/2026-09-23-design-coverage.md` — the inventory your
   screens appear in, and the build bugs (D-102) your lane owns.
4. The boards your packet names. **Round 22's drawings are not yet folded into
   the screen boards**: they live in `design/Round 22 Coverage.dc.html` and
   `design/Auth.dc.html`, each section marked with the board it will fold into
   (`data-board`). Their `data-screen-label`, `data-part` and `data-state`
   marks are final — diff against them.

## The shared pieces already exist — use them, never copy them (task 120)

- `ui/FileWell` — the one well: empty, drag-over, uploading, error, filled
  (preview + Replace + Remove). Every photo and file input is this.
- `ui/useControlAction` + `ui/ControlFailureBand` — round 23, item 9. Any
  control that fails outside a form: no optimistic update, the in-flight label
  while it waits, the band directly under it with the kicker naming what is
  still true (`NOT MARKED`, `STILL BLOCKED`, `NOTHING ATTACHED`, …). Useful on
  D is the worked example.
- `ui/FormFailureBand` / `FailureBand` — forms, and read failures ("Didn't
  load").
- `ui/PhotoStep` + `photoBlurStep` — any screen taking a photo takes W3's
  blur through this slot.

**Changing one of these is not a lane decision.** If your screen needs
something they cannot do, stop and say so in your PR (or ask the
coordinating session). Four lanes each patching `FileWell` is exactly what
task 120 existed to prevent.

## Rules for running in parallel

- **Stay in your ownership list.** Another lane owns everything else. If you
  need a change outside it, write it down in the PR body under "Needs from
  other lanes" — do not make it.
- **No schema changes are expected.** If you find you need one, stop and ask
  (CLAUDE.md schema protocol).
- **Do not edit `docs/deferred.md` or `docs/design-deltas.md`.** Every lane
  editing those tables conflicts on every merge (prettier re-pads the whole
  table). Put deferrals and design questions in your PR body under
  "Register" and "Design deltas"; the coordinator folds them in at merge.
- **Before your first push**, `git fetch origin && git branch -f main
origin/main` — a new branch's push gate diffs against local `main`, and a
  stale one mutates files you never touched (memory:
  stale-local-main-widens-push-gate).
- **One push at a time on this machine.** The push gate runs ~26 minutes and
  concurrent gates starve each other into spurious dry-run failures. If
  another lane's gate is running (`ps aux | grep "gate --mode=push"`), wait.
- Small commits; each passes the commit gate. Mutation stays at 100%.

## Done, for every lane

- Every screen in your packet matches its drawing or ruling, in every drawn
  state and at both widths where one is drawn.
- **A conformance spec per screen you rebuilt** (`e2e/conformance/`, using
  `e2e/support/conformance.ts`): cells, fills and alignments compared against
  the round-22 frame, not asserted from memory. A3's spec is the model.
- Your feature demos re-recorded and attached.
- The D-102 bugs your packet lists, fixed with a test each.
- `npm run verify && npm test && npm run build` green; PR checks green.
- PR body: a table of screen → states built → conformance spec; "Needs from
  other lanes"; "Register"; "Design deltas" (undesigned surfaces, if any).
