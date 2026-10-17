import { vi } from "vitest";

import type { SaveZoneDeps } from "../../src/modules/onboarding";

/**
 * The place writer's zone lookup, answering `zone` for every place and
 * recording what it was asked (design 142). The background work the writer
 * hands to `keepAlive` is collected, and `settled()` waits for it, which is
 * what a test does in place of the platform's `waitUntil`.
 */
export function zonesAnswering(zone: string | undefined) {
  const kept: Promise<unknown>[] = [];
  return {
    zoneAt: vi.fn<SaveZoneDeps["zoneAt"]>(() => Promise.resolve(zone)),
    report: vi.fn<SaveZoneDeps["report"]>(),
    keepAlive: vi.fn<SaveZoneDeps["keepAlive"]>((work) => {
      kept.push(work);
    }),
    settled: () => Promise.all(kept),
  };
}

/**
For the tests a place's zone is not about: the lookup names none.
*/
export const NO_ZONE = zonesAnswering(undefined);
