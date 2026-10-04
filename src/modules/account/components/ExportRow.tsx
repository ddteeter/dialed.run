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
 * The row's sub-line for each state: idle and preparing are round 27 #13's
 * words, ready and failed round 28 #15's. An idle row a refused link
 * opened says the link is dead, the same for an expired link and someone
 * else's (#15).
 */
function subLine(state: ExportRowState, isLinkDead: boolean): string {
  switch (state.state) {
    case "idle": {
      return isLinkDead
        ? "That link doesn't work any more. Get a copy for a new one."
        : "Runs, closet, entries, photos and your run files";
    }
    case "preparing": {
      return "We'll email a link when it's ready.";
    }
    case "ready": {
      // UTC, so the server's first paint and the browser's agree.
      return `Emailed. The link works until ${proseDayLabel(state.expiresAt)}.`;
    }
    case "failed": {
      return "Your export didn't finish, and it doesn't count as today's.";
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
  isLinkDead = false,
  request,
  onRequested,
}: Readonly<{
  state: ExportRowState;
  /**
  Whether a refused download link opened this page (`?export=expired`).
  */
  isLinkDead?: boolean | undefined;
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
          <span className="text-small text-muted">
            {subLine(state, isLinkDead)}
          </span>
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
        label={state.state === "failed" ? "Try again" : "Get a copy"}
        pendingLabel="Preparing"
        pending={pending}
      />
    </button>
  );
}
