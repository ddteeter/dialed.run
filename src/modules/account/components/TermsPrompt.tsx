import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX } from "react";

import { Mono, useControlAction } from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { AcceptResult, TermsPromptView } from "../terms-acceptance";
import { ActionCard, useLogOutAction } from "./ActionCard";

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
}>;

/**
 * The terms prompt (task 126, ACC-6; round 28 PR A): what a signed-in
 * runner whose latest acceptance is below the current terms sees before
 * anything else, the way "Keep your account?" is seen. **Undrawn**: built
 * from the signed-out panel and the leaving page's two actions, and a
 * design delta.
 *
 * Accept records the version this page showed. Log out leaves everything
 * as it was. A runner who will not accept can still delete their account,
 * from Settings › Account, which the root's gate leaves open.
 */
export function TermsPrompt({
  view,
  ...actions
}: TermsActions &
  Readonly<{ view: TermsPromptView }>): JSX.Element | undefined {
  // Nothing to ask: the route has already sent this visitor home.
  if (view.state === "none") return undefined;
  return (
    <SignedOutPanel
      heading="Accept the terms"
      notice={
        <Mono step="xs" className="text-cold-text">
          Terms updated
        </Mono>
      }
    >
      <AcceptOrLeave version={view.version} {...actions} />
    </SignedOutPanel>
  );
}

function AcceptOrLeave({
  version,
  ...actions
}: TermsActions & Readonly<{ version: number }>): JSX.Element {
  const [isStale, setIsStale] = useState(false);
  const accepting = useControlAction<[]>({
    action: async () => {
      const result = await actions.accept({ data: { version } });
      setIsStale(result === "stale");
      await (result === "accepted" ? actions.onAccepted() : actions.onStale());
    },
    kicker: "Not accepted",
  });
  const leaving = useLogOutAction(actions.logOut);
  return (
    <ActionCard
      primary={accepting}
      primaryLabel="Accept"
      primaryPendingLabel="Accepting"
      logOut={leaving}
    >
      <p className="m-0 text-lead">
        The{" "}
        <Link data-target="inline" to="/terms" className={INLINE_LINK}>
          Terms
        </Link>{" "}
        have changed. Read them, then accept to carry on.
      </p>
      <p className="m-0 text-body text-quiet">
        Rather not? Log out, or{" "}
        <Link
          data-target="inline"
          to="/account/$section"
          params={{ section: "sign-in" }}
          className={INLINE_LINK}
        >
          delete your account
        </Link>{" "}
        in Settings.
      </p>
      {isStale ? (
        <p data-state="stale" className="m-0 text-body font-semibold">
          {STALE}
        </p>
      ) : undefined}
    </ActionCard>
  );
}

/**
 * "Keep your account?"'s inline link colour (`Leaving.tsx` has none of its
 * own): the prompt is the same kind of page, but only this one links out of
 * its lead copy.
 */
const INLINE_LINK = "text-ink underline underline-offset-4";

/**
 * Accept pressed after the terms changed again under the page: nothing was
 * recorded, and the page now shows the newer version (undrawn: a design
 * delta).
 */
export const STALE =
  "The terms changed again while this page was open. Read them once more.";
