import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { DURATION, EASING, shouldReduceMotion } from "./motion";

/**
 * The two list surfaces from design/motion.js, in one hook because they
 * are one interaction.
 *
 * - **Closet filter** — "items reflow to new positions. No fade, no
 *   re-enter", `move`/`snap`. The garments did not go anywhere, so they
 *   travel to where they are now rather than dissolving and reappearing.
 * - **Retire a garment** — "row collapses its own height. No drift, no
 *   fade", `move`/`exit`. Collapse says removed from the list; a fade says
 *   still there, just hidden.
 *
 * Filtering a list does both at once: the rows that no longer match
 * collapse, and the ones that remain reflow into the space. Splitting them
 * across two hooks is what makes them wrong — the reflow's "before" has to
 * be measured *after* the collapse has finished and *before* the removal
 * commits, and only something that owns both moments can do that. Measured
 * from the wrong frame, the survivors travel back to where they were
 * before the collapse and then forward again, which is a bug that looks
 * like a flourish.
 */

/**
 * Where an element was, in viewport coordinates.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How far an element has to be pushed back to appear not to have moved.
 */
export interface Move {
  readonly node: Element;
  readonly dx: number;
  readonly dy: number;
}

/**
 * The inverted delta for everything that is in both layouts and moved.
 *
 * This is the "invert" of FLIP: the element is already at its new
 * position, so the animation starts by putting it back where it was and
 * lets it travel forward from there. Anything absent from the old layout
 * is skipped — "no re-enter" is the doctrine's own rule, and an item that
 * has just arrived has nowhere to have come from.
 */
export function movesBetween(
  before: ReadonlyMap<Element, Point>,
  after: ReadonlyMap<Element, Point>,
): Move[] {
  const moves: Move[] = [];
  for (const [node, to] of after) {
    const from = before.get(node);
    if (from === undefined) continue;
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (dx === 0 && dy === 0) continue;
    moves.push({ node, dx, dy });
  }
  return moves;
}

/**
 * What a reflowing row animates through.
 *
 * Under reduced motion it does not travel at all: the doctrine collapses
 * every move to a 90ms opacity change, and 0.35 is the floor the breathing
 * brackets already use — a dip and back, rather than out and in, because
 * the row is still in the list and always was.
 */
export function reflowFrames(
  move: Readonly<{ dx: number; dy: number }>,
  isReduced: boolean,
): Keyframe[] {
  if (isReduced) return [{ opacity: 0.35 }, { opacity: 1 }];
  return [
    { translate: `${String(move.dx)}px ${String(move.dy)}px` },
    { translate: "0 0" },
  ];
}

/**
 * `move` and `snap`, read from the ported tokens rather than typed here.
 */
export function reflowTiming(isReduced: boolean): KeyframeAnimationOptions {
  return isReduced
    ? { duration: DURATION.instant, easing: "linear" }
    : { duration: DURATION.move, easing: EASING.snap };
}

/**
 * Whether these two lists hold the same rows, in the same order.
 *
 * The hook is driven by this rather than by array identity: the caller
 * computes its visible rows with a `filter` on every render, so the array
 * is new every time and an effect keyed on it would reset its own timer
 * forever — the row would never finish leaving. It was a joined key string
 * first, which is the same idea with a separator nobody can prove is safe:
 * two lists of the same rows in different groupings join to the same token
 * the moment a key contains the separator.
 */
export function hasDifferentKeys<TItem>(
  previous: readonly TItem[],
  next: readonly TItem[],
  keyOf: (item: TItem) => string,
): boolean {
  if (previous.length !== next.length) return true;
  // Mapped first rather than indexed inside the comparison: reading
  // `previous[index]` needs a `=== undefined` guard that the lengths above
  // already rule out, which is a clause no input can reach and therefore
  // no test can kill. A missing key and a different key are the same
  // answer here, so the array read can simply be compared.
  const was = previous.map((item) => keyOf(item));
  return next.some((item, index) => was[index] !== keyOf(item));
}

/**
 * The keys in `shown` that `items` no longer has.
 */
export function departedKeys<TItem>(
  shown: readonly TItem[],
  items: readonly TItem[],
  keyOf: (item: TItem) => string,
): ReadonlySet<string> {
  const staying = new Set(items.map((item) => keyOf(item)));
  const gone = new Set<string>();
  for (const item of shown) {
    const key = keyOf(item);
    if (!staying.has(key)) gone.add(key);
  }
  return gone;
}

