import { describe, expect, it } from "vitest";

import type { EmailTemplate } from "../../src/lib/email";
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
  ])("says what round 26 draws for %o", (template, expected) => {
    expect(
      emailContent(template, { origin: ORIGIN, unsubscribe: UNSUBSCRIBE }),
    ).toStrictEqual(expected);
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
