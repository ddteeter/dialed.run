/**
 * "Continue with Google", shared by the log-in and create-account pages.
 * Like client.ts, deliberately NOT exported from index.ts — route
 * components import this file directly.
 */
import { useRef, useState } from "react";
import type { JSX } from "react";

import { ACCESS_CODES, INVITE_COPY } from "../../lib/contracts/access";
import {
  FailureBand,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../ui";
import type { ControlAction, ControlFailure } from "../../ui";
import { AUTH_COPY, AUTH_KICKER, AccessRefused } from "./auth-copy";
import { googleConsentUrl, type Admission } from "./credentials";
import { didGoogleFail } from "./sign-in-search";

/**
 * The Google attempt: `useControlAction`'s state, plus a way to abandon it.
 */
export interface GoogleSignIn extends ControlAction<[]> {
  /**
   * Au5: *"The other form stays live: tapping Log in cancels the Google
   * attempt."* An answer for a cancelled attempt is dropped rather than
   * followed, so the runner is not carried off to Google mid-submit.
   */
  cancel: () => void;
}

/**
 * Better Auth's answer when Google would have made an account from the
 * log-in page, which only Au2 may do (ACC-5).
 */
const SIGNUP_DISABLED = "signup_disabled";

/**
 * The round trip's refusals that have their own words: an address with no
 * account, told where accounts are made; and, from Au2, a new Google
 * account with no code (or one spent while the runner was at Google),
 * told what the code field would have said (ACC-5).
 */
const RETURNED_MESSAGES: ReadonlyMap<string | undefined, string> = new Map([
  [SIGNUP_DISABLED, AUTH_COPY.googleNoAccount],
  [ACCESS_CODES.missing, INVITE_COPY.missing],
  [ACCESS_CODES.invalid, INVITE_COPY.invalid],
]);

/**
 * The band for a failure Google's round trip brought back, rather than one
 * this page saw happen. Same kicker, same sentence — the runner cannot
 * tell the two apart and should not have to — except for the refusals in
 * `RETURNED_MESSAGES`.
 */
function returnedFailure(error: string | undefined): ControlFailure {
  return {
    kicker: AUTH_KICKER,
    message: RETURNED_MESSAGES.get(error) ?? AUTH_COPY.google,
  };
}

/**
Every other failure of the attempt: Au6's sentence.
*/
const FAILED: ControlFailure = {
  kicker: AUTH_KICKER,
  message: AUTH_COPY.google,
};

/**
 * Round 22, Au5–Au6: *"Google is a submit button"* — so it goes through
 * the control-failure pattern rather than a pink line under it. Not
 * optimistic, the in-flight label while it waits, and a band that names
 * what is still true: `Not signed in`.
 *
 * `leave` is how the page goes to Google once the consent URL is back —
 * the route's to supply, so a test can observe the departure without the
 * test runner's own document being navigated away.
 *
 * **Two ways to fail.** Asking Google for its consent URL can fail here,
 * in the page. Or the runner goes to Google and comes back refused, and
 * then the failure arrives as `returnedError` on a fresh page load — which
 * shows the same band, unless it is the runner's own "cancel" (see
 * `didGoogleFail`).
 */
export function useGoogleSignIn({
  callbackURL,
  errorCallbackURL,
  returnedError,
  leave,
  admission,
}: Readonly<{
  /**
  Where Google's success lands — `/`, or the path Au7 carried.
  */
  callbackURL: string;
  /**
  Where a refusal comes back to: this page, with its own search.
  */
  errorCallbackURL: string;
  /**
  The `error` the refusal came back with, if this load is one.
  */
  returnedError: string | undefined;
  leave: (url: string) => void;
  /**
   * Au2's: the code and Turnstile token, read at the press. Present, the
   * attempt asks to make an account (ACC-5); absent (Au1), it only signs
   * in.
   */
  admission?: (() => Admission) | undefined;
}>): GoogleSignIn {
  // The attempt whose answer is still wanted, by identity: each attempt
  // mints its own token, so "is this answer still wanted" is a comparison
  // against that token rather than a flag a later attempt could reset under
  // an earlier one. Cancelling forgets it. (A counter did the same job, but
  // `useControlAction` allows one attempt in flight at a time, so which way
  // it counted could never be observed — its mutants were unkillable.)
  const wanted = useRef<object | undefined>(undefined);
  // The same attempt, as state, so cancelling re-renders: the button goes
  // back to rest at once (Au5) rather than breathing until an answer
  // nobody wants arrives.
  const [live, setLive] = useState<object>();
  const [showsReturned, setShowsReturned] = useState(() =>
    didGoogleFail(returnedError),
  );
  // What the way in said, when it refused the attempt: its own words in
  // the band, rather than Au6's "Google didn't answer".
  const [refusal, setRefusal] = useState<ControlFailure>();
  const control = useControlAction<[]>({
    kicker: AUTH_KICKER,
    action: async () => {
      const mine = {};
      wanted.current = mine;
      setLive(mine);
      setShowsReturned(false);
      setRefusal(undefined);
      try {
        const url = await googleConsentUrl(
          callbackURL,
          errorCallbackURL,
          admission?.(),
        );
        if (mine === wanted.current) leave(url);
      } catch (error: unknown) {
        // A cancelled attempt's failure is not the runner's news: they
        // have moved on to Log in, and a band for a button they abandoned
        // would sit over the form they are using.
        if (mine !== wanted.current) return;
        if (error instanceof AccessRefused) setRefusal(error);
        throw error;
      }
    },
  });
  const failed =
    control.failure === undefined ? undefined : (refusal ?? FAILED);
  const failure =
    failed ?? (showsReturned ? returnedFailure(returnedError) : undefined);

  return {
    ...control,
    pending: control.pending && live !== undefined,
    failure,
    // Always a fresh attempt: Google's takes no arguments, so repeating
    // the failed one and starting anew are the same call — and a failure
    // Google's round trip brought back has no attempt of this page's to
    // repeat at all.
    retry: () => {
      void control.run();
    },
    cancel: () => {
      wanted.current = undefined;
      setLive(undefined);
    },
  };
}

/**
 * Google's own full-colour "G" — **a sanctioned one-off brand exception**
 * (owner, PR #104), and the only mark in the product that is not ours.
 *
 * Google's Sign in with Google branding guidelines are explicit: "Don't
 * create your own icon for the button", "Don't use monochrome versions of
 * the Google 'G'", and it "must be the standard color version". The ring-
 * and-letter mark the Auth board drew broke all three. So this is Google's
 * official asset, unaltered (`public/brand/google-g.png`, from
 * developers.google.com/identity/branding-guidelines' sign-in assets),
 * with its own fixed colours: it lives on this one button, outside the
 * icon manifest and outside T1, and nothing else may borrow it.
 * Design is asked to redraw the button around it (design-deltas item 29).
 *
 * Decoration: the button's words are its name.
 */
function GoogleMark(): JSX.Element {
  return (
    <img
      src="/brand/google-g.png"
      alt=""
      width={20}
      height={20}
      className="block size-5 shrink-0"
    />
  );
}

/**
 * Google's own light and dark specs in our pill (round 26 #13; decision
 * D-49), the same width as the primary and 48 high to match our pills
 * (Google's minimum is 40): fill `#FFFFFF`, a 1px `#747775` stroke and
 * `#1F1F1F` text on light; `#131314`, `#8E918F` and `#E3E3E3` on dark.
 * **These colours are Google's, not T1's**, and `data-part="google-button"`
 * is the one element exempt from the palette check for that reason —
 * nothing else may borrow them. The dark set is keyed on the root's
 * `data-theme="dark"`, which is how task 111's theme will arrive.
 *
 * **The label is Archivo, not Roboto** (decision D-49): the stack has
 * three families by rule. Google's guidelines (updated 2026-07-07) give the
 * label as Google Sans Medium, not Roboto, and their "don't" list names no
 * font — so this builds to D-49 and the PR asks the owner to confirm. At
 * the weights that exist here (never 500), semibold.
 *
 * In flight the glyph drops for the label, so the width holds (Au5); on
 * failure the band sits directly above this button and not above Log in,
 * because *"the band belongs to the button that failed"* (Au6). No pink
 * anywhere on either.
 */
/**
 * Google's colours, stroke and shape, light then dark. Held in a constant
 * so the contract the doc comment above states is one a test can read.
 */
export const GOOGLE_BUTTON_CLASS =
  "target flex h-12 w-full cursor-pointer items-center justify-center rounded-pill border border-[#747775] bg-[#FFFFFF] px-6 text-body font-semibold text-[#1F1F1F] in-data-[theme=dark]:border-[#8E918F] in-data-[theme=dark]:bg-[#131314] in-data-[theme=dark]:text-[#E3E3E3]";

export function GoogleButton({
  google,
}: Readonly<{ google: GoogleSignIn }>): JSX.Element {
  return (
    <>
      {google.failure === undefined ? undefined : (
        <FailureBand
          kicker={google.failure.kicker}
          message={google.failure.message}
          onRetry={google.retry}
          retryRef={google.retryRef}
        />
      )}
      <button
        type="button"
        data-part="google-button"
        data-state={google.pending ? "pending" : undefined}
        {...inFlight(google.pending)}
        onClick={() => {
          void google.run();
        }}
        className={GOOGLE_BUTTON_CLASS}
      >
        <PendingLabel
          label={
            <span className="flex items-center gap-3">
              <GoogleMark />
              Continue with Google
            </span>
          }
          pendingLabel="Opening Google"
          pending={google.pending}
        />
      </button>
    </>
  );
}
