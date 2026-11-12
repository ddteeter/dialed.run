# Design: 201 the followed line

## Problem

On another runner's profile (H) with no shared runs, the second line reads
"Follow @handle and their shared runs will show in your feed." It stays
after the runner taps Follow, still asking for what is done (#590, found
by the transcripts for #582).

## Approach

The owner's wording (2026-11-11, on #590): once the runner is followed, the
second line reads "Their shared runs will show in your feed." "No shared
runs yet." stays above it, and the line before Follow is unchanged.

`OtherProfile.tsx` already holds the follow state (`useFollowToggle`), so
the line reads it. That state is not optimistic: it flips on the server's
answer, so the line turns with the pill and turns back after an unfollow.

**What a screen reader hears at the tap.** The pill's label goes to its
in-flight "Following" and stays "Following" on success; that name change
is the one announcement. The line is not a live region and the screen's
status region stays empty on success, so nothing is said twice. A failure
is as before: "Not following." and the cause, in the status region, with
the line unchanged.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**
- New bindings/queues/crons: **none**
- Screens: H's empty state. A design-deltas note under round 41 #86a,
  whose line this departs from for the followed state.

## Test plan

- dom (`test/modules/feed-profiles.dom.test.tsx`): the line stays while
  the follow is in flight, turns on the answer, turns back after an
  unfollow, opens on the followed line for a runner already followed, and
  is in no live region.
- conformance (`e2e/conformance/feed-gh`): the existing "H after Follow"
  test asserts the line; its transcript changes by that line.

## Issues

- Closes: #590.
- Opens: none.

## Open questions

- None.
