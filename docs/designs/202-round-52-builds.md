# Design: 202 round 52 builds

## Problem

Round 52 ruled six accessibility items the transcripts for #582 found.
Each changes what a screen reader is given and nothing that is drawn.

## Approach

Two PRs. The rulings are the latest comment on each issue.

**PR 1: names and roles.**

- **#589 (R52·157).** On a search row the Follow pill's name carries the
  handle, visually hidden, in all four states. `FollowPill` takes the
  handle as a prop; `RunnerSearch` passes it and H's header does not.
- **#592 (R52·159).** A2's second button is named "Change the kit"; the
  visible word stays "Change" (`AttachKit.tsx`).
- **#593 (R52·160).** The Delete account row is one button named "Delete
  account", described by its sentence, with the right-edge "Delete"
  `aria-hidden` (`DeleteAccount.tsx`).
- **#594 (R52·161).** The log-flow launcher drops `aria-haspopup` in
  `TabBar.tsx` and `TopBar.tsx`. The controls that open real dialogs keep
  it. Every phone transcript's tab bar line changes, and the VoiceOver
  script's step 2.1.

**PR 2: measured lines.** #591 (R52·158) with #567 (R52·155), since the
Desk's run line is in both. Its inventory and its one `lib/` function are
added to this doc in that PR.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: none redrawn. The Accessibility Contract's new rows are the
  coordinator's import.

## Test plan

- dom: the pill's name with and without a handle, at rest and in flight
  (`feed-profiles.dom.test.tsx`); "Change the kit"
  (`attach-kit.dom.test.tsx`); the Delete row's name and description
  (the account settings' dom test); the launcher without the attribute
  (`top-bar`, `layout`, `motion-surfaces`, `ui.test.tsx`).
- e2e: no new test. The transcripts that end on these controls change,
  and are named in the PR.

## Issues

- Closes: #589, #592, #593, #594 (PR 1); #591, #567 (PR 2).

## Open questions

- R52·157 writes the in-flight names with an ellipsis ("Following
  @handle…") and its example ends "button, pressed". The pill has neither
  today, on H or on a row: in flight its brackets are hidden and
  `aria-busy` says it is working, and the followed state is its name,
  with no `aria-pressed`. Built as "Following @handle", busy, and not
  pressed. Sent to the coordinator: whether the mark and the pressed
  state are wanted, which would change H's pill too.
- R52·160's row is built as a button laid over the row, holding no text.
  With the sentence inside the button its visible text was more than its
  name, which axe reports (WCAG 2.5.3, label-content-name-mismatch). It
  is heard as ruled and drawn as before.
