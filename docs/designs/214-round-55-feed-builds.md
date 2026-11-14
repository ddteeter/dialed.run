# Design: 214 Round 55 feed builds

## Problem

#636 sent the styling audit's feed, profile, entry, search and public-page
findings to Design as items 204–219 and 231, and Round 55 ruled on all of them
(`design/Round 55 Rulings.dc.html`, `docs/design-deltas.md` §Answered in round
55). This lane builds those rulings. The notification findings in #636's body
(N2-02, N2-03, P2b-08, P2b-10) went to #633 and are not part of this lane.

## Approach

Mostly component work in `modules/feed`, plus some in `modules/safety`, `modules/onboarding` and
`ui`. Three items need new data from the server, all read from existing
columns: H's rows (210), search rows (217) and G's next step (209f). The order
follows the wave 8 holds:

| item                                                                                                                           | files                                                                                                | phase |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----- |
| 204 author line: relative time drops the clock; separators bind forward                                                        | `PostCard.tsx`                                                                                       | A     |
| 205 rhythm: 8 `--tint` band between posts; 16 padding; watch joins meta line                                                   | `PostCard.tsx`, `UsefulButton.tsx`; `Feed.tsx` (`divide-y`)                                          | A, B  |
| 206 photo loading/failed: `--photo` slot, hatch + "PHOTO DIDN'T LOAD"                                                          | new `feed/components/PhotoSlot.tsx`, used by `PostCard`, `PhotoPager`; `PublicProfile` tiles         | A, C  |
| 207 4:5 on card and D, square tile, counter bottom right on `--ground`; D desk pager 560 cap, round buttons, arrow keys        | `PostCard.tsx`, `PhotoPager.tsx`; `PublicProfile.tsx`                                                | A, C  |
| 208 conditions bars: fixed 96 track, "Tops 12"                                                                                 | `ConditionsTab.tsx`                                                                                  | A     |
| 216 city finder line: before/after wording, none when not found                                                                | `ConditionsTab.tsx`                                                                                  | A     |
| 215 W1 way-out line inside the chosen row                                                                                      | `ReportSheet.tsx` (+ `ui/form` ChoiceList hint slot if it needs one)                                 | A     |
| 214 profile sheet "Report or block @handle", profile reasons, Block without reporting                                          | `safety/contracts.ts`, `ReportSheet.tsx` (or a sibling `ProfileReportSheet.tsx`); `OtherProfile.tsx` | A, B  |
| 219 public kit: ruled stats, ruled 600 rows, 3 stats fill 3 tracks; ink invite card                                            | `PublicKit.tsx`; `PublicFrame.tsx` `Invite`                                                          | A, C  |
| 211 confirm band flush, one hairline, Resend link in `--cold-text`                                                             | `account/components/ConfirmEmailBand.tsx`; `ResendLink.tsx`                                          | A, C  |
| 209 G: AB3 16-tall slots + bold word, "1 RUN", brand + model "[39 RUNS]", ink header counts, count by band, (f) one next step  | `ui/Marks.tsx`, `profiles.ts` (A); `OwnProfile.tsx` (B)                                              | A, B  |
| 210 one run row for G and H (date link, MONO.sm conditions · verdict · distance, [UNDER REVIEW])                               | `profiles.ts` (A); new `feed/components/RunRow.tsx`, `OwnProfile.tsx`, `OtherProfile.tsx` (B)        | A, B  |
| 212 D kit list as the public kit's ruled rows                                                                                  | `EntryDetail.tsx`                                                                                    | B     |
| 213 D delete link: body 600 `--cold-text` underlined                                                                           | `ui/ConfirmSheet.tsx` (a `tone` on `ConfirmLink`, A); `RetractEntry.tsx` (B)                         | A, B  |
| 217 search rows: "41 RUNS · SINCE OCT 2026", hairline Follow pill, `--muted` Following                                         | `search.ts` (A); `RunnerSearch.tsx` (B)                                                              | A, B  |
| 218 public profile: handle step-down past 17 with `<wbr>` after "\_"; tile caption per board; rail groups of five + "+ N more" | `PublicProfile.tsx`                                                                                  | C     |
| 231 Call coverage strip: band cells over an axis, legend of present states, "15 OF 15 NEEDED", "44 VERDICTS IN ALL"            | `onboarding/components/CallLadder.tsx` (+ its data in `onboarding`)                                  | C     |

Phase A is files no wave 8 lane holds, and I build it now. B waits for 8b
(#664) and C for 8c. Then I rebase onto origin/main.

## Contract touches

- Schema changes needed: **214 only, approved (owner, 2026-11-13).** Profile
  reasons add `offensive` and `impersonation` to `reports.reason`. The column is
  plain text in SQLite, so only the Drizzle enum in `schema-core.ts` changes and
  there is no migration. Reasons are listed per subject type, and the hide
  sweep's lowest bar counts only the reasons for subjects a report can hide.
  Otherwise a new reason with no configured threshold would lower the bar for
  entries.
- New route files: none. New bindings, queues or crons: none.
- Screens: Feed, D, G, H, W1 (profile variant), search, `/@handle`,
  `/kit/:id`, the Call. Design deltas R55·204–219 and 231.

## Test plan

- ui (`*.dom.test.tsx`): one block per item on the component it changes, for
  example: PostCard drops the clock on a relative time, and a separator is
  never left at the end of a line; PhotoSlot shows the failed state on
  `error`; the pager's arrows hide at their ends and the arrow keys turn the
  page; "1 RUN" for one, "2 RUNS" otherwise; the profile sheet offers only
  profile reasons, and Block without reporting needs no reason; the rail
  shows five plus "+ N more", and a group of six shows all six.
- worker: `profiles.ts` H rows carry distance, conditions and verdict, and G
  rows carry the verdict; `search.ts` returns the run count and the month the
  runner joined; the profile reasons parse; G's next step is the latest run
  with no kit.
- e2e: the existing feed and safety journeys' transcripts are re-recorded.
  There is no new spec, because vitest observes each of these changes.

## Issues

- Closes: #636.
- Opens: anything deferred, listed in the PR.

## Open questions

- **Owner (answered 2026-11-13):** 214's two new reason values (above).
- **Coordinator:** 207's D pager arrows against 9c's photo viewer (#659). I'm
  assuming they don't collide, because #659 is AttachKit's thumbnail.
- **Guess:** 218(d) "+ N more" expands the group in place (a disclosure), and
  Retired folds to "Retired · N" with the same disclosure.
- **Guess:** 209(f) ADD YOUR KIT links to `/feed/attach/$runId` for the latest
  run with no entry.
- **Design 254 (#671), building on the guess:** R55·205 puts the watch name
  on the caps meta line, but on the card that name is Garmin's attribution.
  It stays its own "Garmin {model}" line (Garmin Rulings 77) until Design
  rules.
- **207 and 249.1 share one control:** `src/ui/PagerArrows.tsx`, built here
  and cherry-picked by 9c. Neither lane changes it without telling the other.
- **Moot:** 217's "their photo when they have one". No profile photo exists, so
  the avatar stays the initial.
