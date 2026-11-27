import { useState } from "react";
import type { JSX } from "react";

import { DELETION_LINK_TTL_S } from "../../../../lib/contracts/garments";
import { proseDayLabel } from "../../../../lib/dates";
import {
  Bracketed,
  CHALK_PILL,
  ControlFailureBand,
  FormStatus,
  Mono,
  QUIET_CANCEL,
  QUIET_PILL,
  inFlight,
  useControlAction,
} from "../../../../ui";
import { useFocusWhen } from "../../components/use-focus-when";
import type { DeskRunner } from "../runners";
import {
  closedLineOf,
  closedPanelOf,
  closedStatusOf,
  type ClosedPanel,
} from "./closed-panel";

/**
Reopen account and Send deletion link: an act on the account by id.
*/
type OnAccount = (input: { data: { userId: string } }) => Promise<unknown>;

interface PanelProps {
  readonly runner: DeskRunner;
  /**
  The page's load time, in epoch seconds: what the link's state is read at.
  */
  readonly now: number;
  readonly reopen: OnAccount;
  readonly sendLink: OnAccount;
  readonly onDone: () => void;
}

/**
 * D8's closed account (round 64 #372–373): what is on record, where its
 * deletion stands, and the acts it has left. "Send deletion link" sits
 * beside Reopen, the same kind of pill, and neither is the panel's
 * primary: the Desk offers deletion, it doesn't do it. Once the runner
 * has chosen deletion there are none, since Reopen can't undo it.
 */
export function ClosedAccountPanel(props: PanelProps): JSX.Element {
  const panel = closedPanelOf(props.runner, props.now);
  const status = closedStatusOf(panel);
  return (
    <section className="flex flex-col gap-3 border border-hairline p-4">
      <h2 className="m-0">
        <Mono step="xs">Account closed</Mono>
      </h2>
      <p className="text-body">{closedLineOf(panel, props.runner.banReason)}</p>
      {status === undefined ? undefined : (
        <div data-part="deletion-status" className="flex flex-col gap-1">
          <Bracketed step="sm">{status.tag}</Bracketed>
          {status.line === undefined ? undefined : (
            <p className="m-0 text-small">{status.line}</p>
          )}
        </div>
      )}
      {panel.kind === "deleting" ? undefined : (
        <ClosedActs {...props} panel={panel} />
      )}
    </section>
  );
}

/**
 * Reopen, and the deletion link's pill while one can be sent. Its ask
 * replaces the pills in place, and Cancel hands focus back to the pill.
 */
function ClosedActs({
  runner,
  now,
  reopen,
  sendLink,
  onDone,
  panel,
}: PanelProps & { readonly panel: ClosedPanel }): JSX.Element {
  const [phase, setPhase] = useState<"pills" | "asking" | "cancelled">("pills");
  const reopening = useControlAction({
    action: () => reopen({ data: { userId: runner.userId } }),
    kicker: "Still closed",
    onSuccess: onDone,
  });
  const focusPill = useFocusWhen(phase === "cancelled");
  if (phase === "asking") {
    return (
      <LinkAsk
        runner={runner}
        now={now}
        sendLink={sendLink}
        onDone={onDone}
        onCancel={() => {
          setPhase("cancelled");
        }}
      />
    );
  }
  const isOffersLink = panel.kind === "offer" || panel.kind === "expired";
  return (
    <>
      <FormStatus>{reopening.status}</FormStatus>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          {...inFlight(reopening.pending)}
          className={`target ${QUIET_PILL}`}
          onClick={() => {
            void reopening.run();
          }}
        >
          Reopen account
        </button>
        {isOffersLink ? (
          <button
            type="button"
            ref={focusPill}
            className={`target ${QUIET_PILL}`}
            onClick={() => {
              setPhase("asking");
            }}
          >
            {panel.kind === "expired" ? "Send again" : "Send deletion link"}
          </button>
        ) : undefined}
      </div>
      <ControlFailureBand
        failure={reopening.failure}
        onRetry={reopening.retry}
        retryRef={reopening.retryRef}
      />
    </>
  );
}

/**
 * The ask (round 64 #372): to whom, until when, and that nothing is
 * deleted unless they use it. A failed send fails here, as NOT SENT.
 */
function LinkAsk({
  runner,
  now,
  sendLink,
  onDone,
  onCancel,
}: Readonly<{
  runner: DeskRunner;
  now: number;
  sendLink: OnAccount;
  onDone: () => void;
  onCancel: () => void;
}>): JSX.Element {
  const sending = useControlAction({
    action: () => sendLink({ data: { userId: runner.userId } }),
    kicker: "Not sent",
    onSuccess: onDone,
  });
  // Desk days are UTC.
  const until = proseDayLabel(now + DELETION_LINK_TTL_S);
  return (
    <div data-part="deletion-ask" className="flex flex-col gap-3">
      <p className="m-0 text-body">
        {`Send a deletion link to ${runner.maskedEmail}? It works once, until ${until}. Nothing is deleted unless they use it.`}
      </p>
      <FormStatus>{sending.status}</FormStatus>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          {...inFlight(sending.pending)}
          className={`target ${CHALK_PILL}`}
          onClick={() => {
            void sending.run();
          }}
        >
          Send link
        </button>
        <button
          type="button"
          className={`target ${QUIET_CANCEL}`}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
      <ControlFailureBand
        failure={sending.failure}
        onRetry={sending.retry}
        retryRef={sending.retryRef}
      />
    </div>
  );
}
