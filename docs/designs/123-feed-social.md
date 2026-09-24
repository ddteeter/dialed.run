# Design: 123 Feed & social to rounds 21–23

## Problem

Round 22 draws what the feed, post detail, profiles and notifications are in
v1, and rules search and the bell. The build predates it: the card carries
kit and pace, the empty and conditions states are prose, D is a grid with a
banner, G/H hide zeros, M washes unread in hi-viz, and the bell counts the
wrong thing and is missing on the five feed routes (D-102).

## Approach

- **E1** — `feed/components/PostCard.tsx`: author + badge, photo, caption,
  strip (`DIST | TEMP · CONDITION`, `INDOOR`, or one cell), Useful. Useful on
  the card is `useControlAction`, like D. `FeedItem` gains
  `viewerHasReacted`; `FeedPage` gains `followeeCount`, which
  `defaultFeedTab` reads (zero follows → Your conditions). Following empty
  is drawn with both second lines.
- **E2-lite** — `consensus.ts` counts **runners**, not entries: five or no
  aggregate; three days, widened once to fourteen; the ±3° band never
  widens; groups under two runners drop. The result carries its band, damp
  class and window so the eyebrow is `MATCHING [41–47°] · DAMP · LAST 3
DAYS`. `ConditionsTab` states: waiting (breathing headline), location
  denied (city form), no matches, matched/widened. A saved location skips
  the prompt.
- **D** — pager (one photo, `1 / 2`), run strip with badge (or the owner's
  prompt in its place), note, kit list with `[TOO MUCH]`/`[NOT ENOUGH]`
  and `[GENERIC]`, tags on the track fill, Useful as `♡ n USEFUL`, Report
  at the foot.
- **G/H** — counts at 0 (runs, following, followers) and the day-one next
  step on G; H keeps its header and Follow and says it has nothing public.
  Follow is `useControlAction` (`[ Following ]`/`[ Unfollowing ]`,
  `NOT FOLLOWING`/`STILL FOLLOWING`), shared by H and search rows.
- **Search** — row: avatar, name, Follow pill; the field's trailing label
  breathes while a search is in flight; "No runner called @x."
- **M and the bell** — unread is white + pink dot, read is paper + quiet;
  S2b empty; Mark all read on `useControlAction` (`[ Marking ]`,
  `Nothing marked`); it never clears a verdict to-do. The bell's number is
  runs from the last 14 days without a verdict (caps `9+`); any other
  unread is the dot. Five feed routes move to `BelledLayout`; M is a panel.

## Contract touches

- Schema changes needed: **none**. No new routes, bindings, queues or crons.
- Screens: E1, E2-lite, D, G, H, runner search, M, S2 bell.

## Test plan

- worker: consensus (runner floor, 3→14 widen, band fixed, group floor),
  feed hydration (`viewerHasReacted`, `followeeCount`), profile counts,
  search follow state, bell count (14-day window, kit or not), mark-all
  keeps verdict to-dos.
- ui: PostCard (order, absent parts, strip, badge fill, Useful control),
  Feed tabs/empty, ConditionsTab four states, EntryDetail parts, G/H, the
  follow control, RunnerSearch, NotificationList, the bell's number/dot.
- e2e: conformance specs per packet; `feed.demo.spec.ts` re-recorded.

## Open questions

Answered by the owner, 2026-09-24:

- **Usernames** — the product moves to usernames in a separate task
  (schema plus signup/settings). Here, display names stand where the frames
  draw `@username`.
- **A typed city** — geocoded through Visual Crossing (`resolvePlace` in
  `modules/weather`), saved as `city_label`, `lat`, `lng`; a city nobody
  can find is a field message.
- **Per-item flags on someone else's D** — the contract holds: never public.
- **No Useful or Report on your own D** — confirmed.
