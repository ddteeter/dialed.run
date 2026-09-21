/**
 * dialed.run — motion tokens (single source of truth)
 *
 * THE POSITION
 * ------------
 * Motion is confirmation, not decoration. Every animation in dialed.run answers
 * one question — "did that register?" — and then gets out of the way.
 *
 * THREE LAWS
 * 1. THINGS ARRIVE, THEY DON'T SETTLE.  No bounce, no spring, no overshoot.
 *    Wobble is the opposite of dialed. Curves decelerate to a dead stop.
 * 2. THE BRACKET DOES THE WORK.  Reveals, commits and waits are expressed by
 *    the brand brackets closing, opening or breathing — not by fades and slides.
 * 3. NOTHING TRAVELS FAR.  Max 24px for an element, one bracket width for a
 *    frame. Containers may travel their own height. Nothing crosses the screen.
 *
 * CONTRACT FOR AGENTS
 * Import DURATION and EASING. Never type a raw ms value or cubic-bezier into a
 * screen. If a move needs a duration that isn't here, it's the wrong move.
 */

/** Milliseconds. Nothing in the product animates longer than REVEAL. */
export const DURATION = {
  instant: 90,   // state flips: toggle, checkbox, tab active, row press
  quick: 140,    // small element enter/exit, toast, digit tick
  move: 220,     // sheets, drawers, step transitions, list reflow
  reveal: 320,   // the recommendation payoff and the verdict commit. Only these.
};

/** Three curves. There is no fourth. */
export const EASING = {
  // Default. Fast off the line, dead stop. Use for ~everything entering or moving.
  snap: 'cubic-bezier(0.2, 0, 0, 1)',
  // Accelerate away. Use only for things leaving the screen.
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  // Slightly held at the end — the bracket "clicking" into alignment.
  align: 'cubic-bezier(0.6, 0, 0.2, 1)',
};

/** Enter/exit travel. Anything larger is a container, not an element. */
export const TRAVEL = { element: 24, frame: 8 };

/**
 * Stagger is banned as decoration and permitted as meaning: only where the
 * order IS the information. In practice that is the recommendation reveal,
 * which arrives in dressing order — base, mid, shell, extremities.
 */
export const STAGGER = { step: 30, maxItems: 4 };

/** Per-surface map. If a surface isn't here, it doesn't animate yet — ask. */
export const SURFACES = [
  { surface: 'Tab switch', move: 'No transition on content. Phone bar: five equal columns, the indicator slides under the label. Top bar (≥720) and E1\'s tabs: natural-width labels, the active one carries a static underline; only the colour flips.', duration: 'instant', easing: 'snap',
    why: 'The tab bar is a destination, not a journey. A crossfade would add 200ms to the most-used gesture in the app.' },
  { surface: 'Log flow step', move: 'Step slides in from the trailing edge, previous step slides out.', duration: 'move', easing: 'snap',
    why: 'Direction tells you which way you are travelling through the flow, so Back feels like back.' },
  { surface: 'Verdict commit', move: 'Brackets close onto the chosen verdict, then the row locks.', duration: 'reveal', easing: 'align',
    why: 'The single most important input in the product. The bracket closing is the receipt.' },
  { surface: 'Recommendation reveal', move: 'Brackets open, then layers arrive in dressing order.', duration: 'reveal', easing: 'align',
    why: 'The payoff. The only place in the app allowed a stagger, because the order is the answer.' },
  { surface: 'Sheet / drawer', move: 'Travels from its own edge. Exits on ease-exit at quick.', duration: 'move', easing: 'snap',
    why: 'Leaving should be faster than arriving — you already know what you saw.' },
  { surface: 'Closet filter', move: 'Items reflow to new positions. No fade, no re-enter.', duration: 'move', easing: 'snap',
    why: 'The garments did not go anywhere. Fading them out implies they were removed.' },
  { surface: 'Row press', move: 'Background flips to ink. No scale.', duration: 'instant', easing: 'snap',
    why: 'Scale-on-press is a spring in disguise and it makes crisp type shimmer.' },
  { surface: 'Toast / banner', move: 'Enters from the top edge, holds, accelerates away.', duration: 'quick', easing: 'snap',
    why: 'Short enough that it never competes with the thing you were doing.' },
  { surface: 'Numbers & temps', move: 'Mono digits roll vertically. Never crossfade.', duration: 'quick', easing: 'snap',
    why: 'Plex Mono is tabular — a roll reads as a meter changing, a fade reads as a bug.' },
  { surface: 'Pending / loading', move: 'Brackets breathe, 1 → 0.35 opacity, 900ms loop.', duration: 'custom 900', easing: 'linear',
    why: 'One waiting device for the whole product. No spinners, no shimmer sweeps.' },
  { surface: 'Offline / error', move: 'Nothing. Deliberately static.', duration: '—', easing: '—',
    why: 'A broken connection should not feel alive. Stillness is the signal.' },
  { surface: 'Retire a garment', move: 'Row collapses its own height. No drift, no fade.', duration: 'move', easing: 'exit',
    why: 'Collapse says "removed from the list". A fade says "still there, just hidden".' },
];

