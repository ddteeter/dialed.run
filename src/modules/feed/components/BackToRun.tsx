import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Icon } from "../../../ui";

/**
 * "← Back" above A2's and A3's titles, at both widths (Round 55 · 242, as
 * Round 54 · 169.1 sets a sub-page's way back). It goes to the run the kit
 * and the verdict are for: A2 for a run that already has its kit sends the
 * runner on to A3, so the step before A3 is not somewhere to go back to.
 */
export function BackToRun({ runId }: Readonly<{ runId: string }>): JSX.Element {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId }}
      className="target inline-flex items-center gap-2 self-start text-body text-ink no-underline"
    >
      <Icon name="back" size={20} />
      Back
    </Link>
  );
}
