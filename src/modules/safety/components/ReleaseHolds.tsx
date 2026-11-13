import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";

import type { HoldCause } from "../../../lib/contracts/hold-causes";
import {
  FailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  Sheet,
  useControlAction,
} from "../../../ui";
import type { ControlAction } from "../../../ui";
import type { ReleaseOutcome, WaitingHolds } from "../release";
import { PhotoSection } from "./OtherPhotos";
import { useSettled } from "./use-settled";

/**
 * Releasing a burst of holds, at the top of Review (design 164): one line
 * per cause with holds still waiting from the last day, each with an
 * Approve-them-all behind a confirm. The breakers bound how many a bug can
 * hold an hour; this is the undo for the hours before anyone looked.
 *
 * Each release is many Approves, each told as one is, so the confirm says
 * so and says when to use it (round 45 #103). A finished release takes its
 * line off, and focus goes to the next line, else this section's heading,
 * else Review's.
 */
export function ReleaseHolds({
  bursts,
  since,
  release,
}: Readonly<{
  bursts: readonly WaitingHolds[];
  /**
  Epoch seconds the counted day starts: what each release is asked about.
  */
  since: number;
  release: ReleaseHoldsFn;
}>): JSX.Element | undefined {
  const { remaining, settle } = useSettled(bursts, causeOf);
  const landing = useLanding();
  if (remaining.length === 0) return undefined;
  return (
    <PhotoSection
      part="release-holds"
      level={2}
      title="Held in the last day"
      titleRef={landing.titleRef}
    >
      <ul
        ref={landing.listRef}
        className="m-0 flex list-none flex-col gap-2 p-0"
      >
        {remaining.map((burst, index) => (
          <ReleaseLine
            key={burst.cause}
            burst={burst}
            since={since}
            release={release}
            onReleased={() => {
              settle(burst.cause);
              landing.landAt(index);
            }}
          />
        ))}
      </ul>
    </PhotoSection>
  );
}

function causeOf(burst: WaitingHolds): string {
  return burst.cause;
}

/**
 * Where focus lands once a line has left: the line now at its place, else
 * the section's heading, else, with no lines left, Review's own.
 */
function useLanding(): {
  listRef: (node: HTMLUListElement | null) => void;
  titleRef: (node: HTMLSpanElement | null) => void;
  landAt: (index: number) => void;
} {
  const list = useRef<HTMLUListElement | null>(null);
  const title = useRef<HTMLSpanElement | null>(null);
  const [at, setAt] = useState<number | undefined>();
  useEffect(() => {
    if (at === undefined) return;
    setAt(undefined);
    const next = list.current?.querySelectorAll<HTMLElement>(
      ":scope > li > button",
    )[at];
    const page = globalThis.document.querySelector<HTMLElement>("h1");
    (next ?? title.current ?? page)?.focus();
  }, [at]);
  return {
    listRef: (node) => {
      list.current = node;
    },
    titleRef: (node) => {
      title.current = node;
    },
    landAt: setAt,
  };
}

/**
 * One cause's line and its Approve-them-all, which opens the release's
 * sheet.
 */