/**
 * Navigation — screen-to-screen. Round 12.
 * One law: every navigation has a direction, and the direction is the transition.
 * Forward comes from the trailing edge; back leaves the way it came; a flow rises
 * from the bar and drops back to it; a swap into a pane has no direction and so
 * gets no travel. Five types. A screen that isn't reached by one of these isn't reachable.
 *
 * Ownership: NAV lists every shipped edge, not just the Flow Map's. A lane meeting a new
 * edge assigns a type by analogy to the nearest row, adds the row here in the same PR,
 * and flags it. Design reviews the row, not the release.
 */
export const NAV_TYPES = {
  push:  { move: 'Incoming slides in from the trailing edge, TRAVEL.frame. Outgoing holds and dims to 0.6. Back reverses both.', duration: 'move', easing: 'snap',
           why: 'Direction is the breadcrumb. Back feels like back because the screen physically goes back.' },
  rise:  { move: 'Incoming rises from the bottom edge its own height. Dismiss drops on ease-exit at quick. The screen beneath does not move.', duration: 'move', easing: 'snap',
           why: 'A flow is a task laid on top of where you were. It goes back to the bar it came from, so the bar stays put.' },
  swap:  { move: 'Incoming fades in over the outgoing, which holds until covered. No travel on either.', duration: 'move', easing: 'snap',
           why: 'Desktop panes and tab content have no spatial relationship. Faking one with a slide is a lie about the layout. A quicker fade reads as a flash on anything pane-sized.' },
  panel: { move: 'Panel slides in from its own edge, TRAVEL.frame; the page dims to 0.6. Close: ease-exit at quick.', duration: 'move', easing: 'snap',
           why: 'Same physics as Sheet / drawer, so a phone sheet and a desktop panel are one thing to the runner.' },
  cut:   { move: 'Nothing. Next frame is the new screen.', duration: '—', easing: '—',
           why: 'Tabs, and anything returning to where the runner already is. Motion here is tax.' },
};

