import type { JSX } from "react";

import {
  AskPanel,
  LandingEnd,
  useConfirmLink,
} from "../../verification/components/LinkLanding";
import type { DeletionLanding } from "../deletion-link";

type AskLanding = Extract<DeletionLanding, { state: "ask" }>;
type EndLanding = Exclude<DeletionLanding, { state: "ask" }>;

/**
 * The ask's words (round 64 #374.3): the account by its handle, or — for
 * a runner closed before they picked one — as theirs (owner, 2026-11-27).
 */
export function askBody(landing: AskLanding): string {
  const account =
    landing.handle === undefined ? "Your account" : `@${landing.handle}`;
  return `${account} is closed. Deleting it removes your runs, closet, entries and photos on ${landing.day}. You can't undo this.`;
}

/**
 * What each end says (round 64 #374.3): the kicker in the verdict hues'
 * text cuts, as the link landings' — teal once the deletion is scheduled,
 * the cold cut for a link that doesn't work — then the heading and a
 * sentence. There is nothing more to press.
 */
interface EndCopy {
  readonly kicker: string;
  readonly toneClass: string;
  readonly heading: string;
  readonly body: string;
}

export function endCopy(landing: EndLanding): EndCopy {
  switch (landing.state) {
    case "done": {
      return {
        kicker: "Deletion scheduled",
        toneClass: "text-dialed-text",
        heading: `Your account goes on ${landing.day}.`,
        body: "We've sent an email saying so. There's nothing more to do.",
      };
    }
    case "used": {
      return {
        kicker: "Deletion scheduled",
        toneClass: "text-dialed-text",
        heading: `This account already goes on ${landing.day}.`,
        body: "The link was used. There's nothing more to do.",
      };
    }
    case "expired": {
      return {
        kicker: "Link expired",
        toneClass: "text-cold-text",
        heading: "This link doesn't work any more.",
        body: "To ask for a new one, reply to the email it came in.",
      };
    }
  }
}

/**
 * `pressed` when the button led here: the status region says the
 * heading, since the question it answered is gone.
 */
function EndPanel({
  landing,
  pressed,
}: Readonly<{ landing: EndLanding; pressed: boolean }>): JSX.Element {
  const copy = endCopy(landing);
  return (
    <LandingEnd
      {...copy}
      state={landing.state}
      said={pressed ? copy.heading : ""}
    />
  );
}

/**
 * Where the Desk's deletion link lands (round 64 #374.3): the link
 * landings' ask, not the signed-in delete sheet. Opening it asks first, so
 * it spends nothing; the one ink button spends it through `confirm`, a
 * POST, and the page it answers with replaces the question. A failure
 * says NOT DELETED, and the button is the retry.
 */
export function DeletionLinkLanding({
  landing,
  confirm,
}: Readonly<{
  landing: DeletionLanding;
  confirm: () => Promise<DeletionLanding>;
}>): JSX.Element {
  const { current, form, submit, pressed } = useConfirmLink(landing, confirm);
  if (current.state !== "ask") {
    return <EndPanel landing={current} pressed={pressed} />;
  }
  return (
    <AskPanel
      copy={{
        heading: "Delete your account?",
        body: askBody(current),
        label: "Delete my account",
        pendingLabel: "Deleting",
        failureKicker: "Not deleted",
      }}
      form={form}
      submit={submit}
    />
  );
}
