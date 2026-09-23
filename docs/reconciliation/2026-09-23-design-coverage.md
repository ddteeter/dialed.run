# Design coverage — 2026-09-23

**The question:** for each state a built screen actually shows, does a board
draw it? A sentence is not a drawing. A state that exists only in prose — a
contract line, a ruling, a note on a board — passes every check we have,
because the conformance harness can compare the app only against what is
drawn. That is how features land with assumed behaviour. The owner's example:
the garment photo well at desk width is one sentence in the Desktop Contract
(_"Copy and one state change; the layout is untouched"_), while A1's file
upload has a drawn board. So the one looks designed and the other does not.

**Method:** four read-only audits, one per area: run logging and the verdict;
the closet; feed and social; onboarding, auth, shell and safety. Each walked
the code for every state a surface renders (resting, empty, pending, error,
drag-over, read-only, receipt, desk width, signed in and out) and classed each
one:

| class             | meaning                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DRAWN**         | a screen board draws it — cite board, screen label, region                                                                                              |
| **DRAWN-GENERIC** | a contract draws it generically (Form Contract's field error, failure band, pending; the Accessibility Contract's in-flight table; the Motion Doctrine) |
| **PROSE**         | described in words only — quote and cite                                                                                                                |
| **UNDESIGNED**    | nothing draws or describes it; the build invented it                                                                                                    |

Boards as of round 21 (imported the same day).

## What it found

- **Screens with no board at all:** login and signup, the landing page (one
  bar drawn in round 21; the page itself has "a separate brief" that does
  not exist yet), run detail, the runs list, import status, edit garment,
  the 404 and error pages, and the review queue as built (the designed one
  is The Desk, not built).
- **Screens drawn only in pieces:** garment detail (identity line,
  composition and the shoe variant are drawn; the photo, the photo well,
  stats, "Pairs with" and the action row are not), and runner search (the
  drawn board, I, is post-v1).
