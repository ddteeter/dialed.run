import type { JSX } from "react";

import { Page, Wordmark } from "../../../ui";

/**
 * The appeal address D4 names. One constant, because the notice and the
 * ban email (SAF-4, after 126's ACC-2) must name the same inbox.
 */
export const APPEAL_ADDRESS = "desk@dialed.run";

/**
 * "16 September" on the board; the month goes first for en-US (round 26
 * #9, "Date order is US"). UTC, because a signed-out runner has no zone we
 * know, and a ban is a date, not a moment.
 */
function closedOn(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(epochSeconds * 1000));
}

/**
 * Operator Screens D4 · "The notice": what a banned runner opens to.
 *
 * *"It replaces the app. Declarative, complete, and it gives the reason in
 * the operator's words because a paraphrase would be the one hedge
 * available."* No button — *"there is nothing to do inside the app"* — no
 * pink and no hi-viz, and nothing animates. "Closed", not "banned": the
 * heading names the state the runner is in.
 *
 * The board's `CASE [B-0031]` is not drawn here: bans carry no case
 * number in the schema, and inventing one would be a reference nobody at
 * the desk could look up. Listed as a design delta.
 *
 * Nor is the board's "answers within a week": an appeal promises no
 * timeframe (decision D-73 — the service has one operator), so the line
 * says a person reads every message and stops there.
 */
export function AccountClosed({
  reason,
  closedAt,
}: Readonly<{
  /**
  The operator's own sentence, word for word.
  */
  reason: string;
  closedAt: number;
}>): JSX.Element {
  return (
    <Page width="panel">
      <section
        data-part="account-closed"
        className="flex flex-col items-start gap-4"
      >
        {/* The plain lockup: its brackets are the only pink in it, and
            D4 is "ink on paper only". */}
        <Wordmark brackets={false} />
        <h1 className="m-0 font-display text-display">
          Your account is closed.
        </h1>
        <p className="m-0 text-body">
          A person at dialed.run closed it on {closedOn(closedAt)}. This is the
          reason they wrote down:
        </p>
        <blockquote className="m-0 border-l-2 border-ink pl-4 text-body">
          {reason}
        </blockquote>
        <p className="m-0 text-body">
          Your entries and photos are no longer public. Your sign-in no longer
          works.
        </p>
        <p className="m-0 text-body text-quiet">
          If you think this is wrong, write to{" "}
          <a
            data-target="inline"
            className="text-ink underline"
            href={`mailto:${APPEAL_ADDRESS}`}
          >
            {APPEAL_ADDRESS}
          </a>
          . A person reads every message.
        </p>
      </section>
    </Page>
  );
}
