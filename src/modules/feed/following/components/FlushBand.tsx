import type { JSX, ReactNode } from "react";

/**
 * Where Feed and G set the confirm band (R55·211, R29): flush under the
 * header, out of the column's top padding. On a phone it runs edge to
 * edge, out of the gutter with the gutter put back inside. From 720 the
 * column has no gutter (R57·263) and nothing bleeds past it (R59·319):
 * the band's box sits on the content edge with the cards and pads its own
 * text 16. Hidden when the band draws nothing, so a confirmed runner's
 * page keeps its own spacing.
 */
export function FlushBand({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div
      data-part="flush-band"
      className="-mx-5 -mt-6 px-5 empty:hidden wide:mx-0 wide:px-4"
    >
      {children}
    </div>
  );
}
