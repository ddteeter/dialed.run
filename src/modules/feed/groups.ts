/**
 * Closet UI groups — the module's name for the shared contract.
 *
 * This file used to carry a second implementation: its own `GarmentCategory`
 * union, its own `uiGroups` list, and a `uiGroupFor` switch byte-identical
 * to the one in `lib/contracts`, with a header saying the duplication was
 * "by design ... the predicate table is the shared contract, the code is
 * not". That was the registered D-10, and the argument does not survive
 * contact with the failure mode: two switches over the same table drift
 * silently, because nothing makes them disagree loudly.
 *
 * The re-export stays so the feed's own files keep importing a feed name,
 * and so this file remains the place a reader looks for it.
 */
export { uiGroupFor, uiGroupLabels, uiGroups } from "../../lib/contracts";
export type { UiGroup } from "../../lib/contracts";
