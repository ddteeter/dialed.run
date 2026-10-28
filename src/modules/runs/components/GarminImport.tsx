import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import type { Units } from "../../../lib/contracts";
import {
  distanceNumber,
  formatDuration,
} from "../../../lib/contracts/measures";
import { dayLabel } from "../../../lib/dates";
import { newUlid } from "../../../lib/ids";
import {
  classifyFailure,
  ControlFailureBand,
  inFlight,
  Mono,
  Skeleton,
} from "../../../ui";
import type { ControlFailure } from "../../../ui";
import type {
  GarminImport as GarminImportResult,
  GarminPicker,
  GarminPickerRow,
} from "../garmin/service";

/**
 * The two server functions, handed in by the route, in their own shapes.
 */
export interface GarminImportActions {
  picker: () => Promise<GarminPicker | undefined>;
  importActivity: (input: {
    data: { activityId: string; idempotencyKey: string };
  }) => Promise<GarminImportResult | undefined>;
}

/**
An import the picker started, for A1's own watch to poll from here on.
*/
export type OnGarminImport = (started: {
  importId: string;
  label: string;
  strip: string;
  resend: () => void;
}) => void;

const NOT_LOADED: ControlFailure = {
  kicker: "Not loaded",
  message: "Garmin didn't answer.",
};

// Round 41 #87, G8: the import's own failure, in the list band's slot.
const NOT_IMPORTED: ControlFailure = {
  kicker: "Not imported",
  message: "Garmin didn't answer. Nothing was imported.",
};

/**
 * The runner's own zone: Garmin's list carries none, and the picker only
 * ever renders in the browser (it loads on mount), so this is the zone
 * the runner is reading in.
 */
function localZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function rowLabel(row: GarminPickerRow, units: Units): string {
  return `${dayLabel(row.startedAt, localZone())} · ${distanceNumber(row.distanceM, units.distance)} ${units.distance} · ${formatDuration(row.durationS)}`;
}

/**
 * Import from Garmin (plan 160, phase 1; design G3): a section of A1 under
 * the file well, for the one runner the Personal API key is for.
 *
 * IMPORT FROM GARMIN · LAST 10, a row per run — date · distance · time,
 * then "Garmin" — and IMPORT ›, or [IMPORTED] › opening the run it
 * became. It loads after A1 renders, so A1 never waits on Garmin.
 * Loading is three rows with breathing brackets; none is "No runs on
 * Garmin yet."; Garmin not answering is the §4a band with Try again. A
 * tap starts an ordinary import, and A1's own card takes it from there
 * (an activity already here comes back as A1's duplicate receipt).
 */
export function GarminImport({
  actions,
  units,
  onImport,
}: Readonly<{
  actions: GarminImportActions;
  units: Units;
  onImport: OnGarminImport;
}>): JSX.Element | undefined {
  const { picker, load } = usePicker(actions.picker);
  const tap = useImportTap(actions.importActivity, onImport, units);

  if (picker?.status === "off") return undefined;
  // From here the picker is loading, unreachable or ready.
  return (
    <section
      aria-labelledby="garmin-import"
      data-part="garmin-import"
      className="flex flex-col gap-2"
    >
      <h2 id="garmin-import" className="m-0">
        <Mono step="xs" className="text-muted">
          IMPORT FROM GARMIN · LAST 10
        </Mono>
      </h2>
      <PickerBody picker={picker} units={units} onRetryList={load} tap={tap} />
    </section>
  );
}

/**
 * Where the list has got to: still asking (`undefined`), answered, not
 * this runner's (`off`), or failed — with the band that says which way,
 * because Garmin not answering and the runner's own connection dropping
 * are different sentences.
 */
type PickerState =
  | GarminPicker
  | { status: "off" }
  | { status: "failed"; failure: ControlFailure }
  | undefined;

function usePicker(readPicker: GarminImportActions["picker"]) {
  const [picker, setPicker] = useState<PickerState>();
  async function refresh(): Promise<void> {
    setPicker(undefined);
    try {
      setPicker((await readPicker()) ?? { status: "off" });
    } catch (error) {
      setPicker({ status: "failed", failure: notLoaded(error) });
    }
  }
  function load(): void {
    void refresh();
  }
  // Once per source: the list is one call per open, and nothing polls
  // (Garmin may throttle without notice).
  useEffect(load, [readPicker]);
  return { picker, load };
}

function notLoaded(error: unknown): ControlFailure {
  return { ...NOT_LOADED, message: classifyFailure(error).message };
}