/** Every shipped edge, at the three widths. Column = 390 / 620 / 1040. See the ownership rule above. */
export const NAV = [
  { edge: 'Tab bar → Feed / Closet / Call / You', at: ['cut', 'cut', 'cut'], note: 'Indicator slides (Tab switch). Content cuts. Call as a tab is a cut; its reveal runs on arrival like any first paint.' },
  { edge: '+ Add (bar launcher) → Log a run (A1…Q)', at: ['rise', 'panel', 'panel'], note: '+ Add is a launcher, not a tab: a button (aria-haspopup="dialog"), never a link, never current. The indicator never travels to it, and the tab beneath stays selected — visually, and as aria-current="true" (item, not page; Accessibility Contract). Steps inside: Log flow step. Supersedes the indicator behaviour in #84.' },
  { edge: 'Log flow end (P3) → where you were', at: ['rise', 'panel', 'panel'], note: 'The drop half of rise / the close half of panel. The screen beneath was there all along.' },
  { edge: 'First load (/) → Sign in', at: ['cut', 'cut', 'cut'], note: 'First paint.' },
  { edge: 'Sign in ↔ Sign up', at: ['swap', 'swap', 'swap'], note: 'Siblings, no hierarchy — neither is “forward”.' },
  { edge: 'Sign out → Sign in', at: ['cut', 'cut', 'cut'], note: 'The session ended. Stillness, same as offline.' },
  { edge: 'Closet C → Add garment (F)', at: ['rise', 'panel', 'panel'], note: 'Same rise as Log a run — both are “put something in the closet”.' },
  { edge: 'Closet C → Garment detail (Y1/Y2)', at: ['push', 'swap', 'swap'], note: 'At 620+ detail is a reflow in the column; the grid is gone, so nothing to slide from.' },
  { edge: 'Garment detail → Edit garment', at: ['push', 'swap', 'swap'], note: 'Edit stays a full route. No composition change.' },
  { edge: 'Garment detail → Retire / delete confirm', at: ['panel', 'panel', 'panel'], note: 'The confirm only. Sheet on phone, panel on desktop, one type. Not yet built.' },
  { edge: 'Feed X / Profile → Post detail (D)', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Feed / Post → Someone’s profile (H)', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Feed → Find runners', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Runs list → Run detail', at: ['push', 'swap', 'swap'], note: 'By analogy to Closet → Garment detail. Runs list has no screen ID yet — the type holds whatever it becomes.' },
  { edge: 'Import status (T2/T3) → Run detail', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Anywhere → Report / block (W1)', at: ['panel', 'panel', 'panel'], note: '' },
  { edge: 'Feed rail / bell → The Call (K)', at: ['push', 'panel', 'panel'], note: 'Arrival is a push. The reveal that follows is Recommendation reveal and starts only after the push lands.' },
  { edge: 'Bell → Notifications (S1/S2/M)', at: ['push', 'panel', 'panel'], note: 'Panel top-aligned under the bell (Desktop Contract). Never a dropdown.' },
  { edge: 'S1 prompt → Verdict (A3) · Backlog (DS2)', at: ['push', 'panel', 'swap'], note: 'DS2 is a wide surface at 1040 — a swap in the main region.' },
  { edge: 'You G → Settings index → detail (U1/U2/N)', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Settings / Runs list / Onboarding → Strava (T1–T3)', at: ['push', 'swap', 'swap'], note: 'Inside onboarding on desktop, it swaps within the panel.' },
  { edge: 'Strava OAuth return → T2', at: ['cut', 'cut', 'cut'], note: 'A document load from another origin. There is no outgoing screen; first-paint rules apply.' },
  { edge: 'Settings → Re-calibrate', at: ['push', 'swap', 'swap'], note: '' },
  { edge: 'Onboarding O1 → O6', at: ['push', 'panel', 'panel'], note: 'Steps within are pushes on phone; on desktop the panel stays and steps swap inside it.' },
  { edge: 'Deep link / notification tap → any', at: ['cut', 'cut', 'cut'], note: 'There is no “from”. Arrive, then the screen’s own reveal (if any) runs.' },
  { edge: 'First paint of any screen', at: ['cut', 'cut', 'cut'], note: 'Content is there. Pending states breathe; nothing “loads in”.' },
];

/** Things we do not do, and the reason, so nobody re-litigates them. */
export const NEVER = [
  ['Bounce, spring, overshoot', 'Contradicts the name. Nothing in the product is uncertain about where it lands.'],
  ['Parallax and scroll-driven decoration', 'Ties motion to a gesture that carries no intent.'],
  ['Skeleton shimmer', 'Fakes progress. Breathing brackets are honest about waiting.'],
  ['Spinners', 'Same reason, plus we already have a waiting device.'],
  ['Full-page crossfade between tabs', 'Taxes the most frequent action in the app.'],
  ['Card cascade on feed load', 'Stagger as decoration. The feed order is chronological, not dramatic.'],
  ['Hero image morphs between screens', 'Garment photos are reference material, not cinema.'],
  ['Animated empty-state illustrations', 'An empty closet needs a next step, not a performance.'],
  ['Anything over 400ms', 'The product exists to end a decision faster than thinking about it.'],
  ['Hover-only motion', 'Touch-first. If it only exists on hover, it does not exist.'],
  ['Shared-element transitions between screens', 'A garment photo flying from grid to detail is the hero morph again, one screen later. Only the bracket frame and the tab bar are named.'],
  ['A navigation with no type', 'If an edge isn\'t in NAV it isn\'t typed yet. Pick one of the five by analogy, add the row, ship; never a sixth type.'],
];

/** Accessibility: reduced motion is a real mode, not an off switch. */
export const REDUCED_MOTION = {
  rule: 'Every move collapses to a 90ms opacity change. Bracket breathe goes static. Digit rolls become instant swaps. Every navigation type becomes swap at instant.',
  never: 'Never reduce to zero — the user still needs confirmation that their input registered.',
};

/** Paste-ready custom properties. Keep in sync with the objects above. */
export const CSS_VARS = `:root {
  --dur-instant: ${DURATION.instant}ms;
  --dur-quick:   ${DURATION.quick}ms;
  --dur-move:    ${DURATION.move}ms;
  --dur-reveal:  ${DURATION.reveal}ms;
  --ease-snap:  ${EASING.snap};
  --ease-exit:  ${EASING.exit};
  --ease-align: ${EASING.align};
  --travel-element: ${TRAVEL.element}px;
}
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-quick: var(--dur-instant);
    --dur-move: var(--dur-instant);
    --dur-reveal: var(--dur-instant);
  }
}`;
