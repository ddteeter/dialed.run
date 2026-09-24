# Task 123 — Feed & social: E1/E2, D, G/H, search, notifications, the bell

Lane 3 of 4 building to rounds 21–23. Read
`121-124-build-to-rounds-21-23.md` first — the shared rules live there.

## You own

- `src/modules/feed/**`, **except** the files lane 121 owns (`AttachKit`,
  `VerdictForm`, `VerdictChips`, `SpecificsSheet`, `NotedReceipt`,
  `BandHistory`, `chips.ts`, `band-signals.ts`). `entries.ts` and
  `functions.ts` are shared, so keep your changes there to additions.
- `src/routes/feed/**` except `attach.$runId.tsx` and `verdict.$entryId.tsx`
- `src/modules/notifications/**`, `src/routes/notifications/**`
- `e2e/feed/`, new `e2e/conformance/feed-*`, `e2e/conformance/notifications-*`

## Screens and what changes

**E1 · Following** (Round 22 `#e1`: "E1v1 Following", "E1v1 Following empty").

- **The v1 card, in fixed order:** author + badge, photo, caption, strip,
  Useful.
  - Kit and pace leave the card; kit lives on D.
  - The strip is `DIST | TEMP · CONDITION`. With no conditions it reads
    "INDOOR" if the run says so, otherwise the second cell is absent. Never
    "—" or "N/A".
  - Zero Useful reads "♡ USEFUL", with no zero.
  - The badge fill follows A3: dialed is teal, off verdicts are hairline
    (E1's yellow was drift).
  - A missing part is absent, never a placeholder.
- **Useful on the card** uses `useControlAction`, the same as D.
- **Default tab:** a runner with zero follows lands on Your conditions. Once
  they follow anyone, Following is the default, even when it's quiet.
- **Following empty** is drawn, including the variant for follows who
  haven't shared.

**E2-lite · Your conditions** (Round 22 `#e2`: "Waiting", "Location
denied", "No matches", "Widened window").

- **Five runners or no aggregate.** It's a privacy floor, confirmed by the
  owner.
- With fewer than five in three days, the window widens to fourteen, once,
  and the eyebrow says so. Still under five means no matches. The
  temperature band never widens.
- **Location denied** recovers with a typed city, saved to the profile's
  city (O1's field; call the existing onboarding function), and the tab
  never asks again. Never send the runner to OS settings.

**D · post detail** (Round 22 `#d`: "D Sparse own entry", "D Someone else's
entry").

- Photos use the pager, not the grid.
- The run strip always shows.
- The owner's verdict prompt takes the badge's place, not a banner.
- Report is a text link at the foot; lane 124 owns the report sheet itself.
- Draw the tags and the per-item flag as the frames do.

**G, H · profiles** (Round 22 `#gh`: "G New account", "H No public
entries").

- Zeros are shown as zeros, and missing sections go.
- A new G shows its counts at 0, plus one next step.
- An H with nothing public keeps its header and says so.
- **Follow/Unfollow** uses `useControlAction` with `[ Following ]` /
  `[ Unfollowing ]` and `NOT FOLLOWING` / `STILL FOLLOWING`.

**Runner search** (item 15 ruling).

- Row: avatar, display name, @username, Follow pill inline. No city.
- While typing, results sit under the field and the field's trailing label
  breathes.
- No results: "No runner called @x."
- At desk it's a 620 column.

**Notifications and the bell** (Round 22 `#m`: "M Mark all read in flight";
item 13 ruling).

- Unread is a white row with a pink dot, and M's hi-viz wash goes.
- Use S2b's empty copy.
- Mark all read moves onto `useControlAction`, with its in-flight label.
- The bell's number counts runs awaiting a verdict; everything else is the
  dot. It caps at 9+.
- D-102: the bell is missing on the five feed routes. They need
  `BelledLayout`.
- D-102: Notifications opens as the panel at desk, not a 620 column.

## Conformance specs

- **Add specs** for the E1 card (with and without photo), E1 empty, the four
  E2-lite states, D sparse, G new account, H empty, and M.

## Demos

- `e2e/feed/`, re-recorded.
