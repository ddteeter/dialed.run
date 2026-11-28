import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";

import {
  FailureBand,
  FormStatus,
  INK_PILL,
  Mono,
  SubmitButton,
  type FormShell,
  useFormSubmit,
} from "../../../../ui";
import { SignedOutPanel } from "../../../../ui/SignedOutPanel";
import { confirmLinkForm } from "../../inputs";
import type { Landing } from "../verification";

type AskLanding = Extract<Landing, { state: "ask" }>;
type EndLanding = Exclude<Landing, { state: "ask" }>;

/**
 * What each landing says (round 26 #11, "LINK LANDINGS · SIGNED-OUT
 * SHELL"): the kicker in the verdict hues' text cuts — teal done, pink
 * run out — the heading, a sentence and the way on.
 *
 * Two departures from the board, both listed as design deltas. "Email
 * confirmed" drops "Anything you shared while waiting is posted.": there
 * is no queue to post (decision D-50 — an unconfirmed runner's entries
 * saved private). And an email change's landing is not drawn, so it
 * borrows the confirmed one's frame with its own words.
 */
interface LandingCopy {
  readonly kicker: string;
  readonly tone: "done" | "expired";
  readonly heading: string;
  readonly body: string;
  readonly action: "feed" | "home" | "log-in";
}

export function landingCopy(landing: EndLanding): LandingCopy {
  switch (landing.state) {
    case "confirmed": {
      return landing.purpose === "verify"
        ? {
            kicker: "Confirmed",
            tone: "done",
            heading: "Email confirmed",
            body: "Your runs can go on the feed now.",
            action: "feed",
          }
        : {
            kicker: "Confirmed",
            tone: "done",
            heading: "Email changed",
            body: `Your account's email is now ${landing.email}.`,
            action: "home",
          };
    }
    case "used": {
      return {
        kicker: "Already confirmed",
        tone: "done",
        heading: "Your email is confirmed",
        body: "That link was already used, and the address is confirmed. Nothing to do.",
        action: "home",
      };
    }
    case "expired": {
      return {
        kicker: "Link expired",
        tone: "expired",
        heading: "That link has run out",
        body: "Links work for 24 hours. Log in and we'll send a fresh one.",
        action: "log-in",
      };
    }
  }
}

const TONE_CLASS: Readonly<Record<LandingCopy["tone"], string>> = {
  done: "text-dialed-text",
  expired: "text-cold-text",
};

const ACTION_CLASS = `target ${INK_PILL} no-underline`;

function LandingAction({
  action,
}: Readonly<{ action: LandingCopy["action"] }>): JSX.Element {
  switch (action) {
    case "feed": {
      return (
        <Link to="/feed" className={ACTION_CLASS}>
          Open the feed
        </Link>
      );
    }
    case "home": {
      return (
        <Link to="/" className={ACTION_CLASS}>
          Open dialed.run
        </Link>
      );
    }
    case "log-in": {
      // Back to Au4 once signed in, where the fresh link is one press.
      return (
        <Link
          to="/auth/login"
          search={{ redirect: "/account/check-email" }}
          className={ACTION_CLASS}
        >
          Log in to resend
        </Link>
      );
    }
  }
}

/**
 * The question a link asks before it does anything (owner, 2026-11-15):
 * what pressing the button will do, the button, and the band if it
 * failed. The words are the owner's; the composition is the unsubscribe
 * landing's until Design draws it (design deltas).
 */
export interface AskCopy {
  readonly kicker?: string;
  readonly heading: string;
  readonly body: string;
  readonly label: string;
  readonly pendingLabel: string;
  readonly failureKicker: string;
}

export function askCopy(landing: AskLanding): AskCopy {
  return landing.purpose === "verify"
    ? {
        kicker: "Confirm",
        heading: "Confirm your email",
        body: `This confirms ${landing.email} for your dialed.run account.`,
        label: "Confirm email",
        pendingLabel: "Confirming",
        failureKicker: "Not confirmed",
      }
    : {
        kicker: "Change email",
        heading: "Use this address?",
        body: `Your account's email changes to ${landing.email}. You'll log in with it from now on.`,
        label: "Use this address",
        pendingLabel: "Changing",
        failureKicker: "Not changed",
      };
}

/**
 * The ask, for any link that asks first: the kicker is optional (the
 * Desk's deletion link has none).
 */
