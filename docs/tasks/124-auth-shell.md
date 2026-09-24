# Task 124 — Auth, shell, onboarding, settings, safety, the Call teaser

Lane 4 of 4 building to rounds 21–23. Read
`121-124-build-to-rounds-21-23.md` first — the shared rules live there.

## You own

- `src/modules/auth/**`, `src/routes/auth/**`, `src/routes/index.tsx`,
  `src/routes/__root.tsx` and the router's not-found/error/pending wiring
- `src/modules/onboarding/**` (includes `CallLadder`), `src/routes/onboarding/**`,
  `src/routes/call/**`
- `src/modules/safety/**`, `src/routes/safety/**`
- The shell: `src/ui/Layout.tsx`, `TopBar.tsx`, `TabBar.tsx`, `tabs.ts`,
  `Page.tsx`, `Wordmark.tsx`. **Not** the task-120 primitives (`FileWell`,
  `form.tsx`'s bands, `use-control-action.ts`, `photo-step.ts`).
- `e2e/auth/`, `e2e/onboarding/`, `e2e/safety/`, new `e2e/conformance/auth-*`,
  `e2e/conformance/system-*`

## Screens and what changes

**Sign up, log in** (`design/Auth.dc.html`: Au1 to Au7, plus "Au2 Log in
1040").

- Seven phone states, and the 1040 layout.
- The failure band opens "Not signed in", not "Nothing saved".
- The Google button's in-flight and error states. D-102: its error is a pink
  line today.
- **The signed-out arrival (Au7).** The Form Contract routes an expired
  session to sign-in carrying the payload. D-102: it shows a band today.

**The signed-out shell** (Auth rulings; Round 21 "Landing bar …" frames).

- A signed-out page never shows the tab bar.
- From 720 up, auth pages get the landing bar with no action. Below 720,
  no bar.
- `/` from 720 up: the wordmark plus one action. Logged out: "Log in"
  (hairline). Signed in: "Your closet" (ink). The hero drops its own
  wordmark. No nav, search, bell or "Log a run", and pink stays off it.

**System states** (Round 22 `#x`: "X Not found", "X Loader failed", "X Slow
route").

- The shell is present for a signed-in 404 or loader error, absent signed
  out.
- A loader error is `FailureBand` with "Didn't load".
- A slow route keeps the old screen. After 300ms, the destination's tab
  label breathes. No skeleton, no bar.

**O1 · calibrate** (item 19 ruling).

- The city field suggests as you type, and picking one makes the chip.
- "Use my location" is a text button under it:
  - in flight, it breathes;
  - granted, it becomes the chip;
  - denied, focus moves to the field with "Location's off. Type your city
    instead." (not yellow).
- Units are two segmented pairs, °F/°C and mi/km, defaulted from the locale.

**Settings** (item 20 ruling; V1 N, Remaining U1/U2).

- U1/N's tap-through index wins; the long form is drift.
- Each sub-page is its own small form with its own Save.
- The index and the sub-pages keep the tab bar; sub-pages add a back link.
- The unanswered calibration row reads "How you run" · "Not answered"
  (`--muted`) · "Answer ›".

**Safety** (items 21, 22 rulings).

- W1 opened from D has no block toggle: reasons, optional note, Send.
- ✕ closes W1 and discards without a confirm.
- The Report trigger is a text link at the foot of D and H. Lane 123 places
  it; you own the sheet.
- W2 empty: "You haven't blocked anyone."
- Unblock uses `useControlAction` with `[ Unblocking ]` and `STILL BLOCKED`.
  The band sits inside the row, and the row leaves on success only.
- **W3 copy**, in the same slot as W3a's line:
  - after taps: "You blurred 2 spots. Tap one to undo.";
  - blur off: "Faces won't be blurred. Anyone in this photo can be
    recognised."

**The Call teaser (K)** (item 24 ruling).

- Zero verdicts: K as drawn, the meter at 0 of 5, "Log five verdicts and
  the Call starts."
- Threshold met: the meter full, "That's enough to call. The Call arrives in
  the next release." No button.
- D-102: at desk it's the panel.

**Small folds** (item 25 ruling).

- An expanded fold is the same rows, continued, with "Fewer" at the end.
- P2.5 with nothing to name: the section is absent.

## Conformance specs

- **Add specs** for Au1 to Au7, the landing bar at 720 and 1040, the three
  system states, and settings index.

## Demos

- `e2e/auth/`, `e2e/onboarding/` and `e2e/safety/`, re-recorded.
- Add one for the signed-out shell.
