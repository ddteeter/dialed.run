/**
 * A count in words, one for one: "1 run", "2 runs" (R55·209b; delta R46's
 * "singular for one"). The caller names both forms, so "Following" can
 * stay itself.
 */
export function counted(value: number, one: string, many: string): string {
  return `${String(value)} ${value === 1 ? one : many}`;
}
