import type { VerdictValue } from "../lib/contracts";

/**
 * The colours a chosen verdict wears, on every surface that shows one.
 *
 * **One table, because round 19 made it a mirror in both directions.**
 * DS2's backlog row was ruled in round 16 to be *"A3's five buttons,
 * shrunk … hue follows T2 (cold pink, dialed teal, warm quiet grey) and
 * position carries the degree"*. But A3's own board filled its chosen cell
 * `--action` pink whatever the verdict — pink meaning *selected* — and the
 * build filled it `--ink`, so the two surfaces that were supposed to read
 * the same read three different ways. Round 19: *"the chosen cell fills
 * with its T2 hue … exactly as DS2's row does; --action is never a verdict
 * fill."*
 *
 * Written once here and read by both, because two hand-kept copies of
 * "which colour is cold" is exactly the rival truth CLAUDE.md's "derive,
 * don't mirror" is about: nothing would make them disagree loudly.
 *
 * **Pink here is the cold hue, not the action colour.** They share a hex —
 * T1's `--cold-text` note says *"pink as a surface is #FF2D8A on both"* —
 * and T1 has no separate cold-surface role, so the class is spelled
 * `bg-action`. The rule round 19 made is about meaning: a cell is pink
 * because it is cold, never because it is the one you picked.
 *
 * Read from the value's sign, not its position, so both cold steps are
 * pink and both warm steps are grey — *"position carries the degree"* —
 * and the hue stays tied to what T2 says it means rather than to how many
 * keys a surface happens to offer.
 */
const COLD = "border-action bg-action text-accent-ink";
const DIALED = "border-teal bg-teal text-accent-ink";
const WARM = "border-quiet bg-quiet text-ground";

export function verdictHue(value: VerdictValue): string {
  if (value < 0) return COLD;
  if (value > 0) return WARM;
  return DIALED;
}
