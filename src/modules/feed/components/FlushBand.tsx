import type { JSX, ReactNode } from "react";

/**
 * Where Feed and G set the confirm band (R55·211, R29): flush under the
 * header and edge to edge, out of the column's gutter and its top
 * padding, with the gutter put back inside. Hidden when the band draws
 * nothing, so a confirmed runner's page keeps its own spacing.
 */
export function FlushBand({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div
      data-part="flush-band"
      className="-mx-5 -mt-6 px-5 empty:hidden wide:-mx-6 wide:px-6"
    >
      {children}
    </div>
  );
}
