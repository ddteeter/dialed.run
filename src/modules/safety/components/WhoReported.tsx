import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import {
  ControlFailureBand,
  Mono,
  inFlight,
  useControlAction,
} from "../../../ui";
import { reportReasonLabels } from "../contracts";
import type { Reporter } from "../review-audit";

export type LoadReporters = (input: {
  data: { queueId: string };
}) => Promise<readonly Reporter[]>;

/**
 * Operator Screens D1's WHO REPORTED ▸ (D-164, R-66): folded, and opening
 * it is logged. The names are read only when it opens, by the call that
 * writes the record, so a closed fold has nothing in it to leak. Once
 * open it stays open: the record is of the look, and a second look in
 * the same sitting is the same one.
 *
 * The list's own look is undrawn (placeholder protocol): one line per
 * reporter, the handle, what they picked and when, in the queue's own
 * type. A design-ask covers it.
 */
export function WhoReported({
  queueId,
  load,
}: Readonly<{ queueId: string; load: LoadReporters }>): JSX.Element {
  const [reporters, setReporters] = useState<readonly Reporter[] | undefined>();
  const opening = useControlAction({
    action: async () => {
      setReporters(await load({ data: { queueId } }));
    },
    kicker: "Still folded",
  });
  const isOpen = reporters !== undefined;
  return (
    <div data-part="who-reported" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={isOpen}
        {...inFlight(opening.pending)}
        onClick={() => {
          if (!isOpen) void opening.run();
        }}
        className="target cursor-pointer self-start border-none bg-transparent p-0 text-ink"
      >
        <Mono step="xs">
          Who reported <span aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
        </Mono>
      </button>
      {isOpen ? (
        <ReporterList reporters={reporters} />
      ) : (
        <p className="m-0 text-micro text-quiet">
          Folded. Opening it is logged. Never shown to the author.
        </p>
      )}
      <ControlFailureBand
        failure={opening.failure}
        onRetry={opening.retry}
        retryRef={opening.retryRef}
      />
    </div>
  );
}

function ReporterList({
  reporters,
}: Readonly<{ reporters: readonly Reporter[] }>): JSX.Element {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-micro">
      {reporters.map((reporter, index) => (
        <li key={index} className="wrap-anywhere">
          {reporter.handle === null
            ? "A closed account"
            : `@${reporter.handle}`}{" "}
          · {reportReasonLabels[reporter.reason]} ·{" "}
          {monthDayLabel(reporter.createdAt, "UTC")}
        </li>
      ))}
    </ul>
  );
}
