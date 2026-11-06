import type { JSX } from "react";

import { Mono } from "./Mono";

/**
 * Onboarding's steps, in order (round 47 #120, which redraws round 26's
 * four as three): the handle, then the city and the tap list, both
 * optional. P2.5 — naming what the tap list added — is not a step; it
 * keeps the tap list's kicker with the bar full.
 *
 * One table, so the count in "of 3", the bar's segments and which steps
 * say Optional cannot disagree.
 */
const ONBOARDING_STEPS = [
  { step: "handle", isOptional: false },
  { step: "city", isOptional: true },
  { step: "tapList", isOptional: true },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]["step"];

/**
 * The progress bar and the step kicker over an onboarding step's heading:
 * "STEP 2 OF 3 · OPTIONAL". The words are typed in sentence case and set
 * in capitals by `Mono`, so a screen reader hears words, not letters. The
 * bar repeats what the kicker says, so it is drawn, not said.
 */
export function OnboardingProgress({
  at,
}: Readonly<{ at: OnboardingStep }>): JSX.Element {
  const index = ONBOARDING_STEPS.findIndex(({ step }) => step === at);
  const isOptional = ONBOARDING_STEPS.some(
    (entry) => entry.step === at && entry.isOptional,
  );
  return (
    <div data-part="onboarding-progress" className="flex flex-col gap-6">
      {/* Each segment is a 2px rule, the only widths under SPACE[1] the
          contract has (tokens.js: "1px and 2px exist only as border
          widths"); the board's 3px bar and 6px gaps are not values. */}
      <div aria-hidden="true" className="flex gap-2">
        {ONBOARDING_STEPS.map(({ step }, segment) => (
          <span
            key={step}
            data-state={segment <= index ? "done" : undefined}
            className={
              segment <= index
                ? "flex-1 border-t-2 border-ink"
                : "flex-1 border-t-2 border-hairline"
            }
          />
        ))}
      </div>
      <Mono step="xs" className="text-muted">
        {`Step ${String(index + 1)} of ${String(ONBOARDING_STEPS.length)}${isOptional ? " · Optional" : ""}`}
      </Mono>
    </div>
  );
}
