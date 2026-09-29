/**
 * What each email says (round 26 #11 and #19: "THE EMAILS · PLAIN, ONE
 * BUTTON"), as data: a subject, a sentence or two, one button, a foot.
 *
 * Data rather than a component per email because every email is the same
 * layout (`EmailLayout`) with different words, and words are what a test
 * should read — a subject asserted as a string, not found in markup.
 *
 * The drawn emails' words are the board's: "Email verify", "Email
 * existing account" and "Email run reminder". The rest (reset, email
 * change, the changed notice) have no drawing and are placeholders in the
 * same voice, listed under the PR's "Design deltas".
 */
import type { EmailTemplate } from "../../lib/email";

export interface EmailLink {
  readonly label: string;
  readonly href: string;
}

export interface EmailContent {
  readonly subject: string;
  /**
  The body: one or two sentences, above the button.
  */
  readonly body: string;
  /**
  Absent only where the board draws none — the ban email.
  */
  readonly button?: EmailLink | undefined;
  /**
  A quiet line under the button: how long the link works, what to ignore.
  */
  readonly foot: string;
  /**
  Why this runner gets this email, for the optional kind only.
  */
  readonly reason?: string | undefined;
  /**
   * The footer's links, after "dialed.run". Every email ends with the
   * privacy policy (decision D-52).
   */
  readonly footer: readonly EmailLink[];
}

/**
 * Where an email's links point. `unsubscribe` is present exactly when the
 * email is an optional kind (the sender signs it per runner and kind).
 */
export interface EmailLinks {
  readonly origin: string;
  readonly unsubscribe?: string | undefined;
}

function privacy(origin: string): EmailLink {
  return { label: "Privacy policy", href: `${origin}/privacy` };
}

function logIn(origin: string): EmailLink {
  return { label: "Log in", href: `${origin}/auth/login` };
}

/**
 * "The link works once, for 24 hours" — the verify link's life, and the
 * email change's, which is the same kind of link.
 */
const ONCE_FOR_A_DAY = "The link works once, for 24 hours.";

/**
 * The run reminder's body: one run, or the one-a-day email counting more
 * (round 26 #19: "The next day's email counts both").
 */
function reminderBody(landedAt: string, runs: number): string {
  return runs === 1
    ? `A run landed on Strava at ${landedAt}. Upload its file, then add what you wore.`
    : `${String(runs)} runs landed on Strava yesterday and today. Upload the files, then add what you wore.`;
}

/**
 * "Email content removed"'s first sentence (round 27 #15), for what went.
 * The board names the run's date; the email does not know it yet, so it
 * says "one of your runs" (a design delta).
 */
const REMOVED = {
  photo: "We removed a photo from one of your runs.",
  entry: "We removed one of your runs from the feed.",
} as const;

/**
What is left, after the reason.
*/
const STAYS = {
  photo: "Your run and verdict stay.",
  entry: "The run itself stays.",
} as const;

export function emailContent(
  template: EmailTemplate,
  links: EmailLinks,
): EmailContent {
  const { origin } = links;
  const footer = [privacy(origin)];
  switch (template.kind) {
    case "verify_email": {
      return {
        subject: "Confirm your email for dialed.run",
        body: "Tap below to confirm this is your address. Then your runs can go on the feed.",
        button: { label: "Confirm email", href: template.url },
        foot: `${ONCE_FOR_A_DAY} Didn't sign up? Ignore this and nothing happens.`,
        footer,
      };
    }
    case "existing_account": {
      return {
        subject: "You already have a dialed.run account",
        body: "Someone, probably you, tried to create an account with this address. It already has one.",
        button: logIn(origin),
        foot: "Forgot the password? Reset it from the log-in page. Didn't try to sign up? Ignore this; nothing changed.",
        footer,
      };
    }
    case "reset_password": {
      return {
        subject: "Set a new password for dialed.run",
        body: "Tap below to set a new password for your account.",
        button: { label: "Set a new password", href: template.url },
        foot: "The link works once, for 1 hour. Didn't ask for it? Ignore this and nothing changes.",
        footer,
      };
    }
    case "email_change": {
      return {
        subject: "Confirm your new email for dialed.run",
        body: `Tap below to move your dialed.run account to ${template.newEmail}.`,
        button: { label: "Confirm email", href: template.url },
        foot: `${ONCE_FOR_A_DAY} Didn't ask for it? Ignore this and nothing changes.`,
        footer,
      };
    }
    case "email_changed": {
      return {
        subject: "Your dialed.run email changed",
        body: `Your account's email is now ${template.newEmail}. Emails go there from now on.`,
        button: logIn(origin),
        foot: "Didn't change it? Write to hello@dialed.run.",
        footer,
      };
    }
    case "content_removed": {
      return {
        subject: "We removed something from your run",
        body: `${REMOVED[template.subject]} Reason: ${template.reason}. ${STAYS[template.subject]}`,
        button: logIn(origin),
        foot: "Think we got it wrong? Reply to this email.",
        footer,
      };
    }
    case "account_closed": {
      return {
        subject: "Your dialed.run account is closed",
        body: `We closed your account for breaking the community rules: ${template.reason}. You can't log in, and your shared runs are gone from the feed.`,
        foot: "Think we got it wrong? Reply within 30 days and a different moderator will look.",
        footer,
      };
    }
    case "run_reminder": {
      return {
        subject: "New run on Strava. Add it here.",
        body: reminderBody(template.landedAt, template.runs),
        button: { label: "Add it", href: `${origin}/runs/new` },
        foot: "We don't copy runs from Strava. The file comes from your watch or a Strava export.",
        reason: "You get this because Strava is connected.",
        footer: [
          {
            label: "Stop run reminder emails",
            href: links.unsubscribe ?? `${origin}/account/notifications`,
          },
          { label: "Email settings", href: `${origin}/account/notifications` },
          privacy(origin),
        ],
      };
    }
  }
}
