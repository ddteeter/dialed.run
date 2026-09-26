import { Link, useRouter } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { clockLabel, dayLabel } from "../../../lib/dates";
import { distanceNumber, formatPace } from "../../../lib/measures";
import { Mono } from "../../../ui";
import type { RunSummary } from "../service";
import { ConditionsRow } from "./ConditionsBlock";
import { SetConditionsSheet } from "./SetConditionsSheet";
import type { ConditionsActions } from "./SetConditionsSheet";

/**
 * Where a run came from, as the run strip names it — R1 calls hand entry
 * "BY HAND".
 */
const SOURCE_WORDS: Readonly<Record<RunSummary["source"], string>> = {
  file: "File",
  manual: "By hand",
};

export interface RunDetailProps {
  run: RunSummary;
  units: Units;
  actions: ConditionsActions;
}

/**
 * A run before its kit (round 22, "R Run before kit") — the only thing
 * such a run is waiting for is what the runner wore, so that is the
 * primary, in the log verb's pink, into A2 → A3. A run with an entry never
 * reaches here: the route sends it on to its verdict or its post.
 *
 * **No inputs on this screen.** The manual-temperature form is gone, for
 * one row: weather that arrived is A1's ink block, read-only; weather that
 * never came is "No conditions · Set ›", which opens R2b.
 */
export function RunDetail({
  run,
  units,
  actions,
}: Readonly<RunDetailProps>): JSX.Element {
  const router = useRouter();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const zone = run.conditions?.timeZone;

  return (
    <div className="flex flex-col gap-4">
      <div
        data-slot="run-strip"
        className="flex flex-col gap-2 border-b border-hairline pb-4"
      >
        <Mono step="xs" className="text-muted">
          {`${dayLabel(run.startedAt, zone)} · ${clockLabel(run.startedAt, zone)} · ${SOURCE_WORDS[run.source]}`}
        </Mono>
        <p className="m-0 flex items-baseline gap-3">
          <span className="font-display text-display uppercase">
            {`${distanceNumber(run.distanceM, units.distance)} ${units.distance}`}
          </span>
          <Mono step="sm" className="text-label">
            {formatPace(run.durationS, run.distanceM, units.distance)}
          </Mono>
        </p>
      </div>

      <ConditionsRow
        run={run}
        units={units}
        onSet={() => {
          setIsSheetOpen(true);
        }}
      />

      <div data-slot="kit" data-state="empty" className="flex flex-col gap-1">
        <Mono step="xs" className="text-muted">
          Kit
        </Mono>
        <p className="m-0 text-body">
          No kit yet. Without one, this run can&rsquo;t teach your closet
          anything.
        </p>
      </div>

      <Link
        to="/feed/attach/$runId"
        params={{ runId: run.id }}
        data-slot="primary-action"
        className="target flex items-center justify-center rounded-card bg-action px-6 py-4 font-display text-body uppercase text-ink no-underline"
      >
        What did you wear?
      </Link>

      <SetConditionsSheet
        runId={run.id}
        units={units}
        open={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
        }}
        onDone={async () => {
          setIsSheetOpen(false);
          await router.invalidate();
        }}
        actions={actions}
      />
    </div>
  );
}
