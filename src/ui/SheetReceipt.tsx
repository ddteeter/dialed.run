import type { JSX, ReactNode } from "react";

import { focusOnMount } from "./focus-on-mount";
import { Mono } from "./Mono";

/**
 * A sheet's receipt, swapped in place of its form (round 42's report
 * receipt; R48·129d's correction receipt "the same as 84's"): a MONO
 * kicker naming what was sent, a heading that takes focus so the swap is
 * read out, what happens next, then Done. No toast.
 */
export function SheetReceipt({
  part,
  kicker,
  heading,
  children,
  onDone,
}: Readonly<{
  /**
  The receipt's `data-part`, which a test and the conformance harness find.
  */
  part: string;
  kicker: string;
  heading: string;
  /**
  What happens next: a sentence, and anything after it.
  */
  children: ReactNode;
  onDone: () => void;
}>): JSX.Element {
  return (
    <div data-part={part} className="flex flex-col gap-4">
      <Mono step="xs" className="text-muted">
        {kicker}
      </Mono>
      <h2 ref={focusOnMount} tabIndex={-1} className="m-0 text-title font-bold">
        {heading}
      </h2>
      {children}
      <button
        type="button"
        onClick={onDone}
        className="target grid min-h-13 w-full cursor-pointer place-items-center rounded-card border-none bg-ink px-6 font-display text-body uppercase text-ground"
      >
        Done
      </button>
    </div>
  );
}
