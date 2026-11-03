/**
 * The tap list's placeholder test, on its own so that garment detail's
 * link read (`garment-link.ts`) can ask it without importing `tap-list.ts`,
 * which imports `service.ts`, which imports `garment-link.ts`.
 */
import { TAP_LIST } from "./tap-list-data";

/**
 * Whether a row still carries the name the tap list gave it — "Merino
 * base layer" in its category — which is what a brand-only name leaves
 * behind (P2.5 rule 04: a brand and no model keeps the row's own name).
 * Read from the table, never a second copy of its names.
 *
 * The link a confirmation owes (design 133, D-113 Q1) asks it: a row named
 * by an unconfirmed runner carries a typed brand and no product, and only
 * this tells "Smartwool, no model" from "Smartwool Merino 150", so the
 * first joins the shared brands and never invents a product named after
 * a placeholder.
 */
export function isTapListPlaceholder(
  row: Readonly<{ category: string; name: string }>,
): boolean {
  return TAP_LIST.some(
    ({ garment }) =>
      garment.category === row.category && garment.name === row.name,
  );
}
