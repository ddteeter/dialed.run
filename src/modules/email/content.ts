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
import {
  COMMUNITY_RULES_PATH,
  decidedBy,
  REDRESS_FOOT,
  ruleLine,
  type CommunityRule,
} from "../../lib/contracts/community-rules";
import { CONTACT_ADDRESS } from "../../lib/contracts/contact";
import { EXPORT_LINK_DAYS } from "../../lib/contracts/data-export";
import { COPYRIGHT_NOTICE_CLAUSE } from "../../lib/contracts/email-kinds";
import {
  STRAVA_DISCONNECTED_LINE,
  type EmailKind,
  type EmailTemplate,
} from "../../lib/contracts/email";

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
   * legal texts, in the footer's order: Privacy policy · Terms ·
   * Copyright (decision D-52, round 27 #12).
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

/**
 * The legal links every email ends with, in the signed-out footer's order
 * (round 27 #12).
 */
function legal(origin: string): EmailLink[] {
  return [
    { label: "Privacy policy", href: `${origin}/privacy` },
    { label: "Terms", href: `${origin}/terms` },
    { label: "Copyright", href: `${origin}/copyright` },
  ];
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
 * "Email content removed"'s first sentence, for what went: the run named
 * by its day (round 40 C3), or "one of your runs" — round 38 #63b's words,
 * which a copyright notice's email always uses, and a row owed before the
 * day was carried does too (law 9).
 */
function removed(
  template: Extract<EmailTemplate, { kind: "content_removed" }>,
): string {
  const day =
    template.cause === "copyright_notice" ? undefined : template.runDay;
  if (day === undefined) {
    return template.subject === "photo"
      ? "We removed a photo from one of your runs"
      : "We removed one of your runs from the feed";
  }
  return template.subject === "photo"
    ? `We removed the photo from your ${day} run`
    : `We removed your ${day} run from the feed`;
}

/**
The removal email's one button (round 40 C3): the rules it names.
*/
function communityRules(origin: string): EmailLink {
  return {
    label: "See the community rules",
    href: `${origin}${COMMUNITY_RULES_PATH}`,
  };
}

/**
 * The closure email's first sentences: the reason, the rule and who
 * decided (C8, D-145) — or, for suspected CSAM, only that the account
 * broke the rules (owner, 2026-10-24).
 */
function closedFor(
  template: Extract<EmailTemplate, { kind: "account_closed" }>,
): string {
  return template.namesNoReason === true
    ? "We closed your account for breaking the community rules."
    : `We closed your account. Reason: ${template.reason}. ${brokeRule(template.rule)}${decidedBy(false)}`;
}

/**
 * What follows what went: the moderator's reason, word for word, or —
 * for a copyright takedown (R-140) — that it answered a notice, as its
 * bell row and band say, with no reason quoted.
 */
function why(
  template: Extract<EmailTemplate, { kind: "content_removed" }>,
): string {
  return template.cause === "copyright_notice"
    ? ` ${COPYRIGHT_NOTICE_CLAUSE}.`
    : `. Reason: ${template.reason}.`;
}

/**
 * The rule it broke, as a sentence and its trailing space, or nothing when
 * the email names none (C8, D-145).
 */
function brokeRule(rule: CommunityRule | undefined): string {
  return rule === undefined ? "" : `${ruleLine(rule)} `;
}

/**
What is left, after the reason.
*/
const STAYS = {
  photo: "Your run and verdict stay.",
  entry: "The run itself stays.",
} as const;

/**
 * The reopen email's first sentence (round 29 #7): the account named by
 * its handle, or — for a reopen owed without one — by the product's name.
 */
/**
What a removal alert says was reported.
*/
const REPORTED = {
  entry: "a run's kit",
  photo: "a photo",
} as const;

/**
 * An epoch second as `2026-10-12 13:05 UTC`: operators read the Desk in
 * UTC, like the digest's day.
 */
function utcMinute(epochSeconds: number): string {
  const iso = new Date(epochSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function reopened(handle: string | undefined): string {
  return handle === undefined
    ? "Your dialed.run account is open again."
    : `We reopened @${handle}.`;
}

/**
 * "1 photo" and "2 photos": the count, then the word it takes.
 */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * D5's subject: the two numbers that matter, or the zero day's own line
 * ("A zero day reads 'Nothing waiting. Nothing failed.'"). A day with jobs
 * the system gave up on is not a day when nothing failed, so it says how
 * many after the two (R-119). `gaveUp` is absent from a digest owed by the
 * deploy before it (law 9), and absent is none.
 */
function digestSubject(
  template: Extract<EmailTemplate, { kind: "digest" }>,
): string {
  const { day, waiting, screenerUnfinished } = template;
  const gaveUp = template.gaveUp ?? 0;
  if (waiting === 0 && screenerUnfinished === 0 && gaveUp === 0) {
    return `${day} — Nothing waiting. Nothing failed.`;
  }
  const needs = screenerUnfinished === 1 ? "needs" : "need";
  const failed = gaveUp === 0 ? "" : `, ${String(gaveUp)} gave up`;
  return `${day} — ${String(waiting)} waiting, ${counted(screenerUnfinished, "photo", "photos")} ${needs} eyes${failed}`;
}

/**
 * D5's three numbers, each with its sentence — the same three the Desk's
 * Today shows, from the same read.
 */
function digestBody(
  template: Extract<EmailTemplate, { kind: "digest" }>,
): string {
  const oldest =
    template.oldestHours === undefined
      ? ""
      : ` The oldest has waited ${counted(template.oldestHours, "hour", "hours")}.`;
  const unfinished = template.screenerUnfinished;
  const hidden = unfinished === 0 ? "" : " It's hidden until someone looks.";
  const gaveUp = template.gaveUp ?? 0;
  // Operator Screens D6: "the digest adds one line only when the count is
  // above zero" — Today's three numbers stay three.
  const gaveUpLine =
    gaveUp === 0
      ? []
      : [
          `${counted(gaveUp, "job", "jobs")} the system gave up on. ${gaveUp === 1 ? "It's" : "They're"} on the Desk's Today.`,
        ];
  return [
    `${String(template.waiting)} waiting for a decision.${oldest}`,
    `${counted(unfinished, "photo", "photos")} the screener couldn't finish.${hidden}`,
    `${counted(template.bansThisWeek, "ban", "bans")} this week.`,
    ...gaveUpLine,
  ].join(" ");
}

/**
 * Each template as its own variant, keyed by kind: what lets `CONTENT`
 * give every entry the one template it serves, and `contentOf` call it
 * with no cast.
 */
type TemplateOf = { [T in EmailTemplate as T["kind"]]: T };

/**
 * What an entry in `CONTENT` returns: everything but the footer, which
 * `emailContent` adds — unless the entry brings its own (the run
 * reminder's, which leads with its unsubscribe links).
 */
type Body = Omit<EmailContent, "footer"> & {
  readonly footer?: readonly EmailLink[];
};

/**
 * What each kind says. Keyed by `EmailKind`, so a new kind without words
 * fails to compile, as `PREFERENCE_OF` does.
 */
const CONTENT: {
  readonly [K in EmailKind]: (
    template: TemplateOf[K],
    links: EmailLinks,
  ) => Body;
} = {
  verify_email: (template) => {
    return {
      subject: "Confirm your email for dialed.run",
      body: "Tap below to confirm this is your address. Then your runs can go on the feed.",
      button: { label: "Confirm email", href: template.url },
      foot: `${ONCE_FOR_A_DAY} Didn't sign up? Ignore this and nothing happens.`,
    };
  },
  existing_account: (_template, { origin }) => {
    return {
      subject: "You already have a dialed.run account",
      body: "Someone, probably you, tried to create an account with this address. It already has one.",
      button: logIn(origin),
      foot: "Forgot the password? Reset it from the log-in page. Didn't try to sign up? Ignore this; nothing changed.",
    };
  },
  reset_password: (template) => {
    return {
      subject: "Set a new password for dialed.run",
      body: "Tap below to set a new password for your account.",
      button: { label: "Set a new password", href: template.url },
      foot: "The link works once, for 1 hour. Didn't ask for it? Ignore this and nothing changes.",
    };
  },
  email_change: (template) => {
    return {
      subject: "Confirm your new email for dialed.run",
      body: `Tap below to move your dialed.run account to ${template.newEmail}.`,
      button: { label: "Confirm email", href: template.url },
      foot: `${ONCE_FOR_A_DAY} Didn't ask for it? Ignore this and nothing changes.`,
    };
  },
  email_changed: (template, { origin }) => {
    return {
      subject: "Your dialed.run email changed",
      body: `Your account's email is now ${template.newEmail}. Emails go there from now on.`,
      button: logIn(origin),
      foot: `Didn't change it? Write to ${CONTACT_ADDRESS}.`,
    };
  },
  content_removed: (template, { origin }) => {
    return {
      subject: "We removed something from your run",
      // C8 (D-145): what, why, the rule, who decided, then what stays.
      body: `${removed(template)}${why(template)} ${brokeRule(template.rule)}${decidedBy(template.flagged === true)} ${STAYS[template.subject]}`,
      button: communityRules(origin),
      foot: REDRESS_FOOT,
    };
  },
  account_closed: (template) => {
    return {
      subject: "Your dialed.run account is closed",
      body: `${closedFor(template)} You can't log in, and your shared runs are gone from the feed.`,
      foot: REDRESS_FOOT,
    };
  },
  account_reopened: (template, { origin }) => {
    // D-89, as round 29 #7 draws it: the account named by its handle.
    // A reopen owed before the handle was carried (law 9), or for a
    // runner closed before they picked one, says the account instead.
    return {
      subject: "Your dialed.run account is open again",
      body: `${reopened(template.handle)} You can log in, and your runs are back as you shared them.`,
      button: logIn(origin),
      foot: "Your handle is still yours.",
    };
  },
  invite: (template, { origin }) => {
    return {
      subject: "Your dialed.run invite",
      body: `Here's your code: ${template.code}. It works once.`,
      button: {
        label: "Create your account",
        href: `${origin}/join?code=${encodeURIComponent(template.code)}`,
      },
      foot: "You asked for an invite. Didn't? Ignore this and nothing happens.",
    };
  },
  strava_disconnected: (_template, { origin }) => {
    return {
      subject: "Strava is disconnected",
      body: `${STRAVA_DISCONNECTED_LINE} Your runs here haven't changed.`,
      button: { label: "Connect again", href: `${origin}/runs/strava` },
      foot: "Runs you already added stay.",
    };
  },
  deletion_scheduled: (template, { origin }) => {
    return {
      subject: `Your dialed.run account goes on ${template.day}`,
      body: `You asked to delete your account. Everything in it goes on ${template.day}.`,
      button: { label: "Keep my account", href: `${origin}/auth/login` },
      foot: "Didn't ask? Log in and keep it, then change your password.",
    };
  },
  export_ready: (template, { origin }) => {
    // Round 27 #13's "Email export", less "and original run files": since
    // D-116 a file is deleted once read, so the ZIP rarely has one
    // (design deltas item 57).
    return {
      subject: "Your dialed.run export is ready",
      body: "Your runs, closet, entries and photos are in one ZIP.",
      button: {
        label: "Download export",
        href: `${origin}/account/export/${template.token}`,
      },
      foot: `The link works for ${String(EXPORT_LINK_DAYS)} days, only while you're logged in.`,
    };
  },
  digest: (template, { origin }) => {
    return {
      subject: digestSubject(template),
      body: digestBody(template),
      button: { label: "Open the Desk", href: `${origin}/desk` },
      foot: "Sent every morning, even when every number is zero. If it stops arriving, something is broken.",
    };
  },
  removal_due: (template, { origin }) => {
    // Round 35 #58d: the words design gave (design 136).
    const due = utcMinute(template.dueAt);
    return {
      subject: `Removal due by ${due}`,
      body: `Someone reported ${REPORTED[template.subject]} as an intimate image shared without consent. It's hidden from everyone now. The law gives us 48 hours to decide.`,
      button: { label: "Open Review", href: `${origin}/safety/review` },
      foot: "Sent to every operator, once per report that hides something.",
    };
  },
  removal_requested: (template, { origin }) => {
    // Design 136. Round 35 #58 gives the report's alert its words and
    // not this one, so this follows them: what was asked, whether it is
    // hidden (a link of ours is, #58e), and the deadline.
    const due = utcMinute(template.dueAt);
    return {
      subject: `Removal request, due by ${due}`,
      body: `Someone asked for an intimate image to come down. ${template.isOurs ? "It's hidden from everyone now." : "The link isn't one of ours, so nothing is hidden: find it from what they wrote."} The law gives us 48 hours to decide.`,
      button: { label: "Open Review", href: `${origin}/safety/review` },
      foot: "Sent to every operator, once per request.",
    };
  },
  removal_reminder: (template, { origin }) => {
    // C6: placeholder words (design deltas). Nothing comes back by
    // itself, so the email says the decision is still the operator's.
    const due = utcMinute(template.dueAt);
    return {
      subject: `Removal still undecided, due by ${due}`,
      body: "An intimate-image removal is still waiting for a decision. Nothing changes until someone decides it in Review.",
      button: { label: "Open Review", href: `${origin}/safety/review` },
      foot: "Sent to every operator, once per removal, 8 hours before it's due.",
    };
  },
  removal_request_received: (template, { origin }) => {
    const due = utcMinute(template.dueAt);
    return {
      subject: "We have your removal request",
      // Round 35 #58e. The hidden line is true only of what was hidden;
      // design 137's confirm line only of a request past the cap.
      body: `${template.isHidden ? "The image is hidden while we look. " : ""}${template.confirmToken === undefined ? "" : "It isn't hidden yet. To have it hidden while we look, confirm this request. "}We'll decide within 48 hours, by ${due}, and email you either way.`,
      ...(template.confirmToken !== undefined && {
        button: {
          label: "Confirm the request",
          href: `${origin}/takedown/confirm?token=${template.confirmToken}`,
        },
      }),
      foot: "Sent because someone asked at dialed.run/takedown with this address.",
    };
  },
  takedown_valve: (template, { origin }) => {
    // Design 137: placeholder words (design deltas).
    return {
      subject: "Removal requests paused: possible abuse",
      body: `${String(template.perHour)} removal requests hid something in the last hour, so new requests hide nothing until the hour clears. They still wait in Review with their 48 hours.`,
      button: { label: "Open Review", href: `${origin}/safety/review` },
      foot: "Sent to every operator, once an hour while it lasts.",
    };
  },
  removal_request_decided: (template) => {
    return {
      subject:
        template.outcome === "removed"
          ? "We removed what you reported"
          : "We didn't remove what you reported",
      body:
        template.outcome === "removed"
          ? "We removed the image you asked about from dialed.run."
          : `We looked at your request and didn't remove anything. Reason: ${template.reason ?? "it isn't what the request described"}.`,
      foot: `Questions? Reply to this email or write to ${CONTACT_ADDRESS}.`,
    };
  },
  run_reminder: (template, { origin, unsubscribe }) => {
    return {
      subject: "New run on Strava. Add it here.",
      body: reminderBody(template.landedAt, template.runs),
      button: { label: "Add it", href: `${origin}/runs/new` },
      foot: "We don't copy runs from Strava. The file comes from your watch or a Strava export.",
      reason: "You get this because Strava is connected.",
      footer: [
        {
          label: "Stop run reminder emails",
          href: unsubscribe ?? `${origin}/account/notifications`,
        },
        { label: "Email settings", href: `${origin}/account/notifications` },
        ...legal(origin),
      ],
    };
  },
};

function contentOf<K extends EmailKind>(
  kind: K,
  template: TemplateOf[K],
  links: EmailLinks,
): Body {
  return CONTENT[kind](template, links);
}

export function emailContent(
  template: EmailTemplate,
  links: EmailLinks,
): EmailContent {
  return {
    footer: legal(links.origin),
    ...contentOf(template.kind, template, links),
  };
}
