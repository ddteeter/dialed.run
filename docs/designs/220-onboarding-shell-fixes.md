# Design: 220 onboarding, Settings, auth and shell fixes (#703, #698, #697, #672)

## Problem

The styling-audit re-run (#666) left three finding lists for this lane.
The largest is Privacy: three settings save the moment they change but
are drawn as tick boxes under a "· SAVES AS YOU SWITCH" eyebrow, so they
look like they wait for the Save button beside them. R54·166.3 (D-185)
rules them switches. The rest are smaller shell faults: system states in
the 390 panel at desk, a dark sheet whose grabber is painted over, confirm
pairs whose secondary is taller than the primary, a bell seat that closes,
P3's row and the flow primary at 55.

## Approach

**Saved switches (R2-ONB-01, R2-SHELL-12).** Privacy's Public profile,
Show my closet and anonymous totals, plus Notifications' Run reminders ·
Email (coordinator, 2026-11-14: #754 closed as answered by 166.3), become
`ToggleField isSwitch`: the switch at the row's right, with a 600 label.
The eyebrows lose "· Saves as you switch". Notifications loses its form
and Save, since its one field saves on change. A successful change
announces "Saved." (guess: the board says "Saved"; the period matches every
other status). On Privacy the screen keeps **one** status region (rule 08).
`SectionForm` can hand its status to the page through `onStatus`, the
PhotoBlur `onAnnounce` pattern, and the page renders the one `FormStatus`.
The status comes from the components' own `onSuccess`. `useControlAction`
is not touched while #706 is open. PRIVATE / SHARED / PUBLIC go to MONO.sm
(166.5).

**Onboarding width (R2-ONB-03).** `Page.tsx`'s `STEP` loses `max-w-panel`.
Below 720 a step is fluid (DS4); from 720 it is the column. P3's band
bleeds until `wide`, not `desk`, so it has one geometry per side of 720.
The Call's header gets the same treatment.

**Unit pairs (R2-ONB-04) and the Theme row (#672).** `ChoiceList` gains a
`joined` layout: one pill track, an ink thumb, and mono labels. It is used by
units and by Theme.

**Auth (R2-AUTH-01, -03).** Unblock's pill hugs its word: `PendingLabel`
gains `isReserved={false}`, so the pill does not hold "[ Unblocking ]"'s
width at rest (guess: the pill grows while in flight and the handle gives
way, rather than every handle losing ~40px forever). `SignedOutPanel` takes
the frame's `px-5 wide:px-6`.

**Shell (#697).** SystemState's loader-failed passes the replaced screen's
width (column by default), and so does a signed-in unnamed not-found. The
signed-out column gets its inner gutter. The grabber's `::before` gets a
z-index over the sticky header. TopBar holds a fixed 44 seat for the
bell, and so does the phone row in SystemState. `HUG_WIDE_CLASS` drops
`self-start` in a row (`wide:self-start` only where the parent is a
column, so a row centres). The action tone drops `py-4`, so `min-h-13`
(52) sets the height. The confirm pairs use `SECONDARY_PILL`. The bell
badge's offset stays in the gutter.

## Contract touches

- Schema changes needed: **none**
- New route files: none
- New bindings/queues/crons: **none**
- Screens: U2 Privacy, Notifications, U1 units, O1, O0–P3, W2, every
  `SignedOutPanel` page, X1/X2, every phone sheet in dark, every confirm
  sheet, the top bar. Shared-UI changes reach every lane's screens; the PR
  lists them.

## Test plan

All vitest `ui` (`*.dom.test.tsx`) unless noted. Each one renders the
component and observes the role, the class or the announcement:
- Privacy: each of the three is `role="switch"`, after its label; no
  "Saves as you switch" text; a success writes "Saved." into the one
  status region; a failure leaves the switch as it was and shows the band.
- Notifications: the switch saves on change, there is no Save button, and
  "Saved." is announced.
- `ChoiceList optionStep="sm"` on Privacy; `joined` draws one track.
- `PendingLabel isReserved={false}` renders only the current label.
- SystemState: loader-failed and unnamed signed-in not-found use the
  column; the bell seat exists before the bell lands.
- form.tsx: the action class has `min-h-13` and no `py-4`; confirm pairs
  use `SECONDARY_PILL`.
- Existing e2e journeys and transcripts updated (switch roles change what
  is heard); no new spec.

## Issues

- Closes: #703, #698, #697, #672.
- Opens: any finding already right on main is ticked, not deferred.

## Open questions

The two guesses above ("Saved." and Unblock's in-flight growth). File
ownership is the coordinator's (2026-11-14): Page.tsx, BlockedRunners,
NotificationBell and #672 are this lane's. In 10c's and 10a's files
(DeleteWithRuns, GarmentForm, ReleaseHolds, PhotoBlur), only the one-line
`SECONDARY_PILL` swap is.
