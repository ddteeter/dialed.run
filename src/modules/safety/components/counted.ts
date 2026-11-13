/**
 * A count with its noun, plural unless it is one: "1 runner", "3 runners",
 * "0 reports". The Desk's lines (Duplicates, Corrections, Runners) all say
 * a count this way.
 */
export function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}
