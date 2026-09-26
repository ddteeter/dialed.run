import type { JSX } from "react";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { bandLabel } from "../../../lib/temperature";
import {
  ControlFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  Sheet,
  useControlAction,
} from "../../../ui";
import { SET_CONDITION_BANDS } from "../run-conditions";

/**
 * The server functions, handed in rather than imported, in their own shape
 * — a component never reaches `../functions` (CLAUDE.md).
 */
export interface ConditionsActions {
  setConditions: (input: {
    data: { runId: string; bandFloorC: number };
  }) => Promise<boolean>;
  retryWeather: (input: { data: { runId: string } }) => Promise<boolean>;
}

/**
 * The state a failed pick or retry leaves true: the run still has no
 * conditions. The word is R's own row ("NO CONDITIONS").
 */
const STILL_TRUE = "No conditions";

/**
 * R2b — "No weather saved" (Remaining Screens R2b), opened from run
 * detail's "No conditions · Set ›" and the list's "SET CONDITIONS ›"
 * (round 22). *"A whole-form failure, so it's outlined, not yellow — the
 * fix isn't in the form."*
 *
 * **Set conditions picks, never types** (round 22: *"the runner picks from
 * what R2b offers and never types a number"*). What it offers is the app's
 * 5 °C bands in the runner's own unit, and a pick is stored as the band's
 * middle with `source='manual'`. **Try again** asks the provider once more.
 * Both wait behind their in-flight label and fail as a control does, with
 * the band saying what is still true.
 */
export function SetConditionsSheet({
  runId,
  units,
  open,
  onClose,
  onDone,
  actions,
}: Readonly<{
  runId: string;
  units: Units;
  open: boolean;
  onClose: () => void;
  /**
  After either lands: the caller reloads the run and closes the sheet.
  */
  onDone: () => Promise<void>;
  actions: ConditionsActions;
}>): JSX.Element {
  const [isPicking, setIsPicking] = useState(false);
  const [chosen, setChosen] = useState<number | undefined>();
  const pick = useControlAction({
    kicker: STILL_TRUE,
    action: async (bandFloorC: number) =>
      actions.setConditions({ data: { runId, bandFloorC } }),
    onSuccess: onDone,
  });
  const retry = useControlAction({
    kicker: STILL_TRUE,
    action: async () => actions.retryWeather({ data: { runId } }),
    onSuccess: onDone,
  });
  // The one band speaks for whichever control failed — its failure, its
  // Try again and its ref together, so the band can never retry one
  // control while holding the other's button.
  const failed = pick.failure === undefined ? retry : pick;

  return (
    <Sheet open={open} onClose={onClose} label="No weather saved">
      <div className="flex flex-col gap-3">
        <FormStatus>{pick.status || retry.status}</FormStatus>
        <Mono step="xs" className="text-muted">
          No history for that time
        </Mono>
        <div
          data-slot="weather-unavailable"
          className="flex flex-col items-start gap-3 border border-ink p-4"
        >
          <h2 className="m-0">
            <Mono step="sm">No weather saved</Mono>
          </h2>
          <p className="m-0 text-body">
            We have no record for that hour. Set the conditions yourself and the
            run still counts.
          </p>
          {isPicking ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-label">
                <Mono step="sm">Conditions</Mono>
              </legend>
              <div className="flex flex-wrap gap-2">
                {SET_CONDITION_BANDS.map((floor) => (
                  <button
                    key={floor}
                    type="button"
                    {...inFlight(pick.pending)}
                    onClick={() => {
                      setChosen(floor);
                      void pick.run(floor);
                    }}
                    className="target rounded-pill border border-hairline px-3 text-body"
                  >
                    <PendingLabel
                      label={bandLabel(floor, units.temp)}
                      pendingLabel="Setting"
                      pending={pick.pending && chosen === floor}
                    />
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsPicking(true);
                }}
                className="target rounded-field border-none bg-ink px-4 text-body font-bold text-ground"
              >
                Set conditions
              </button>
              <button
                type="button"
                {...inFlight(retry.pending)}
                onClick={() => {
                  void retry.run();
                }}
                className="target rounded-field border border-ink bg-transparent px-4 text-body font-semibold"
              >
                <PendingLabel
                  label="Try again"
                  pendingLabel="Trying"
                  pending={retry.pending}
                />
              </button>
            </div>
          )}
        </div>
        <ControlFailureBand
          failure={failed.failure}
          onRetry={failed.retry}
          retryRef={failed.retryRef}
        />
      </div>
    </Sheet>
  );
}
