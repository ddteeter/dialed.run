/**
 * The set with `member` added if it was absent, removed if it was present —
 * as a new set, never the one passed in.
 *
 * `AttachKit` toggles a garment in the chosen kit and `VerdictForm` toggles
 * a tag, and both had written the same five lines inside a `setState`
 * updater. It is a real idiom rather than a rhyme: the copy-into-a-new-set
 * is what makes React see a change at all, and a version that mutated
 * `prev` would leave the checkbox visually stuck while the state underneath
 * moved.
 */
export function toggledIn<TMember>(
  set: ReadonlySet<TMember>,
  member: TMember,
): Set<TMember> {
  const next = new Set(set);
  if (next.has(member)) next.delete(member);
  else next.add(member);
  return next;
}
