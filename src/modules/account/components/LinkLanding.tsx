import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "../../../ui";
import { SignedOutPanel } from "../../../ui/SignedOutPanel";
import type { Landing } from "../verification";

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

export function landingCopy(landing: Landing): LandingCopy {
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

const ACTION_CLASS =
  "target inline-flex items-center self-start rounded-pill bg-ink px-5 font-bold text-ground no-underline";

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

export function LinkLanding({
  landing,
}: Readonly<{ landing: Landing }>): JSX.Element {
  const copy = landingCopy(landing);
  return (
    <SignedOutPanel
      heading={copy.heading}
      notice={
        <Mono step="xs" className={TONE_CLASS[copy.tone]}>
          {copy.kicker}
        </Mono>
      }
    >
      <div
        data-part="landing"
        data-state={landing.state}
        className="flex flex-col gap-6"
      >
        <p className="m-0 text-lead">{copy.body}</p>
        <LandingAction action={copy.action} />
      </div>
    </SignedOutPanel>
  );
}
