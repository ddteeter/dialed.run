/**
 * An entry's audience as an e2e seed writes it: the audience column and
 * the boolean it replaces, kept in step exactly as the app's writers keep
 * them until the booleans go (design 131, C1). Every seed goes through
 * this, so the demos read the same rows on both sides of PR B's read flip.
 *
 * The suite's twin is `test/feed/helpers.ts`'s `entryAudienceColumns`;
 * that one imports the workers env, which Playwright cannot load.
 */
import { isSharedAudience } from "../../src/lib/contracts";
import type { Audience } from "../../src/lib/contracts";

export function entryAudienceColumns(audience: Audience): {
  audience: Audience;
  isPublic: boolean;
} {
  return { audience, isPublic: isSharedAudience(audience) };
}
