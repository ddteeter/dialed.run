import type { JSX } from "react";

import { Bracketed, ListSection, Mono } from "../../../ui";
import type { BlockedRunner } from "../blocks";
import { useSettled } from "./use-settled";

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
 * Nothing here animates. Unblocking is immediate and silent, which is the
 * artboard's "Unblocking takes effect immediately and doesn't re-follow
 * anyone" — so there is no confirmation step and no undo toast, because
 * both would imply the action is heavier than it is.
 */
export function BlockedRunners({
  blocked,
  unblock,
}: Readonly<{
  blocked: readonly BlockedRunner[];
  unblock: (input: { data: { userId: string } }) => Promise<unknown>;
}>): JSX.Element {
  // Optimistic; `useSettled` says why that is safe here.
  const { remaining: visible, settle } = useSettled(
    blocked,
    (runner) => runner.userId,
  );

  return (
    <div className="flex flex-col gap-6">
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
            <p className="text-small text-quiet">Nobody. That&apos;s normal.</p>
          }
        >
          {(runner) => (
            <li
              key={runner.userId}
              className="flex items-center justify-between gap-3 text-body"
            >
              <span>{runner.displayName ?? "A runner"}</span>
              <button
                type="button"
                onClick={() => {
                  settle(runner.userId);
                  void unblock({ data: { userId: runner.userId } });
                }}
              >
                <Mono step="xs">Unblock</Mono>
              </button>
            </li>
          )}
        </ListSection>
        <p className="text-micro text-quiet">
          Nothing here is a list anyone else can see.
        </p>
      </section>
    </div>
  );
}
