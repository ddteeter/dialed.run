import { useEffect, useState } from "react";
import type { JSX } from "react";

import {
  Bracketed,
  ControlFailureBand,
  FormStatus,
  ListSection,
  Mono,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import type { BlockedRunner } from "../blocks";
import { useSettled } from "./use-settled";

type Unblock = (input: { data: { userId: string } }) => Promise<unknown>;

/**
 * W2 · BLOCKED RUNNERS.
 *
 * **The explanation carries the screen, not the roster.** The artboard is
 * explicit that an empty list is the normal case, so "what blocking does"
 * is the page's body and the names are a footnote to it. Building this the
 * other way round — a list with a help link — would be a different screen
 * that happens to contain the same words.
 *
 * **The third line is the one that matters.** "Their verdicts count in
 * anonymous conditions numbers" pre-empts the question the conditions pool
 * would otherwise raise, and it is a claim about the code: nothing in
 * `blocks.ts` is imported by the consensus path, and `blocks.test.ts` pins
 * that from the outside.
 *
 * **Unblock is a control that can fail** (round 22, item 21; round 23,
 * item 9): no confirmation, and no optimism either. The row waits behind
 * `[ Unblocking ]`, leaves only once the server has said yes, and on a
 * failure keeps its place with a band inside it that says what is still
 * true — `Still blocked`.
 */
export function BlockedRunners({
  blocked,
  unblock,
}: Readonly<{
  blocked: readonly BlockedRunner[];
  unblock: Unblock;
}>): JSX.Element {
  const { remaining: visible, settle } = useSettled(
    blocked,
    (runner) => runner.userId,
  );
  // The screen's one status region (rule 08); every row speaks through it.
  const [status, setStatus] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <FormStatus>{status}</FormStatus>
      <section className="flex flex-col gap-2">
        <h2 className="text-quiet">
          <Mono step="xs">What blocking does</Mono>
        </h2>
        <ul className="flex flex-col gap-2 text-body">
          <li>
            <Bracketed>blocked</Bracketed> They can&apos;t see your entries,
            your closet, or find you in search
          </li>
          <li>
            <Bracketed>blocked</Bracketed> You won&apos;t see them in the feed
            or in search
          </li>
          <li>
            <Bracketed>still</Bracketed> Their verdicts count in anonymous
            conditions numbers — those name nobody
          </li>
        </ul>
        <p className="text-micro text-quiet">
          They&apos;re not told. Blocking is quiet on purpose.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <ListSection
          title="blocked"
          items={visible}
          count
          whenEmpty={
            // Round 22, item 21: "one line, no brackets".
            <p className="text-small text-quiet">
              You haven&apos;t blocked anyone.
            </p>
          }
        >
          {(runner) => (
            <BlockedRow
              key={runner.userId}
              runner={runner}
              unblock={unblock}
              onUnblocked={settle}
              announce={setStatus}
            />
          )}
        </ListSection>
        <p className="text-micro text-quiet">
          Nothing here is a list anyone else can see.
        </p>
      </section>
    </div>
  );
}

/**
 * One blocked runner, and the Unblock that belongs to them.
 *
 * A row per hook, so two rows can fail and retry independently and each
 * band sits inside the row it is about.
 */
function BlockedRow({
  runner,
  unblock,
  onUnblocked,
  announce,
}: Readonly<{
  runner: BlockedRunner;
  unblock: Unblock;
  onUnblocked: (userId: string) => void;
  announce: (sentence: string) => void;
}>): JSX.Element {
  const control = useControlAction<[]>({
    action: () => unblock({ data: { userId: runner.userId } }),
    kicker: "Still blocked",
    onSuccess: () => {
      onUnblocked(runner.userId);
    },
  });

  useEffect(() => {
    announce(control.status);
  }, [announce, control.status]);

  return (
    <li className="flex flex-col gap-3 text-body">
      <div className="flex items-center justify-between gap-3">
        <span>{runner.displayName ?? "A runner"}</span>
        <button
          className="target cursor-pointer border-none bg-transparent p-0"
          type="button"
          {...inFlight(control.pending)}
          onClick={() => {
            void control.run();
          }}
        >
          <Mono step="xs">
            <PendingLabel
              label="Unblock"
              pendingLabel="Unblocking"
              pending={control.pending}
            />
          </Mono>
        </button>
      </div>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </li>
  );
}
