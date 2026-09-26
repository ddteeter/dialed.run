/**
 * The share card's colours, as literal hex because satori paints an image
 * and cannot read a CSS custom property.
 *
 * **A copy, pinned.** Each value is a role from `src/ui/tokens.css` — the
 * palette constants and T1's dark column, which is what an ink card is —
 * and `test/ops/og.test.ts` reads that file and fails if any value here
 * drifts from it. Round 26 #22 draws the card on ink with these roles.
 */
export const OG_PALETTE = {
  /**
  `--night-run`: the card's ground.
  */
  ink: "#0b0b0e",
  /**
  `--chalk`: text on ink.
  */
  paper: "#f4f3ef",
  /**
  `--course-pink`: the brackets, and a cold verdict.
  */
  pink: "#ff2d8a",
  /**
  `--split-teal`: a dialed verdict, and the precipitation word.
  */
  teal: "#00e0c6",
  /**
  Dark `--quiet`: a warm verdict.
  */
  quiet: "#b9b8ae",
  /**
  Dark `--muted`: the wordmark's `.run` and the date.
  */
  muted: "#8b8b93",
  /**
  Dark `--ink-hover`: secondary text, one step toward the ink.
  */
  soft: "#deddd6",
} as const;
