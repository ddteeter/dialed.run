import type { JSX } from "react";

import { STATUTORY_LINE } from "../contracts";

/**
 * What "intimate" means, said to the operator on a row an intimate-image
 * report or a `/takedown` request opened (D-161 2): under the reason, on
 * its own line, in MONO.xs `--muted` and sentence case (R47·126). The
 * step's classes are written out rather than taken from `Mono`, whose xs
 * step is uppercase: `normal-case` beside it loses, since `.uppercase`
 * comes later in the stylesheet.
 */
export function StatutoryLine(): JSX.Element {
  return (
    <p
      data-part="statutory-line"
      className="m-0 font-mono text-mono-xs text-muted"
    >
      {STATUTORY_LINE}
    </p>
  );
}
