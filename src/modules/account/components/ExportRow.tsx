import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import type { ExportRowState } from "../../../lib/contracts/data-export";
import { proseDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  ControlFailureBand,
  PendingLabel,
  inFlight,
  useControlAction,
  useIdempotencyKey,
} from "../../../ui";

/**
 * The row's sub-line for each state. Idle and preparing are round 27 #13's
 * words; ready and failed are undesigned (design deltas).
 */
function subLine(state: ExportRowState): string {
  switch (state.state) {
    case "idle": {
      return "Runs, closet, entries, photos and your run files";
    }
    case "preparing": {
      return "We'll email a link when it's ready.";
    }
    case "ready": {
      // UTC, so the server's first paint and the browser's agree.
      return `Emailed. The link works until ${proseDayLabel(state.expiresAt)}.`;
    }
    case "failed": {
      return "Your export didn't work. Try again.";
    }
  }
}

/**
 * U1's "Export your data" row (ACC-10; round 27 #13): Get a copy queues
 * the ZIP, and the row turns to `[ Preparing ]` and "We'll email a link
 * when it's ready." One a day: on the day a copy is ready the row offers
 * it instead. A control outside a form, so `useControlAction`'s — with a
 * key per press (law 8b), rotated once the server has it.
 */
export function ExportRow({
  state,
  request,
  onRequested,
}: Readonly<{
  state: ExportRowState;
  request: (input: {
    data: { idempotencyKey: string };
  }) => Promise<ExportRowState>;
  /**
  After the server answered: the route reloads the row's state.
  */
  onRequested: () => Promise<void>;
}>): JSX.Element {
  const { idempotencyKey, rotate } = useIdempotencyKey();
  const control = useControlAction<[]>({
    action: () => request({ data: { idempotencyKey } }),
    kicker: "Not started",
    onSuccess: async () => {
      rotate();
      await onRequested();
    },
  });
  return (
    <li data-part="export-row" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 border-b border-hairline py-3">
        <span className="flex flex-col gap-1">
          <span className="text-body font-semibold">Export your data</span>
          <span className="text-small text-muted">{subLine(state)}</span>
        </span>
        <ExportAction
          state={state}
          pending={control.pending}
          onRequest={() => {
            void control.run();
          }}
        />
      </div>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </li>
  );
}

function ExportAction({
  state,
  pending,
  onRequest,
}: Readonly<{
  state: ExportRowState;
  pending: boolean;
  onRequest: () => void;
}>): JSX.Element {
  if (state.state === "preparing") {
    return <Bracketed className="shrink-0">Preparing</Bracketed>;
  }
  if (state.state === "ready") {
    // A file the server answers with, not a page: fetched by the browser
    // as a download, never drawn by the router.
    return (
      <Link
        to="/account/export/$token"
        params={{ token: state.token }}
        reloadDocument
        download
        className="target shrink-0 text-body font-semibold text-ink underline underline-offset-4"
      >
        Download
      </Link>
    );
  }
  return (
    <button
      type="button"
      {...inFlight(pending)}
      onClick={onRequest}
      className="target shrink-0 cursor-pointer border-none bg-transparent p-0 text-body text-ink"
    >
      <PendingLabel
        label="Get a copy"
        pendingLabel="Preparing"
        pending={pending}
      />
    </button>
  );
}
