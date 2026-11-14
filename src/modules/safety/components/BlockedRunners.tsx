import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import { monthDayLabel } from "../../../lib/dates";
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
      {/* W2's bordered card (B-01): the tags hang in their own column,
          so a second line wraps under the words, not under the tag. */}
      <section
        data-part="blocking-explained"
        className="flex flex-col gap-3 rounded-card border border-hairline p-4"
      >
        <h2 className="text-quiet">
          <Mono step="xs">What blocking does</Mono>
        </h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
          <Effect tag="blocked">
            They can&apos;t see your entries, your closet, or find you in search
          </Effect>
          <Effect tag="blocked">
            You won&apos;t see them in the feed or in search
          </Effect>
          <Effect tag="still">
            Their verdicts count in anonymous conditions numbers — those name
            nobody
          </Effect>
        </ul>
        <p className="m-0 text-small text-quiet">
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
      </section>
      {/* W2's tinted closing note, its first sentence back (P3-10). */}
      <p
        data-part="blocked-note"
        className="m-0 bg-tint p-4 text-body text-quiet"
      >
        Unblocking takes effect immediately and doesn&apos;t re-follow anyone.
        Nothing here is a list anyone else can see.
      </p>
    </div>
  );
}

/**
 * One line of what blocking does: its tag in a hanging column, then the
 * words, which wrap in their own column.
 */
function Effect({
  tag,
  children,
}: Readonly<{ tag: "blocked" | "still"; children: ReactNode }>): JSX.Element {
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2">
      <Bracketed step="xs" className="text-quiet">
        {tag}
      </Bracketed>
      <span>{children}</span>
    </li>
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
    <li
      data-part="blocked-row"
      className="flex flex-col gap-3 rounded-card border border-hairline bg-panel p-4 text-body"
    >
      <div className="flex items-center gap-3">
        {/* The board's avatar circle; decorative, the handle is read. */}
        <span
          aria-hidden="true"
          className="size-9 shrink-0 rounded-pill bg-hairline"
        />
        {/* Shrinks and truncates, so the longest handle a runner can
            pick never pushes Unblock off the screen (P3-09). */}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-bold">
            {runner.username === undefined ? "A runner" : `@${runner.username}`}
          </span>
          <Mono step="xs" className="text-muted">
            {`Blocked ${monthDayLabel(runner.blockedAt)}`}
          </Mono>
        </span>
        <button
          className="target shrink-0 cursor-pointer rounded-pill border border-ink bg-transparent px-4 text-ink"
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
              // Flush right, the row's edge (#632 B-09).
              align="end"
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
