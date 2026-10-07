import { useNavigate, useRouter } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";

import { forgetSession } from "../lib/browser/session-memo";

/**
 * A stale tab's refused call, answered (task 126, ACC-6; decision D-96).
 *
 * A tab left open across a deploy that publishes newer terms still holds
 * the root gate's has-handle memo (`lib/browser/session-memo`), so its
 * in-app navigations never ask the gate again — the server's refusal
 * (`TERMS_NOT_ACCEPTED`) is the first it hears. That refusal is not a
 * failure: nothing broke, and "Our end failed" would be untrue. So it goes
 * straight to the accept prompt, with no band and no new copy, and never
 * says the refused write was saved.
 *
 * - **The memo is forgotten first**, so every navigation after this one
 *   asks the gate again — clicking away from the prompt lands on it once
 *   more rather than on a page whose every call is refused.
 * - **`from` is where the runner was**, so Accept returns them there
 *   (`/account/terms` parses it as a path on this site, and goes home
 *   without one).
 * - **`save` names that page when what was refused was a save** (D-102):
 *   the prompt then warns that Accept goes back to it and what was typed
 *   was not kept. Every form's refusal is a save (`useFormSubmit`), and so
 *   is a control's that holds typed state (`useControlAction`'s `isSave`,
 *   Attach); a loader's or a plain control's lost nothing, and sends none.
 *
 * **Why a context rather than a hook that navigates.** `useFormSubmit`
 * and `useControlAction` are rendered by dozens of components under tests
 * with no router; a router hook inside either would need one in all of
 * them. The answer is provided once, at the root, inside the router, and
 * a hook with no provider above it — a test — has no answer and shows the
 * refusal as the failure `classifyFailure` names.
 */
const TermsRefusal = createContext<AnswerTermsRefusal | undefined>(undefined);

/**
 * The root's answer: `isSave` when what was refused was a save, for D-102's
 * line.
 */
export type AnswerTermsRefusal = (isSave?: boolean) => void;

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * What D-102's line calls this page, in the runner's words ("Log a
     * run", "Add a piece"; round 30 #4b), where those are not its heading.
     */
    savedPage?: string;
  }
}

/**
 * The page a refused save left, by name: the nearest route's `savedPage`,
 * or else the page's heading — the words the runner saw on it ("Edit
 * Harrier"), since a screen has one (rule 04). Read when the refusal
 * lands, which is after the page drew it. A page with neither gets no
 * name, and the prompt no line.
 */
function savedPageName(
  matches: readonly { staticData: { savedPage?: string | undefined } }[],
): string | undefined {
  const named = matches.findLast(
    (match) => match.staticData.savedPage !== undefined,
  );
  return (
    named?.staticData.savedPage ?? document.querySelector("h1")?.textContent
  );
}

/**
 * The root's provider: everything under it answers a terms refusal by
 * opening the prompt.
 */
export function TermsRefusalAnswer({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  const router = useRouter();
  const navigate = useNavigate();
  // Not memoised: the root re-renders only as the route changes, and a
  // `useCallback` here would keep nothing a consumer could notice.
  const answer: AnswerTermsRefusal = (isSave = false) => {
    forgetSession();
    void navigate({
      to: "/account/terms",
      search: {
        from: router.state.location.href,
        save: isSave ? savedPageName(router.state.matches) : undefined,
      },
    });
  };
  return (
    <TermsRefusal.Provider value={answer}>{children}</TermsRefusal.Provider>
  );
}

/**
 * The answer to a terms refusal, or `undefined` with no provider above.
 */
export function useTermsRefusal(): AnswerTermsRefusal | undefined {
  return useContext(TermsRefusal);
}