interface Tap {
  pendingId: string | undefined;
  failed:
    { row: GarminPickerRow; key: string; failure: ControlFailure } | undefined;
  start: (row: GarminPickerRow, key?: string) => void;
}

function useImportTap(
  importActivity: GarminImportActions["importActivity"],
  onImport: OnGarminImport,
  units: Units,
): Tap {
  const [pendingId, setPendingId] = useState<string>();
  const [failed, setFailed] = useState<Tap["failed"]>();

  function start(row: GarminPickerRow, key: string = newUlid()): void {
    // The guard `disabled` would have been (rule 07).
    if (pendingId !== undefined) return;
    setPendingId(row.activityId);
    setFailed(undefined);
    void send(row, key);
  }

  async function send(row: GarminPickerRow, key: string): Promise<void> {
    let result: GarminImportResult | undefined;
    try {
      result = await importActivity({
        data: { activityId: row.activityId, idempotencyKey: key },
      });
    } catch (error) {
      setPendingId(undefined);
      setFailed({
        row,
        key,
        failure: {
          ...NOT_IMPORTED,
          message: classifyFailure(error).message,
        },
      });
      return;
    }
    setPendingId(undefined);
    if (result?.status === "started") {
      onImport({
        importId: result.importId,
        label: `Garmin · ${rowLabel(row, units)}`,
        // The card's stats line has the date, distance and time (G9).
        strip: "From Garmin",
        resend: () => {
          start(row, key);
        },
      });
      return;
    }
    setFailed({ row, key, failure: NOT_IMPORTED });
  }

  return { pendingId, failed, start };
}

function PickerBody({
  picker,
  units,
  onRetryList,
  tap,
}: Readonly<{
  picker: Exclude<PickerState, { status: "off" }>;
  units: Units;
  onRetryList: () => void;
  tap: Tap;
}>): JSX.Element {
  if (picker === undefined) {
    return (
      <ul aria-busy="true" className="m-0 flex list-none flex-col gap-2 p-0">
        {[1, 2, 3].map((row) => (
          <li key={row} data-part="garmin-loading">
            <Skeleton className="h-11 w-full" />
          </li>
        ))}
      </ul>
    );
  }
  if (picker.status === "failed") {
    return (
      <ControlFailureBand failure={picker.failure} onRetry={onRetryList} />
    );
  }
  if (picker.status === "unreachable") {
    return <ControlFailureBand failure={NOT_LOADED} onRetry={onRetryList} />;
  }
  if (picker.rows.length === 0) {
    return <p className="m-0 text-small text-muted">No runs on Garmin yet.</p>;
  }
  const { failed } = tap;
  return (
    <>
      {/* Above the rows, in the list band's slot, so it never lands
      off-screen under a long list; a status region that is always there,
      so it is announced while focus stays on the row (round 41 #87, G8). */}
      <div role="status">
        {failed === undefined ? undefined : (
          <ControlFailureBand
            failure={failed.failure}
            onRetry={() => {
              // The same key: a download that landed before the answer was
              // lost must not become a second import (law 8b).
              tap.start(failed.row, failed.key);
            }}
          />
        )}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {picker.rows.map((row) => (
          <PickerRow
            key={row.activityId}
            row={row}
            units={units}
            isPending={tap.pendingId === row.activityId}
            onImport={() => {
              tap.start(row);
            }}
          />
        ))}
      </ul>
    </>
  );
}

function PickerRow({
  row,
  units,
  isPending,
  onImport,
}: Readonly<{
  row: GarminPickerRow;
  units: Units;
  isPending: boolean;
  onImport: () => void;
}>): JSX.Element {
  const label = rowLabel(row, units);
  return (
    <li
      data-part="garmin-row"
      className="flex items-center justify-between gap-3 border-b border-hairline py-2"
    >
      <span className="flex min-w-0 flex-col">
        <Mono step="sm">{label}</Mono>
        <span className="text-small text-quiet">Garmin</span>
      </span>
      {row.runId === undefined ? (
        <button
          type="button"
          aria-label={`Import ${label}`}
          {...inFlight(isPending)}
          onClick={onImport}
          className="target border-none bg-transparent p-0 font-mono text-mono-sm uppercase text-ink"
        >
          {isPending ? "Importing" : "Import ›"}
        </button>
      ) : (
        <Link
          to="/runs/$runId"
          params={{ runId: row.runId }}
          aria-label={`Imported: open ${label}`}
          className="target font-mono text-mono-sm uppercase text-muted no-underline"
        >
          [Imported] ›
        </Link>
      )}
    </li>
  );
}
