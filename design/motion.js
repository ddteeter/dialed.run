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
  { surface: 'Tab switch', move: 'No transition on content. Active indicator slides under the label.', duration: 'instant', easing: 'snap',
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
];

/** Accessibility: reduced motion is a real mode, not an off switch. */
export const REDUCED_MOTION = {
  rule: 'Every move collapses to a 90ms opacity change. Bracket breathe goes static. Digit rolls become instant swaps.',
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
