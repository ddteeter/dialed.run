import type { ComponentProps, JSX } from "react";

import { Mono } from "../../../ui";
import { PushBack, PushDone, PushPage, PushTitle } from "./PushPage";
import { SpecificsBody, specificsLine } from "./SpecificsSheet";

/**
 * A3b at the desk (Round 54 · 164.3): not a sheet but a push into the 620
 * column, as A2b is. The back link to A3, the title and the verdict it
 * qualifies, the garments and tags the sheet holds, then Done as the
 * flow's pink caps button. It edits A3's answer, not a copy, and both ways
 * out keep it: A3 is still there behind this page, unsaved.
 */
export function SpecificsPage({
  back,
  verdict,
  onDone,
  ...body
}: Readonly<
  ComponentProps<typeof SpecificsBody> & {
    /**
    The name of the screen the back link returns to: A3's question.
    */
    back: string;
    verdict: number | undefined;
    onDone: () => void;
  }
>): JSX.Element {
  return (
    <PushPage slot="specifics-page" back={<PushBack>{back}</PushBack>}>
      <div className="flex flex-col gap-1">
        <PushTitle>Anything specific?</PushTitle>
        <Mono step="xs" className="text-muted">
          {specificsLine(verdict)}
        </Mono>
      </div>
      <SpecificsBody {...body} />
      <PushDone onDone={onDone} />
    </PushPage>
  );
}
