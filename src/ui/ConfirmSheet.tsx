import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import { ControlFailureBand, FormStatus, inFlight, PendingLabel } from "./form";
import { Sheet } from "./Sheet";
import { useControlAction } from "./use-control-action";
import type { ControlAction } from "./use-control-action";

/**
 * The confirm's own content — the question, its cost, the verb — carried
 * unchanged from `ConfirmLink` through `OpenConfirm` to `ConfirmSheet` (see
 * `OpenConfirm`'s `...sheet` rest spread below). One type rather than three
 * copies of the same five fields: a link that opens a sheet says nothing of
 * its own about what the sheet says.
 */
interface ConfirmContent {
  heading: string;
  body: ReactNode;
  /**
  "Delete" — and the pending label, "Deleting", is its own prop.
  */
  verb: string;
  pendingVerb: string;
  /**
  Which confirm this is, for a caller that has several ("confirm-retire").
  */
  state?: string | undefined;
}

/**
 * A text link that opens a `ConfirmSheet` for one action, bound to it.
 *
 * The sheet and its action exist only while it is open, so the action is
 * always about this link's subject (never "whichever photo was last
 * asked about"), and its status region is only on the page while there
 * is something to say — one region per screen, as rule 08 asks.
 */
export function ConfirmLink({
  label,
  kicker,
  act,
  ...content
}: Readonly<
  ConfirmContent & {
    label: string;
    /**
    What is still true if it fails — "Not deleted".
    */
    kicker: string;
    /**
    The action. It resolves once there is nothing left to show here.
    */
    act: () => Promise<unknown>;
  }
>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="target cursor-pointer self-start border-none bg-transparent p-0 py-3 text-small text-label underline underline-offset-4"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        {label}
      </button>
      {isOpen ? (
        <OpenConfirm
          {...content}
          kicker={kicker}
          act={act}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : undefined}
    </>
  );
}

function OpenConfirm({
  kicker,
  act,
  onClose,
  ...sheet
}: Readonly<
  ConfirmContent & {
    kicker: string;
    act: () => Promise<unknown>;
    onClose: () => void;
  }
>): JSX.Element {
  const action = useControlAction({
    action: async () => {
      await act();
      onClose();
    },
    kicker,
  });
  return (
    <>
      <FormStatus>{action.status}</FormStatus>
      <ConfirmSheet open action={action} onClose={onClose} {...sheet} />
    </>
  );
}

/**
 * A destructive action's confirm, in round 22's shape ("Y Retire
 * confirm"): the question as the heading, what it costs as the body, the
 * verb on an ink primary that repeats the verb that opened it and is its
 * in-flight label too, and **Keep it** — where focus lands.
 *
 * *"No red and no pink: destruction isn't an alarm, and pink is the log
 * verb."* The action is a control, not a form: it waits behind its
 * in-flight label, and a failure is the control band under it (round 23,
 * item 9) with the sheet left open so Try again is right there.
 *
 * Built for task 128's deletes (an entry, a photo, a run), which have no
 * drawing of their own; they borrow the drawn garment confirm's grammar
 * rather than inventing one, and are listed as design deltas.
 */
export function ConfirmSheet({
  open,
  heading,
  body,
  verb,
  pendingVerb,
  action,
  onClose,
  state,
}: Readonly<
  ConfirmContent & {
    open: boolean;
    action: ControlAction<[]>;
    onClose: () => void;
  }
>): JSX.Element {
  // State rather than a ref, so the effect below re-runs once the button
  // exists: on a sheet that mounts already open, the first pass of that
  // effect runs before the ref callback has handed the button over.
  const [keep, setKeep] = useState<HTMLButtonElement | undefined>();

  useEffect(() => {
    if (open && keep !== undefined) keep.focus();
  }, [open, keep]);

  return (
    <Sheet open={open} onClose={onClose} label={heading}>
      <div data-part="sheet" data-state={state} className="flex flex-col gap-4">
        <h2 className="m-0 font-display text-heading">{heading}</h2>
        <p className="m-0 text-body text-quiet">{body}</p>
        <button
          type="button"
          data-part="primary-action"
          {...inFlight(action.pending)}
          onClick={() => {
            void action.run();
          }}
          className="target w-full cursor-pointer rounded-pill border-none bg-ink px-4 py-4 text-lead font-bold text-ground"
        >
          <PendingLabel
            label={verb}
            pendingLabel={pendingVerb}
            pending={action.pending}
          />
        </button>
        <ControlFailureBand
          failure={action.failure}
          onRetry={action.retry}
          retryRef={action.retryRef}
        />
        <button
          type="button"
          ref={(node) => {
            setKeep(node ?? undefined);
          }}
          onClick={onClose}
          className="target w-full cursor-pointer rounded-pill border border-hairline bg-transparent px-4 py-4 text-lead font-semibold text-ink"
        >
          Keep it
        </button>
      </div>
    </Sheet>
  );
}
