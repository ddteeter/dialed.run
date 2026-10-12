import { vi } from "vitest";

import type { ZoneDeps } from "../../src/modules/onboarding";

/**
 * The place writer's zone lookup, answering `zone` for every place and
 * recording what it was asked (design 142).
 */
export function zonesAnswering(zone: string | undefined) {
  return {
    zoneAt: vi.fn<ZoneDeps["zoneAt"]>(() => Promise.resolve(zone)),
    report: vi.fn<ZoneDeps["report"]>(),
  };
}

/**
For the tests a place's zone is not about: the lookup names none.
*/
export const NO_ZONE: ZoneDeps = zonesAnswering(undefined);