/**
 * The held order, with every row that still exists taken from `items`.
 *
 * **A held row is a position, not a snapshot.** The hook holds departing
 * rows so they have a height to collapse; holding the *survivors* too
 * means the list stops showing what the caller gave it. The closet found
 * that the hard way: retiring a garment changes a flag and no id, so the
 * grid re-rendered the pre-retire copy and the `[Retired]` badge never
 * appeared.
 */
export function refreshed<TItem>(
  held: readonly TItem[],
  items: readonly TItem[],
  keyOf: (item: TItem) => string,
): readonly TItem[] {
  const live = new Map(items.map((item) => [keyOf(item), item]));
  return held.map((item) => live.get(keyOf(item)) ?? item);
}

const NOTHING: ReadonlySet<string> = new Set<string>();

function positionsOf(root: Element): Map<Element, Point> {
  const found = new Map<Element, Point>();
  for (const child of root.children) {
    const { x, y } = child.getBoundingClientRect();
    found.set(child, { x, y });
  }
  return found;
}

function play(moves: readonly Move[], isReduced: boolean): void {
  for (const move of moves) {
    // happy-dom has no Web Animations API, and a browser without
    // `animate` is one where the reflow is simply instant. Neither is a
    // reason to fail a filter toggle — law 5, degrade rather than fail.
    if (typeof move.node.animate !== "function") continue;
    move.node.animate(reflowFrames(move, isReduced), reflowTiming(isReduced));
  }
}

/**
 * Holds departing rows in the list long enough to collapse, then reflows
 * what is left.
 *
 * The caller renders `shown` instead of its own filtered array, puts
 * `listRef` on the element whose direct children are the rows, and gives
 * each row `collapsing-row` with `data-leaving` from `leaving`.
 *
 * **Driven by the rows' keys, not by array identity** — see `keysDiffer`.
 */
export function useListMotion<TItem>(
  items: readonly TItem[],
  keyOf: (item: TItem) => string,
): {
  shown: readonly TItem[];
  leaving: ReadonlySet<string>;
  listRef: RefObject<HTMLUListElement | null>;
} {
  // Three lists, and they are three different facts. `source` is the last
  // one the caller asked for, which is what says whether anything
  // changed; `held` is the order being rendered, which lags by one
  // collapse so a departing row keeps its place; `next` is what to show
  // once that collapse is over.
  const [source, setSource] = useState<readonly TItem[]>(items);
  const [next, setNext] = useState<readonly TItem[]>(items);
  const [held, setHeld] = useState<readonly TItem[]>(items);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(NOTHING);

  const listRef = useRef<HTMLUListElement | null>(null);
  // The last layout this list committed, and — when a move is armed — the
  // layout that move travels *from*. A ref holding the baseline rather
  // than a boolean saying one exists: `useRef(false)` flipped to `true` is
  // a mutant nothing can kill, because an armed reflow with no baseline
  // computes no moves and does nothing either way.
  const last = useRef<Map<Element, Point>>(new Map());
  const pending = useRef<ReadonlyMap<Element, Point> | undefined>(undefined);

  if (hasDifferentKeys(source, items, keyOf)) {
    setSource(items);
    setNext(items);
    const gone = departedKeys(held, items, keyOf);
    if (gone.size === 0) {
      // Nothing left, so nothing to hold: rows that arrived appear at
      // once and the rows around them travel. The baseline the reflow
      // needs is the layout still on screen as this render runs, which is
      // exactly what the last commit recorded.
      setHeld(items);
      setLeaving(NOTHING);
      pending.current = last.current;
    } else {
      setLeaving(gone);
    }
  }

  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = globalThis.setTimeout(() => {
      // Measured here, between the collapse ending and the removal
      // committing, because this is the only frame where the layout is
      // the one the survivors are actually travelling from.
      const root = listRef.current;
      if (root !== null) pending.current = positionsOf(root);
      setHeld(next);
      setLeaving(NOTHING);
    }, DURATION.move);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [leaving, next]);

  // No dependency list: every commit refreshes the baseline, so a reflow
  // that is armed during render compares against the layout the viewer
  // was looking at rather than against whatever the last filter left
  // behind. React 19 runs this as a no-op on the server without
  // complaint, and nothing animates until something arms it.
  useLayoutEffect(() => {
    const root = listRef.current;
    if (root === null) return;
    const after = positionsOf(root);
    const from = pending.current;
    pending.current = undefined;
    last.current = after;
    if (from === undefined) return;
    play(movesBetween(from, after), shouldReduceMotion());
  });

  // Nothing leaving means nothing to hold: the caller's own array is the
  // answer, so a change that keeps every id — a garment being retired —
  // reaches the screen instead of being pinned to the last one that moved.
  const shown = leaving.size === 0 ? items : refreshed(held, items, keyOf);

  return { shown, leaving, listRef };
}