- **States no board draws, across screens that are drawn:** empty states
  (Following, Your conditions, other profile, search, the backlog), failure
  on controls that aren't forms (upload, attach, follow, useful, unblock),
  waiting states (A2's location wait, route loads), and desk-width variants
  of phone screens.
- **Round 21 closed three:** A3b is drawn; A3's nothing-to-note receipt is
  drawn; the landing bar at width is drawn.

The Form Contract carries every form's error, failure and pending states
well — those are the best-covered states in the product. The gaps are
almost all outside forms.

## Gaps, by area

Ranked within each area by how often a runner meets them. Evidence is in the
audit transcripts; the lines below name the decision a drawing has to make.

### Run logging and the verdict

| surface                                   | state                                                            | status     | a drawing decides                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Import status `/runs/import/$id`          | pending, done, duplicate, parse failed, stalled, lost            | UNDESIGNED | Round 20 says A1 becomes the parsed card in place. Does this route survive? If not, A1 needs parse-failed and duplicate states.                                    |
| A2 attach                                 | waiting for location or prefill; no suggestion / location denied | UNDESIGNED | Whether the picker shows inline at once, and what the wait looks like.                                                                                             |
| Run detail `/runs/$id`, runs list `/runs` | everything                                                       | UNDESIGNED | What a run page is before its kit, the six status badges, the empty list. The manual-temp fallback here contradicts round 20's "weather itself is never editable". |
| File well (A1 and garment)                | drag-over at desk                                                | PROSE      | The over state itself: border, copy change, if any.                                                                                                                |
| Non-form controls                         | failure (A1 upload, A2 attach, run-detail save, Strava)          | UNDESIGNED | One pattern for a failure that isn't a form submit. Today these are pink lines, which the Form Contract forbids.                                                   |
| DS2 backlog                               | failed row, zero rows, 720–1039 layout, row with no conditions   | UNDESIGNED | The failure mark, the zero state, whether the table exists below desk.                                                                                             |
| W3 blur                                   | after manual taps; blur off                                      | UNDESIGNED | Two copy lines and the off state.                                                                                                                                  |
| Strava callback                           | connected / not connected                                        | UNDESIGNED | The landing after OAuth returns.                                                                                                                                   |

### Closet

| surface        | state                                                                                    | status             | a drawing decides                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Garment detail | the whole screen                                                                         | drawn in pieces    | Where the photo sits and at what size (DS3's 320px cap is broken today), the order of stats, pairs, composition and actions, and how Edit, Retire and Delete look. |
| Photo well     | with a photo vs without                                                                  | UNDESIGNED         | Preview inside the well with Replace/Remove, or apart from it. Today a full-width image sits above a well that still says "Add a photo".                           |
| Photo well     | resting, phone                                                                           | PROSE              | A1's anatomy adapted — kicker, sub-line, border weight. It reads unfinished beside A1.                                                                             |
| Photo well     | upload error                                                                             | UNDESIGNED         | Colour and place under the Form Contract (pink today, which it forbids).                                                                                           |
| Garment detail | delete / retire confirm                                                                  | PROSE (not built)  | Flow Map and `motion.js` name a confirm; nothing draws it.                                                                                                         |
| Closet at desk | one column without the rail: heading row, retired toggle, `[Retired]` card, empty closet | UNDESIGNED / PROSE | The v1 desk closet until the rail (D-94) lands.                                                                                                                    |
| F add garment  | product link field typed                                                                 | UNDESIGNED         | "Enrichment pending — lane 107" breaks AC2b's own rule. Remove the field for v1, or draw F2a/F2b.                                                                  |
| Edit garment   | the whole screen                                                                         | UNDESIGNED         | Title, and whether it is F prefilled.                                                                                                                              |
| F              | size field; colorway field                                                               | UNDESIGNED / PROSE | Where they sit against AH1's caption treatment.                                                                                                                    |

### Feed and social

| surface                         | state                                                                                                                              | status                        | a drawing decides                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Following post card             | resting, no photo, no conditions                                                                                                   | DRAWN (diverges)              | The v1 card: E1 draws time, verdict, photo, kit and pace; the build shows name, temperature, distance, caption and a count.                            |
| Following                       | empty                                                                                                                              | PROSE                         | Copy, layout, the search call to action — and whether a runner with no follows lands on Your conditions (E2-lite's prose says yes; the build says no). |
| Your conditions                 | loading, location denied, zero matches, widened window                                                                             | PROSE / UNDESIGNED            | The ask posture, the denied recovery, the empty copy, how "widened" reads.                                                                             |
| Entry detail                    | no photo / caption / conditions / verdict; tags row; per-item flags; the verdict prompt; report placement; photos as grid vs pager | UNDESIGNED                    | The sparse entry, and where the prompt and report sit.                                                                                                 |
| Runner search                   | results, none, in flight                                                                                                           | UNDESIGNED                    | The result row (city? follow inline?), and panel vs column at desk.                                                                                    |
| Own profile G / other profile H | as v1 data ships: stats, recent entries, new account, empty                                                                        | DRAWN (diverges) / UNDESIGNED | G and H with the data that actually exists.                                                                                                            |
| Notifications                   | read vs unread (M and S2c disagree), empty copy, mark-all pending                                                                  | DRAWN (conflict)              | Which unread treatment; S2b's empty copy.                                                                                                              |
| Bell                            | dot vs number                                                                                                                      | DRAWN, misapplied             | S2a says a dot for unread and a number only for a to-do list; confirm which is which.                                                                  |
| Call teaser K                   | zero verdicts; threshold met                                                                                                       | UNDESIGNED                    | Both ends of the countdown; there is no B1 to hand off to in v1.                                                                                       |

### Onboarding, auth, shell and safety

| surface                                               | state                                                        | status             | a drawing decides                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Login / signup                                        | everything                                                   | UNDESIGNED         | The first form every runner sees: layout, the Google button (its pending and error), wrong password vs server fault. The Desktop Contract says "Nothing to draw" — but no phone screen exists to put in the panel. |
| Signed-out shell                                      | auth pages and landing carry the product tab bar and top bar | UNDESIGNED         | Round 21's landing bar covers `/` at width; auth pages and the phone need the same answer.                                                                                                                         |
| 404, error, route pending                             | everything                                                   | UNDESIGNED         | Framework defaults today. Copy, exit action, shell or not.                                                                                                                                                         |
| Session expired                                       | arrival at sign-in                                           | PROSE              | The Form Contract says route to sign-in carrying the payload; draw the "you were signed out" arrival.                                                                                                              |
| O1 calibrate                                          | typed city, "Use my location" and its outcomes, unit selects | UNDESIGNED         | O1 draws only a resolved city chip.                                                                                                                                                                                |
| Settings                                              | as built (one form with Save) vs U1's tap-through index      | DRAWN (diverges)   | Which settings is, plus the unanswered-calibration row.                                                                                                                                                            |
| Report trigger; W1 without the block toggle; W2 empty | —                                                            | UNDESIGNED / PROSE | Where "Report" sits on D and H; the common case of W1; W2's empty line.                                                                                                                                            |
| Tap-list and P2.5                                     | fold expanded; nothing to name                               | UNDESIGNED         | Two small states.                                                                                                                                                                                                  |

## Found along the way — ours to fix, not design's

These contradict something already drawn or ruled. They are build bugs, not
design gaps, and go to the register rather than to design:

- **No bell on the five feed routes.** They use `Layout`, not
  `BelledLayout`; DS1b says the bell is on every screen.
- **Garment photos skip W3's blur.** `PhotoBlur` is mounted only on the
  verdict route; the garment detail's comments claim the upload reaches it.
- **Pink failure lines** on the file well, the Google button, A2's attach
  and run detail's save. The Form Contract: _"Pink is not failure."_
- **The garment photo exceeds DS3's 320px cap** at desk (up to ~572px).
- **A new runner lands on Following**; E2-lite: _"A new user with no follows
  lands on the conditions tab by default."_
- **An expired session shows a band** instead of routing to sign-in.
- **Manual entry lands on run detail**; R1: _"Next · pick the outfit."_
- **Strava disconnects with no confirm**; T3b draws one.
- **A3's photo upload reads "Uploading…"**, not `[ Uploading ]`.
- **Notifications and the Call open as a 620 column**; DS3 says panel.
- **"Attach 0 items"** follows the round-13 table, which round 20 superseded
  ("the label never changes … 'Pick at least one piece.'").

## The rule going forward

A visible surface that exists only as prose is drawn before it is built —
or, if it is built first, its demo frame goes back to design for a board.
A new state on a drawn screen is a new state on its board.
