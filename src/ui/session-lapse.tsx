import { useNavigate, useRouter } from "@tanstack/react-router";
import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";
import { z } from "zod";

import { writeCarriedEmail } from "../lib/browser/carried-email";
import type { CarriedForm } from "../lib/carried-form";
import { returnPathOf } from "../lib/return-path";

/**
 * A save refused because the session lapsed, answered (Au7; the Form
 * Contract's `SESSION EXPIRED`: *"The one case that leaves the screen:
 * route to sign-in carrying the payload"*).
 *
 * The answer goes to log-in with what Au7's arrival reads: `redirect`, the
 * page the runner was on, so Log in returns there; `carried`, the form's
 * noun, for the notice; and the runner's address, kept in session storage
 * rather than the URL (`lib/browser/carried-email`). Once the session has
 * lapsed the server cannot say whose it was, so the address is the one the
 * root's loader handed this page while it was signed in.
 *
 * **A context, as `ui/terms-refusal` is**, for the same reason: dozens of
 * forms render `useFormSubmit` under tests with no router. The root
 * provides the answer inside the router; a form with no provider above it
 * shows the lapse as the band `classifyFailure` names.
 */
export type AnswerSessionLapse = (carried: CarriedForm) => void;

const SessionLapse = createContext<AnswerSessionLapse | undefined>(undefined);

/**
 * The root loader's address (`modules/auth`'s `signedInQuery`), parsed
 * rather than read: a match's loader data is `unknown` at this distance,
 * and one that never loaded, or holds no address, carries none.
 */
const rootEmailSchema = z.object({
  loaderData: z.object({ email: z.email() }),
});

function rootEmail(matches: readonly unknown[]): string | undefined {
  const parsed = rootEmailSchema.safeParse(matches[0]);
  return parsed.success ? parsed.data.loaderData.email : undefined;
}

/**
 * The root's provider: every carrying form under it answers a lapsed
 * session by going to log-in.
 */
export function SessionLapseAnswer({
  children,
}: Readonly<{ children: ReactNode }>): JSX.Element {
  const router = useRouter();
  const navigate = useNavigate();
  // Not memoised, as `TermsRefusalAnswer`'s is not: nothing under it keeps
  // the answer's identity.
  const answer: AnswerSessionLapse = (carried) => {
    writeCarriedEmail(rootEmail(router.state.matches));
    void navigate({
      to: "/auth/login",
      search: { redirect: returnPathOf(router.state.location), carried },
    });
  };
  return (
    <SessionLapse.Provider value={answer}>{children}</SessionLapse.Provider>
  );
}

/**
 * The answer to a lapsed session, or `undefined` with no provider above.
 */
export function useSessionLapse(): AnswerSessionLapse | undefined {
  return useContext(SessionLapse);
}
