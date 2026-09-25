/**
 * "Continue with Google", shared by the log-in and create-account pages.
 * Like client.ts, deliberately NOT exported from index.ts — route
 * components import this file directly.
 */
import { useRef } from "react";
import type { JSX } from "react";

import {
  FailureBand,
  Mono,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../ui";
import type { ControlAction } from "../../ui";
import { AUTH_COPY, AUTH_KICKER } from "./auth-copy";
import { googleConsentUrl } from "./credentials";

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
 * Round 22, Au5–Au6: *"Google is a submit button"* — so it goes through
 * the control-failure pattern rather than a pink line under it. Not
 * optimistic, the in-flight label while it waits, and a band that names
 * what is still true: `Not signed in`.
 *
 * `leave` is how the page goes to Google once the consent URL is back —
 * the route's to supply, so a test can observe the departure without the
 * test runner's own document being navigated away.
 */
export function useGoogleSignIn({
  callbackURL,
  leave,
}: Readonly<{
  /**
  Where Google's success lands — `/`, or the form Au7 carried.
  */
  callbackURL: string;
  leave: (url: string) => void;
}>): GoogleSignIn {
  // The attempt whose answer is still wanted, by identity: each attempt
  // mints its own token, so "is this answer still wanted" is a comparison
  // against that token rather than a flag a later attempt could reset under
  // an earlier one. Cancelling forgets it. (A counter did the same job, but
  // `useControlAction` allows one attempt in flight at a time, so which way
  // it counted could never be observed — its mutants were unkillable.)
  const wanted = useRef<object | undefined>(undefined);
  const control = useControlAction<[]>({
    kicker: AUTH_KICKER,
    action: async () => {
      const mine = {};
      wanted.current = mine;
      const url = await googleConsentUrl(callbackURL);
      if (mine === wanted.current) leave(url);
    },
  });

  return {
    ...control,
    cancel: () => {
      wanted.current = undefined;
    },
  };
}

/**
 * The "G" the board draws in a ring — its own lockup of the letter, not
 * Google's logo, so it is composed from the type system rather than
 * imported as a glyph the icon pack does not hold.
 */
function GoogleMark(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="grid size-5 place-items-center rounded-pill border border-ink"
    >
      <Mono step="xs">G</Mono>
    </span>
  );
}

/**
 * The hairline pill, the same width as the primary (Au1: *"Google is the
 * hairline pill, same width"*).
 *
 * In flight the glyph drops for the label, so the width holds (Au5); on
 * failure the band sits directly above this button and not above Log in,
 * because *"the band belongs to the button that failed"* (Au6). No pink
 * anywhere on either.
 */
export function GoogleButton({
  google,
}: Readonly<{ google: GoogleSignIn }>): JSX.Element {
  return (
    <>
      {google.failure === undefined ? undefined : (
        <FailureBand
          kicker={AUTH_KICKER}
          message={AUTH_COPY.google}
          onRetry={google.retry}
          retryRef={google.retryRef}
        />
      )}
      <button
        type="button"
        data-part="google"
        data-state={google.pending ? "pending" : undefined}
        {...inFlight(google.pending)}
        onClick={() => {
          void google.run();
        }}
        className="target flex w-full cursor-pointer items-center justify-center rounded-pill border border-hairline bg-ground px-6 py-4 text-body font-semibold text-ink"
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