export function AskPanel({
  copy,
  form,
  submit,
}: Readonly<{
  copy: AskCopy;
  form: FormShell;
  submit: () => void;
}>): JSX.Element {
  return (
    <SignedOutPanel
      heading={copy.heading}
      notice={
        copy.kicker === undefined ? undefined : (
          <Mono step="xs" className="text-quiet">
            {copy.kicker}
          </Mono>
        )
      }
    >
      <form
        ref={form.formRef}
        noValidate
        data-part="landing"
        data-state="ask"
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <p className="m-0 text-lead">{copy.body}</p>
        {/* R60·324: the button is the retry, so the band under it offers
            none, and a failure puts focus back on it. */}
        <SubmitButton
          label={copy.label}
          pendingLabel={copy.pendingLabel}
          pending={form.pending}
          tone="ink"
          ref={form.retryRef}
        />
        {form.failure === undefined ? undefined : (
          <FailureBand
            kicker={copy.failureKicker}
            message="That didn't go through."
          />
        )}
      </form>
    </SignedOutPanel>
  );
}

/**
 * A landing's end, for any link that lands on one (the confirm links and
 * the Desk's deletion link, round 64 #374.3): its kicker in its tone, the
 * heading, a sentence and the way on, if there is one. `said` is what the
 * status region says: the heading, when the button led here, since the
 * question it answered is gone; nothing when the page opened onto it.
 */
export function LandingEnd({
  kicker,
  toneClass,
  heading,
  body,
  state,
  said,
  children,
}: Readonly<{
  kicker: string;
  toneClass: string;
  heading: string;
  body: string;
  state: string;
  said: string;
  children?: ReactNode;
}>): JSX.Element {
  return (
    <SignedOutPanel
      heading={heading}
      notice={
        <Mono step="xs" className={toneClass}>
          {kicker}
        </Mono>
      }
    >
      <div
        data-part="landing"
        data-state={state}
        className="flex flex-col gap-6"
      >
        <FormStatus>{said}</FormStatus>
        <p className="m-0 text-lead">{body}</p>
        {children}
      </div>
    </SignedOutPanel>
  );
}

/**
 * `pressed` when the button led here: the status region says the heading,
 * since the question it answered is gone. Opened straight onto a landing,
 * it says nothing — the heading is the page's.
 */
function EndPanel({
  landing,
  pressed,
}: Readonly<{ landing: EndLanding; pressed: boolean }>): JSX.Element {
  const copy = landingCopy(landing);
  return (
    <LandingEnd
      kicker={copy.kicker}
      toneClass={TONE_CLASS[copy.tone]}
      heading={copy.heading}
      body={copy.body}
      state={landing.state}
      said={pressed ? `${copy.heading}.` : ""}
    >
      <LandingAction action={copy.action} />
    </LandingEnd>
  );
}

/**
 * The state every link landing keeps: the landing on show, and the one
 * button that spends the link through `confirm`, a POST, whose answer
 * replaces it. `pressed` is true once the button led here.
 */
export function useConfirmLink<L>(
  landing: L,
  confirm: () => Promise<L>,
): { current: L; form: FormShell; submit: () => void; pressed: boolean } {
  const [current, setCurrent] = useState(landing);
  const form = useFormSubmit({
    schema: confirmLinkForm,
    action: () => confirm(),
    onSuccess: setCurrent,
    // The landing it answers with says what happened (`EndPanel`): a link
    // spent in another tab meanwhile is not "confirmed".
    successMessage: "",
  });
  return {
    current,
    form,
    submit: () => {
      void form.submit({});
    },
    pressed: current !== landing,
  };
}

/**
 * Where a confirm or change link lands. Opening it asks (`ask`); the
 * button spends the link through `confirm`, a POST, and the landing it
 * answers with replaces the question on the same URL.
 */
export function LinkLanding({
  landing,
  confirm,
}: Readonly<{
  landing: Landing;
  confirm: () => Promise<Landing>;
}>): JSX.Element {
  const { current, form, submit, pressed } = useConfirmLink(landing, confirm);
  return current.state === "ask" ? (
    <AskPanel copy={askCopy(current)} form={form} submit={submit} />
  ) : (
    <EndPanel landing={current} pressed={pressed} />
  );
}
