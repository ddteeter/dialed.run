/**
 * An entry's audience as a seed writes it: the audience column and the
 * boolean it replaces, kept in step exactly as the app's writers keep them
 * until the booleans go (design 131, C1). Every seed goes through this, so
 * the suite and the demos read the same rows on both sides of PR B's read
 * flip. It imports nothing env-bound, so both Playwright and the vitest
 * suite (through `test/feed/helpers.ts`) load this one definition.
 */
import { isSharedAudience } from "../../src/lib/contracts";
import type { Audience } from "../../src/lib/contracts";

export function entryAudienceColumns(audience: Audience): {
  audience: Audience;
  legacyIsPublic: boolean;
} {
  return { audience, legacyIsPublic: isSharedAudience(audience) };
}