function ReleaseLine({
  burst,
  since,
  release,
  onReleased,
}: Readonly<{
  burst: WaitingHolds;
  since: number;
  release: ReleaseHoldsFn;
  onReleased: () => void;
}>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  return (
    // The board's ruled row: the cause left, its one action right, bold
    // and in ink (G-16).
    <li
      data-part="release-line"
      className="flex flex-wrap items-center justify-between gap-x-4 border-b border-hairline"
    >
      <Mono step="xs">{`${CAUSE_LABEL[burst.cause]} · ${String(burst.waiting)} waiting`}</Mono>
      <button
        type="button"
        className="target cursor-pointer border-none bg-transparent p-0 text-body font-bold text-ink underline underline-offset-4"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        {`Approve all ${String(burst.waiting)}`}
      </button>
      {isOpen ? (
        <ReleaseSheet
          burst={burst}
          run={{ release, since, onReleased }}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : undefined}
    </li>
  );
}

/**
 * The release's confirm, in round 22's shape (round 45 #103): the
 * question, what it does, Approve all and Keep it, focused. While it
 * works the button counts what is done and Keep it becomes Stop, and
 * neither Esc nor the scrim closes it. Stopped, or failed part-way, it
 * says how far it got, offers Approve the rest, and Keep it is focused
 * again. Finished, it closes and the line leaves.
 */
function ReleaseSheet({
  burst,
  run,
  onClose,
}: Readonly<{
  burst: WaitingHolds;
  run: Readonly<{
    release: ReleaseHoldsFn;
    since: number;
    onReleased: () => void;
  }>;
  onClose: () => void;
}>): JSX.Element {
  const { cause, waiting } = burst;
  const releasing = useRelease(burst, run);
  const { action, approved } = releasing;
  const heading = `Approve ${String(waiting)} ${CAUSE_NOUN[cause]}?`;
  const close = (): void => {
    releasing.refresh();
    onClose();
  };
  return (
    <>
      <FormStatus>{action.status}</FormStatus>
      <Sheet open isLocked={action.pending} onClose={close} label={heading}>
        <div
          data-part="sheet"
          data-state={`confirm-release-${cause}`}
          className="flex flex-col gap-4"
        >
          <h2 className="m-0 font-display text-heading">{heading}</h2>
          <p className="m-0 text-body text-quiet">
            Each one is approved as if you&apos;d pressed Approve on it: it goes
            back where an Approve puts it, and whoever Approve would tell is
            told. Use this when a bug held them, not to skip looking.
          </p>
          <ReleaseEnded
            ending={releasing.ending}
            sentence={`Approved ${String(approved)} of ${String(waiting)}. The other ${String(waiting - approved)} ${waiting - approved === 1 ? "is" : "are"} still waiting.`}
          />
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
              label={
                releasing.ending === undefined
                  ? "Approve all"
                  : "Approve the rest"
              }
              pendingLabel={
                approved === 0
                  ? "Approving"
                  : `Approved ${String(approved)} of ${String(waiting)}`
              }
              pending={action.pending}
            />
          </button>
          <SecondPress
            isWorking={action.pending}
            onStop={releasing.stop}
            onKeep={close}
          />
        </div>
      </Sheet>
    </>
  );
}

/**
 * How a release that did not finish ended, or `undefined` while none has.
 */
type Ending = "stopped" | "failed" | undefined;

/**
 * Where a release that did not finish stopped: Stop pressed, or a batch
 * that failed (§4a), each saying how far it got.
 */
function ReleaseEnded({
  ending,
  sentence,
}: Readonly<{
  ending: Ending;
  sentence: string;
}>): JSX.Element | undefined {
  if (ending === undefined) return undefined;
  return (
    <FailureBand
      kicker={ending === "stopped" ? "Stopped" : "Not finished"}
      message={sentence}
      state={ending}
    />
  );
}

/**
 * Keep it, focused whenever it is drawn; while the release works, Stop in
 * its place, which lets the batch in flight finish.
 */
function SecondPress({
  isWorking,
  onStop,
  onKeep,
}: Readonly<{
  isWorking: boolean;
  onStop: () => void;
  onKeep: () => void;
}>): JSX.Element {
  // State rather than a ref, so the effect runs once the button exists.
  const [keep, setKeep] = useState<HTMLButtonElement | undefined>();
  useEffect(() => {
    keep?.focus();
  }, [keep]);
  return isWorking ? (
    <button type="button" onClick={onStop} className={SECOND_PRESS}>
      Stop
    </button>
  ) : (
    <button
      type="button"
      ref={(node) => {
        setKeep(node ?? undefined);
      }}
      onClick={onKeep}
      className={SECOND_PRESS}
    >
      Keep it
    </button>
  );
}

const SECOND_PRESS =
  "target w-full cursor-pointer rounded-pill border border-hairline bg-transparent px-4 py-4 text-lead font-semibold text-ink";

/**
 * A release, run a batch a press until nothing is left or Stop is asked
 * for, counting what is approved across every run (owner, 2026-11-02). A
 * failed batch is the control's failure, kicker NOT FINISHED; its band is
 * drawn by the sheet with how far it got.
 */
function useRelease(
  burst: WaitingHolds,
  run: Readonly<{
    release: ReleaseHoldsFn;
    since: number;
    onReleased: () => void;
  }>,
): {
  action: ControlAction<[]>;
  approved: number;
  ending: Ending;
  stop: () => void;
  refresh: () => void;
} {
  const router = useRouter();
  const [approved, setApproved] = useState(0);
  const [isStopped, setIsStopped] = useState(false);
  const stopAsked = useRef(false);
  const action = useControlAction({
    kicker: "Not finished",
    action: async () => {
      setIsStopped(false);
      let isDone: boolean;
      try {
        isDone = await didReleaseAll({
          release: run.release,
          input: { cause: burst.cause, since: run.since },
          onBatch: (released) => {
            setApproved((total) => total + released);
          },
          shouldStop: () => stopAsked.current,
        });
      } finally {
        // A Stop is spent by the run it stopped, failed or not.
        stopAsked.current = false;
      }
      if (!isDone) {
        setIsStopped(true);
        return;
      }
      run.onReleased();
      await router.invalidate();
    },
  });
  return {
    action,
    approved,
    ending: endingOf(action.failure !== undefined, isStopped),
    stop: () => {
      stopAsked.current = true;
    },
    // What a part-way release approved leaves the page's counts behind.
    refresh: () => {
      if (approved > 0) void router.invalidate();
    },
  };
}

/**
The release server function's own shape, handed down from the route.
*/
export type ReleaseHoldsFn = (input: {
  data: { cause: HoldCause; since: number };
}) => Promise<ReleaseOutcome>;

/**
 * How a run that did not finish ended: a failed batch outranks Stop, since
 * the batch Stop waited on is the one that failed.
 */
function endingOf(hasFailed: boolean, isStopped: boolean): Ending {
  if (hasFailed) return "failed";
  return isStopped ? "stopped" : undefined;
}

/**
 * Presses `release` until nothing of the cause since the day's start is
 * left, or `shouldStop` says so after a batch: each call releases a
 * bounded batch and says whether more wait. `onBatch` hears how many each
 * released. True when nothing is left.
 */
async function didReleaseAll({
  release,
  input,
  onBatch,
  shouldStop,
}: Readonly<{
  release: ReleaseHoldsFn;
  input: { cause: HoldCause; since: number };
  onBatch: (released: number) => void;
  shouldStop: () => boolean;
}>): Promise<boolean> {
  let hasMore = true;
  while (hasMore && !shouldStop()) {
    const outcome = await release({ data: input });
    onBatch(outcome.released);
    hasMore = outcome.hasMore;
  }
  return !hasMore;
}

const CAUSE_LABEL: Readonly<Record<HoldCause, string>> = {
  reports: "Reports",
  classifier: "Screener",
  fingerprint: "Fingerprint matches",
};

const CAUSE_NOUN: Readonly<Record<HoldCause, string>> = {
  reports: "reported items",
  classifier: "screener holds",
  fingerprint: "fingerprint holds",
};
