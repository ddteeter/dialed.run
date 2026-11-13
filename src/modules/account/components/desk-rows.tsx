import { useEffect, useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import { FailureBand, useControlAction } from "../../../ui";

const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;
const DAY_S = 24 * HOUR_S;
/**
From here an age is a date (round 28 #9: "From 30 days on they show a date").
*/
const DATED_FROM_S = 30 * DAY_S;

/**
 * An age as round 28 #9 draws it, in MONO.sm capitals: `NOW` under a
 * minute, then whole minutes, hours and days (`12M`, `5H`, `3D`), and a
 * date (`AUG 29`) from 30 days. Lowercase here; the mono step's CSS sets
 * the capitals, so a screen reader hears "5h", not five letters.
 */
export function ageLabel(createdAt: number, asOf: number): string {
  const seconds = Math.max(0, asOf - createdAt);
  if (seconds < MINUTE_S) return "now";
  if (seconds < HOUR_S) return `${String(Math.floor(seconds / MINUTE_S))}m`;
  if (seconds < DAY_S) return `${String(Math.floor(seconds / HOUR_S))}h`;
  if (seconds < DATED_FROM_S) return `${String(Math.floor(seconds / DAY_S))}d`;
  return monthDayLabel(createdAt);
}

export type RowAction = (input: { data: { id: string } }) => Promise<unknown>;

/**
 * What each row action says when it fails, under its own row (round 29
 * #14): the state still true, and the board's sentence. The page-level
 * band is gone; only New code, which has no row yet, keeps the form's.
 */
const ROW_FAILURES = {
  invite: {
    kicker: "Not sent",
    sentence: "Send invite didn't go through. No email went out. Try again?",
  },
  decline: {
    kicker: "Still waiting",
    sentence:
      "Decline didn't go through. The request is still here. Try again?",
  },
  undo: {
    kicker: "Still revoked",
    sentence: "Undo didn't go through. Try again?",
  },
  revoke: {
    kicker: "Still active",
    sentence: "Revoke didn't go through. Try again?",
  },
} as const;

type RowFailureKind = keyof typeof ROW_FAILURES;

/**
 * One row action: in flight behind the server (never optimistic), which
 * row it was last pressed on, and that row's band. A failure is said once
 * in the page's one status region, in the band's own words; focus stays on
 * the control, and Try again repeats the same action on the same row.
 */
export function useRowAction({
  kind,
  act,
  onChanged,
  announce,
  onSuccess,
}: Readonly<{
  kind: RowFailureKind;
  act: RowAction;
  onChanged: () => Promise<void>;
  announce: (sentence: string) => void;
  onSuccess?: (() => void) | undefined;
}>) {
  const { kicker, sentence } = ROW_FAILURES[kind];
  const [target, setTarget] = useState<string>();
  const control = useControlAction<[string]>({
    kicker,
    action: async (id) => {
      await act({ data: { id } });
      await onChanged();
    },
    onSuccess,
  });
  const { failure } = control;
  useEffect(() => {
    if (failure !== undefined) announce(`${kicker}. ${sentence}`);
  }, [failure, announce, kicker, sentence]);
  return {
    isFailed: failure !== undefined,
    run: (id: string) => {
      setTarget(id);
      void control.run(id);
    },
    /**
    The band under `id`'s row, when this action failed there.
    */
    bandFor: (id: string): JSX.Element | undefined =>
      failure !== undefined && id === target ? (
        <FailureBand
          kicker={failure.kicker}
          message={sentence}
          onRetry={control.retry}
          retryRef={control.retryRef}
        />
      ) : undefined,
  };
}

/**
One row action, as a row uses it: press it on a row, and read that row's band.
*/
export type RowActionHandle = Pick<
  ReturnType<typeof useRowAction>,
  "run" | "bandFor"
>;
