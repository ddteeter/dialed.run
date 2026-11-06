import type { JSX } from "react";

import { STATUTORY_LINE } from "../contracts";

/**
 * What "intimate" means, said to the operator on a row an intimate-image
 * report or a `/takedown` request opened (D-161 2). Placeholder placement
 * until Design rules (design 176).
 */
export function StatutoryLine(): JSX.Element {
  return (
    <p data-part="statutory-line" className="m-0 text-small text-quiet">
      {STATUTORY_LINE}
    </p>
  );
}
