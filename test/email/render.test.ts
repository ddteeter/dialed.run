import { describe, expect, it } from "vitest";

import type { EmailTemplate } from "../../src/lib/contracts/email";
import { emailContent } from "../../src/modules/email/content";
import { renderEmail } from "../../src/modules/email/render";
import { ORIGIN } from "./helpers";

/**
 * What every email says, and that it renders in workerd — the check the
 * packet asked for before React Email was adopted (ACC-2). It does: this
 * file runs in the workers pool.
 */

const UNSUBSCRIBE = `${ORIGIN}/account/unsubscribe?u=u1&k=run_reminder&s=sig`;
const PRIVACY = { label: "Privacy policy", href: `${ORIGIN}/privacy` };
const LOG_IN = { label: "Log in", href: `${ORIGIN}/auth/login` };

describe("emailContent", () => {
  it.each<[EmailTemplate, ReturnType<typeof emailContent>]>([
    [
      { kind: "verify_email", url: `${ORIGIN}/account/verify?token=t` },
      {
        subject: "Confirm your email for dialed.run",
        body: "Tap below to confirm this is your address. Then your runs can go on the feed.",
        button: {
          label: "Confirm email",
          href: `${ORIGIN}/account/verify?token=t`,
        },
        foot: "The link works once, for 24 hours. Didn't sign up? Ignore this and nothing happens.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "existing_account" },
      {
        subject: "You already have a dialed.run account",
        body: "Someone, probably you, tried to create an account with this address. It already has one.",
        button: LOG_IN,
        foot: "Forgot the password? Reset it from the log-in page. Didn't try to sign up? Ignore this; nothing changed.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "reset_password", url: `${ORIGIN}/account/reset?token=r` },
      {
        subject: "Set a new password for dialed.run",
        body: "Tap below to set a new password for your account.",
        button: {
          label: "Set a new password",
          href: `${ORIGIN}/account/reset?token=r`,
        },
        foot: "The link works once, for 1 hour. Didn't ask for it? Ignore this and nothing changes.",
        footer: [PRIVACY],
      },
    ],
    [
      {
        kind: "email_change",
        url: `${ORIGIN}/account/verify?token=c`,
        newEmail: "new@example.com",
      },
      {
        subject: "Confirm your new email for dialed.run",
        body: "Tap below to move your dialed.run account to new@example.com.",
        button: {
          label: "Confirm email",
          href: `${ORIGIN}/account/verify?token=c`,
        },
        foot: "The link works once, for 24 hours. Didn't ask for it? Ignore this and nothing changes.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "email_changed", newEmail: "new@example.com" },
      {
        subject: "Your dialed.run email changed",
        body: "Your account's email is now new@example.com. Emails go there from now on.",
        button: LOG_IN,
        foot: "Didn't change it? Write to hello@dialed.run.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "run_reminder", landedAt: "6:58 AM", runs: 1 },
      {
        subject: "New run on Strava. Add it here.",
        body: "A run landed on Strava at 6:58 AM. Upload its file, then add what you wore.",
        button: { label: "Add it", href: `${ORIGIN}/runs/new` },
        foot: "We don't copy runs from Strava. The file comes from your watch or a Strava export.",
        reason: "You get this because Strava is connected.",
        footer: [
          { label: "Stop run reminder emails", href: UNSUBSCRIBE },
          { label: "Email settings", href: `${ORIGIN}/account/notifications` },
          PRIVACY,
        ],
      },
    ],
    [
      {
        kind: "content_removed",
        subject: "photo",
        reason: "it shows where someone lives",
      },
      {
        subject: "We removed something from your run",
        body: "We removed a photo from one of your runs. Reason: it shows where someone lives. Your run and verdict stay.",
        button: LOG_IN,
        foot: "Think we got it wrong? Reply to this email.",
        footer: [PRIVACY],
      },
    ],
    [
      {
        kind: "content_removed",
        subject: "entry",
        reason: "it's an ad or spam",
      },
      {
        subject: "We removed something from your run",
        body: "We removed one of your runs from the feed. Reason: it's an ad or spam. The run itself stays.",
        button: LOG_IN,
        foot: "Think we got it wrong? Reply to this email.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "account_closed", reason: "repeated harassment" },
      {
        subject: "Your dialed.run account is closed",
        body: "We closed your account for breaking the community rules: repeated harassment. You can't log in, and your shared runs are gone from the feed.",
        foot: "Think we got it wrong? Reply to this email to appeal and we'll look again.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "invite", code: "DIAL-7K3P" },
      {
        subject: "Your dialed.run invite",
        body: "Here's your code: DIAL-7K3P. It works once.",
        button: {
          label: "Create your account",
          href: `${ORIGIN}/join?code=DIAL-7K3P`,
        },
        foot: "You asked for an invite. Didn't? Ignore this and nothing happens.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "strava_disconnected" },
      {
        subject: "Strava is disconnected",
        body: "Strava says dialed.run was disconnected, so run reminders have stopped. Your runs here haven't changed.",
        button: { label: "Connect again", href: `${ORIGIN}/runs/strava` },
        foot: "Runs you already added stay.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "deletion_scheduled", day: "Sat, Oct 4" },
      {
        subject: "Your dialed.run account goes on Sat, Oct 4",
        body: "You asked to delete your account. Everything in it goes on Sat, Oct 4.",
        button: { label: "Keep my account", href: `${ORIGIN}/auth/login` },
        foot: "Didn't ask? Log in and keep it, then change your password.",
        footer: [PRIVACY],
      },
    ],
    [
      { kind: "export_ready", token: "0123456789abcdef0123456789abcdef" },
      {
        subject: "Your dialed.run export is ready",
        body: "Your runs, closet, entries, photos and original run files are in one ZIP.",
        button: {
          label: "Download export",
          href: `${ORIGIN}/account/export/0123456789abcdef0123456789abcdef`,
        },
        foot: "The link works for 7 days, only while you're logged in.",
        footer: [PRIVACY],
      },
    ],
    [
      {
        kind: "digest",
        day: "Tue Sep 16",
        waiting: 4,
        oldestHours: 19,
        screenerUnfinished: 1,
        bansThisWeek: 0,
      },
      {
        subject: "Tue Sep 16 — 4 waiting, 1 photo needs eyes",
        body: "4 waiting for a decision. The oldest has waited 19 hours. 1 photo the screener couldn't finish. It's hidden until someone looks. 0 bans this week.",
        button: { label: "Open the Desk", href: `${ORIGIN}/desk` },
        foot: "Sent every morning, even when every number is zero. If it stops arriving, something is broken.",
        footer: [PRIVACY],
      },
    ],
  ])("says what round 26 draws for %o", (template, expected) => {
    expect(
      emailContent(template, { origin: ORIGIN, unsubscribe: UNSUBSCRIBE }),
    ).toStrictEqual(expected);
  });

  it("escapes the invite's code in its link", () => {
    expect(
      emailContent({ kind: "invite", code: "A&B C" }, { origin: ORIGIN })
        .button,
    ).toStrictEqual({
      label: "Create your account",
      href: `${ORIGIN}/join?code=A%26B%20C`,
    });
  });

  it("says the digest's zero day in its own words, and counts in the plural", () => {
    const zero = emailContent(
      {
        kind: "digest",
        day: "Wed Sep 17",
        waiting: 0,
        screenerUnfinished: 0,
        bansThisWeek: 1,
      },
      { origin: ORIGIN },
    );
    expect(zero.subject).toBe("Wed Sep 17 — Nothing waiting. Nothing failed.");
    expect(zero.body).toBe(
      "0 waiting for a decision. 0 photos the screener couldn't finish. 1 ban this week.",
    );
    const many = emailContent(
      {
        kind: "digest",
        day: "Thu Sep 18",
        waiting: 2,
        oldestHours: 1,
        screenerUnfinished: 2,
        bansThisWeek: 3,
      },
      { origin: ORIGIN },
    );
    expect(many.subject).toBe("Thu Sep 18 — 2 waiting, 2 photos need eyes");
    expect(many.body).toBe(
      "2 waiting for a decision. The oldest has waited 1 hour. 2 photos the screener couldn't finish. It's hidden until someone looks. 3 bans this week.",
    );
    // Reports alone are still a day with something waiting.
    expect(
      emailContent(
        {
          kind: "digest",
          day: "Fri Sep 19",
          waiting: 1,
          oldestHours: 0,
          screenerUnfinished: 0,
          bansThisWeek: 0,
        },
        { origin: ORIGIN },
      ).subject,
    ).toBe("Fri Sep 19 — 1 waiting, 0 photos need eyes");
    // …and so is an unfinished photo alone.
    expect(
      emailContent(
        {
          kind: "digest",
          day: "Sat Sep 20",
          waiting: 0,
          screenerUnfinished: 1,
          bansThisWeek: 0,
        },
        { origin: ORIGIN },
      ).subject,
    ).toBe("Sat Sep 20 — 0 waiting, 1 photo needs eyes");
  });

  it("counts every run the one-a-day reminder covers", () => {
    expect(
      emailContent(
        { kind: "run_reminder", landedAt: "6:58 AM", runs: 2 },
        { origin: ORIGIN, unsubscribe: UNSUBSCRIBE },
      ).body,
    ).toBe(
      "2 runs landed on Strava yesterday and today. Upload the files, then add what you wore.",
    );
  });

  it("sends a reminder with no signed link to the settings page instead", () => {
    const [stop] = emailContent(
      { kind: "run_reminder", landedAt: "6:58 AM", runs: 1 },
      { origin: ORIGIN },
    ).footer;
    expect(stop).toStrictEqual({
      label: "Stop run reminder emails",
      href: `${ORIGIN}/account/notifications`,
    });
  });
});

describe("renderEmail", () => {
  const reminder = renderEmail(
    { kind: "run_reminder", landedAt: "6:58 AM", runs: 1 },
    { origin: ORIGIN, unsubscribe: UNSUBSCRIBE },
  );

  it("renders the subject and a plain-text body that says what the HTML says", () => {
    expect(reminder.subject).toBe("New run on Strava. Add it here.");
    // The inbox preview is not repeated in the text body.
    expect(reminder.text).toBe(
      [
        "[ dialed.run ]",
        "",
        "A run landed on Strava at 6:58 AM. Upload its file, then add what you wore.",
        "",
        `Add it [${ORIGIN}/runs/new]`,
        "",
        "We don't copy runs from Strava. The file comes from your watch or a Strava",
        "export.",
        "",
        "-".repeat(80),
        "",
        "You get this because Strava is connected.",
        "",
        "dialed.run · Stop run reminder emails",
        `[${UNSUBSCRIBE}] · Email`,
        `settings [${ORIGIN}/account/notifications] · Privacy policy`,
        `[${ORIGIN}/privacy]`,
      ].join("\n"),
    );
  });

  it("is a whole HTML document, with the body as the inbox preview", () => {
    expect(
      reminder.html.startsWith('<!DOCTYPE html><html dir="ltr" lang="en">'),
    ).toBe(true);
    expect(reminder.html).toContain('data-skip-in-text="true">A run landed');
  });

  it("paints with the pinned palette, inline, where a client can read it", () => {
    for (const style of [
      "background-color:#f4f3ef;color:#0b0b0e;font-family:Archivo, Helvetica, Arial, sans-serif;margin:0;padding:24px 0",
      "max-width:480px;background-color:#ffffff;padding:24px",
      "font-size:14px;line-height:24px;font-family:&#x27;IBM Plex Mono&#x27;, Menlo, Consolas, monospace;margin:0 0 24px",
      '<span style="color:#ff2d8a">[</span> dialed<span style="color:#7a7a70">.run</span> <span style="color:#ff2d8a">]</span>',
      "font-size:16px;line-height:24px;margin:0 0 24px",
      "background-color:#ff2d8a;border-radius:999px;color:#0b0b0e;font-size:16px;font-weight:600;padding:12px 24px",
      "font-size:14px;line-height:20px;color:#4e4e44;margin:24px 0 0",
      "border-color:#dcdbd2;margin:24px 0",
      "font-size:12px;line-height:18px;color:#7a7a70;margin:0",
      'style="color:#4e4e44;text-decoration-line:none;text-decoration:underline"',
    ]) {
      expect(reminder.html, style).toContain(style);
    }
  });

  it("gives the reason line to the optional email only", () => {
    const verify = renderEmail(
      { kind: "verify_email", url: `${ORIGIN}/account/verify?token=t` },
      { origin: ORIGIN },
    );
    expect(verify.text).not.toContain("You get this because");
    expect(
      verify.text.endsWith(`dialed.run · Privacy policy [${ORIGIN}/privacy]`),
    ).toBe(true);
    // A template with no reason renders no reason paragraph at all — not an
    // empty one. Both the (absent) reason line and the real footer line
    // share FOOTER_STYLE, so a stray empty paragraph would show up as a
    // second copy of its inline style in the HTML.
    const footerStyle =
      "font-size:12px;line-height:18px;color:#7a7a70;margin:0";
    expect(verify.html.split(footerStyle).length - 1, verify.html).toBe(1);
    // The reminder genuinely has a reason, so it carries two.
    expect(reminder.html.split(footerStyle).length - 1).toBe(2);
  });

  it("sets no appeal deadline and promises no second moderator (round 27)", () => {
    // The owner's call: an appeal has no deadline, and there is one
    // moderator, so neither notice may say otherwise.
    const notices = [
      emailContent(
        { kind: "account_closed", reason: "spam" },
        { origin: ORIGIN, unsubscribe: UNSUBSCRIBE },
      ),
      emailContent(
        { kind: "content_removed", subject: "photo", reason: "spam" },
        { origin: ORIGIN, unsubscribe: UNSUBSCRIBE },
      ),
    ];
    for (const notice of notices) {
      const words = `${notice.body} ${notice.foot}`;
      expect(words).not.toMatch(/\bdays?\b|\bwithin\b|different moderator/iu);
    }
  });

  it("draws no button where the board draws none (the ban email)", () => {
    const closed = renderEmail(
      { kind: "account_closed", reason: "spam" },
      { origin: ORIGIN },
    );
    expect(closed.html).not.toContain("background-color:#ff2d8a");
    expect(closed.text).not.toContain(`${ORIGIN}/auth/login`);
    expect(reminder.html).toContain("background-color:#ff2d8a");
  });
});
