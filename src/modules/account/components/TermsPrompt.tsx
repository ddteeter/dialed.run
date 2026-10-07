import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import {
  ControlFailureBand,
  FailureBand,
  FormStatus,
  Mono,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { AcceptResult, TermsPromptView } from "../terms-acceptance";
import { ActionPill, useLogOutAction } from "./ActionCard";

/**
 * The terms prompt's actions, needed identically by `TermsPrompt` and
 * `AcceptOrLeave` — Rules of Hooks is why there are two functions at all:
 * `TermsPrompt` returns before any hook runs when there is nothing to ask,
 * and `AcceptOrLeave` is only ever mounted once that gate has passed, with
 * its hooks unconditional on every render.
 */
type TermsActions = Readonly<{
  accept: (input: { data: { version: number } }) => Promise<AcceptResult>;
  logOut: () => Promise<unknown>;
  /**
  Where an accepted runner goes next (the route's to wire).
  */
  onAccepted: () => Promise<void>;
  /**
  The terms changed under the page: load the new ones (the route's to wire).
  */
  onStale: () => Promise<void>;
  /**
   * The page a refused save left, by name (`ui/terms-refusal`'s `save`,
   * D-96), for D-102's line; nothing when they arrived any other way — a
   * refused control or loader lost nothing typed, and log-in sends none.
   */
  savedPage?: string | undefined;
}>;

type Ask = Extract<TermsPromptView, { state: "ask" }>;

/**
 * The two prompts' words (round 29 #6): never accepted — every account so
 * far — and a version bump. Only the kicker, the lead and the read link
 * differ.
 */
const PROMPT_COPY = {
  first: {
    kicker: "Terms",
    lead: "dialed.run has Terms now. Read them, then accept to carry on.",
    read: "Read the Terms",
  },
  update: {
    kicker: "Terms updated",
    lead: "The Terms have changed. Read them, then accept to carry on.",
    read: "Read the full Terms",
  },
} as const;

/**
 * The terms prompt (task 126, ACC-6; round 29 #6, round 30 #4): what a
 * signed-in runner whose latest acceptance is below the current terms sees
 * before anything else, the way "Keep your account?" is seen — a page on
 * the signed-out panel, not a sheet, because it gates every route.
 *
 * In order: the kicker and lead for this runner; the owner's WHAT CHANGED
 * summary, for a version bump that has one; "Read the Terms" on its own
 * line; D-102's warning when a refused save brought them here; Accept, the
 * only filled button; and the escape line, which carries both ways out —
 * Log out, or their account, where Get a copy and Delete account stay
 * open while they are behind (D-95). Accept records the version this page
 * showed.
 */
export function TermsPrompt({
  view,
  ...actions
}: TermsActions & Readonly<{ view: TermsPromptView }>):
  JSX.Element | undefined {
  // Nothing to ask: the route has already sent this visitor home.
  if (view.state === "none") return undefined;
  const copy = PROMPT_COPY[view.isFirst ? "first" : "update"];
  return (
    <SignedOutPanel
      heading="Accept the terms"
      notice={
        <Mono step="xs" className="text-cold-text">
          {copy.kicker}
        </Mono>
      }
    >
      <AcceptOrLeave view={view} {...actions} />
    </SignedOutPanel>
  );
}

function AcceptOrLeave({
  view,
  savedPage,
  ...actions
}: TermsActions & Readonly<{ view: Ask }>): JSX.Element {
  const [isStale, setIsStale] = useState(false);
  const accepting = useControlAction<[]>({
    action: async () => {
      // Each press answers afresh: a press that fails says so in its own
      // band, never under the last one's NOT ACCEPTED as well.
      setIsStale(false);
      const result = await actions.accept({ data: { version: view.version } });
      setIsStale(result === "stale");
      await (result === "accepted" ? actions.onAccepted() : actions.onStale());
    },
    kicker: NOT_ACCEPTED,
  });
  const leaving = useLogOutAction(actions.logOut);
  const copy = PROMPT_COPY[view.isFirst ? "first" : "update"];
  // Round 29 #6's failed Accept: "Your connection dropped. Nothing was
  // recorded." — the shared cause line, then what was not recorded.
  const acceptFailure = accepting.failure && {
    kicker: accepting.failure.kicker,
    message: `${accepting.failure.message} ${NOTHING_RECORDED}`,
  };
  const acceptStatus =
    accepting.status && `${accepting.status} ${NOTHING_RECORDED}`;
  // A stale Accept is announced like a failed one (rule 08): the band's
  // words, through the screen's one status region.
  const staleStatus = isStale ? `${NOT_ACCEPTED}. ${STALE}` : "";

  return (
    <div data-part="landing" data-state="ask" className="flex flex-col gap-6">
      <FormStatus>{acceptStatus || leaving.status || staleStatus}</FormStatus>
      <p className="m-0 text-lead">{copy.lead}</p>
      <WhatChanged lines={view.changed} />
      <Link
        to="/terms"
        className="target inline-flex items-center self-start font-semibold text-ink underline underline-offset-4"
      >
        {copy.read}
      </Link>
      {savedPage === undefined ? undefined : (
        <p data-part="return-note" className="m-0 text-body">
          {returnNote(savedPage)}
        </p>
      )}
      {isStale ? (
        <FailureBand state="stale" kicker={NOT_ACCEPTED} message={STALE} />
      ) : undefined}
      <div data-part="accept" className="flex">
        <ActionPill
          action={accepting}
          label="Accept"
          pendingLabel="Accepting"
        />
      </div>
      {/* A failed Accept's band sits under Accept, and a failed Log out's
          under the line that holds Log out (round 29 #6). */}
      <ControlFailureBand
        failure={acceptFailure}
        onRetry={accepting.retry}
        retryRef={accepting.retryRef}
      />
      <p className="m-0 text-body text-quiet">
        Rather not?{" "}
        <button
          type="button"
          {...inFlight(leaving.pending)}
          onClick={() => {
            void leaving.run();
          }}
          className={INLINE_BUTTON}
        >
          <PendingLabel
            label="Log out"
            pendingLabel="Logging out"
            pending={leaving.pending}
          />
        </button>
        , or go to{" "}
        <Link
          data-target="inline"
          to="/account/$section"
          params={{ section: "sign-in" }}
          className={INLINE_LINK}
        >
          your account
        </Link>{" "}
        to export or delete it.
      </p>
      <ControlFailureBand
        failure={leaving.failure}
        onRetry={leaving.retry}
        retryRef={leaving.retryRef}
      />
    </div>
  );
}

/**
 * The owner's WHAT CHANGED summary (round 29 #6): one to three lines as a
 * plain list on `--tint`, never a diff. With no lines — every first
 * acceptance, and a bump the owner wrote no summary for, as for v1 — the
 * block is left out.
 */
function WhatChanged({
  lines,
}: Readonly<{ lines: readonly string[] }>): JSX.Element | undefined {
  if (lines.length === 0) return undefined;
  return (
    <section
      data-part="what-changed"
      aria-label="What changed"
      className="flex flex-col gap-2 bg-tint p-4"
    >
      <Mono step="xs" className="text-muted">
        What changed
      </Mono>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {lines.map((line) => (
          <li key={line} className="flex gap-2 text-body">
            <span aria-hidden="true">·</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What a failed or refused Accept leaves true. Refused because the terms
 * changed again under the page (round 29 #6), it is `NOT ACCEPTED` directly
 * above Accept with no Try again — the page has already loaded the newer
 * version, and the next Accept records that — in the same band, and under
 * the same part name, as the screen's other control failures.
 */
const NOT_ACCEPTED = "Not accepted";

/**
 * What a failed Accept adds to the cause line, as round 29 #6 draws it.
 */
const NOTHING_RECORDED = "Nothing was recorded.";

/**
 * D-102: where Accept goes back to, and that what was typed is gone —
 * said before it happens, so losing it is no surprise.
 */
export function returnNote(page: string): string {
  return `After you accept, you'll go back to ${page}. What you typed wasn't kept.`;
}

/**
 * The escape line's link colour (`Leaving.tsx` has none of its own): the
 * prompt is the same kind of page, but only this one links out of its
 * copy.
 */
const INLINE_LINK = "text-ink underline underline-offset-4";

/**
 * Log out, set in the escape line's sentence (round 30 #4: the line
 * "carries both exits", and round 29's Log out pill is gone). A button is
 * never an inline target (rule 03), so it keeps its 44px hit area.
 */
const INLINE_BUTTON =
  "target inline-flex cursor-pointer items-center border-none bg-transparent p-0 text-body text-ink underline underline-offset-4";

/**
 * Accept pressed after the terms changed again under the page: nothing was
 * recorded, and the page now shows the newer version.
 */
export const STALE =
  "The terms changed again while this page was open. Read them once more.";
