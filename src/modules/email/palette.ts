/**
 * An email's colours, as literal hex because an email client reads no CSS
 * custom property.
 *
 * **A copy, pinned**, as the share card's is (`ops/og/palette.ts`): each
 * value is a light-column role from `src/ui/tokens.css`, and
 * `test/email/palette.dom.test.tsx` reads that file and fails if any value
 * here drifts from it. Emails are drawn on paper (round 26, "THE EMAILS").
 */
export const EMAIL_PALETTE = {
  /**
  `--chalk`, the ground.
  */
  ground: "#f4f3ef",
  /**
  `--panel`: the card the message sits on.
  */
  panel: "#ffffff",
  /**
  `--night-run`: text, and the text on the button.
  */
  ink: "#0b0b0e",
  /**
  `--course-pink` (`--action`): the button and the wordmark's brackets.
  */
  action: "#ff2d8a",
  /**
  `--quiet`: the foot, and the footer's links.
  */
  quiet: "#4e4e44",
  /**
  `--muted`: the footer, and the wordmark's `.run`.
  */
  muted: "#7a7a70",
  /**
  `--hairline`: the rule above the footer.
  */
  hairline: "#dcdbd2",
} as const;
