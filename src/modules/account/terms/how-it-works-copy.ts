/**
 * `/how-it-works`' words (#523): the owner's approved copy, 2026-11-12
 * (draft 2 and its two edits), with the Garmin answer the owner reworded
 * on 2026-11-19 while runners cannot connect Garmin (#441). Round 53 · 163
 * draws them.
 *
 * Change a word only with the owner (CLAUDE.md, "Stop means ask").
 */

/**
 * The wordmark as the copy writes it. The page draws each one as the
 * bracketed lockup (R53·163: a wordmark in prose takes the bracket
 * notation inline).
 */
export const WORDMARK = "[dialed.run]";

/**
A run of an answer: text, or an underlined ink link.
*/
export type Inline = string | { readonly text: string; readonly href: string };

export const PAGE_TITLE = "How it works";

export const LEAD: readonly Inline[] = [
  "[dialed.run] keeps what you wore on each run next to the weather and how it felt. Log enough runs and you stop guessing at the closet.",
];

export const SECTIONS = [
  { id: "loop", title: "The loop" },
  { id: "others", title: "See what other runners wore" },
  { id: "invite-only", title: "Why invite-only?" },
  // Settings › Privacy links here (TotalsSwitch): the id is a contract.
  { id: "totals", title: "How the guides are made" },
  { id: "questions", title: "Questions" },
] as const;

/**
Each step is written as `[lead, body]`: the bold opening, then the rest of it.
*/
const STEP_WORDS = [
  [
    "Fill your closet.",
    "Add what you actually run in. Three pieces is enough to start.",
  ],
  [
    "Log a run.",
    "Upload the file from your watch, or enter it by hand. We fill in the weather.",
  ],
  [
    "Say what you wore and how it felt.",
    "One tap: way cold, a bit cold, dialed, a bit warm or way warm.",
  ],
  ["Share it, or keep it private.", "You choose for each run."],
] as const;

export const STEPS: readonly { lead: string; body: string }[] = STEP_WORDS.map(
  ([lead, body]) => ({ lead, body }),
);

export const LOOP_CLOSE =
  "Over time, each piece in your closet shows the range it works in for you.";

export const COMING_NEXT: readonly Inline[] = [
  "once you have logged enough runs, [dialed.run] will tell you what to wear before you head out.",
];

export const OTHERS =
  "Follow runners and see what they wore and how it worked. The feed also shows what runners wore in weather like yours. When someone's kit helps you decide, mark it useful.";

export const INVITE_ONLY =
  "We're opening in small batches so we can fix what breaks before more runners rely on it.";

export const GUIDES_LEAD =
  "We will publish guides to what runners wear at each temperature. They count private runs too, without names. That keeps them honest: shared runs alone would make it look as if runners get it right more often than they do.";

export const GUIDES: readonly { term: string; definition: string }[] = [
  {
    term: "Counted",
    definition:
      "the temperature band, the sky, the month, the broad climate zone, the gear worn and how it felt.",
  },
  {
    term: "Never counted",
    definition:
      "your name, notes or photos, when your run started, or where it was beyond the climate zone.",
  },
  {
    term: "The floor",
    definition:
      "a figure needs at least 5 runners, or 20 if it names a brand. Counts are rounded to the nearest 5, and only confirmed accounts count.",
  },
  {
    term: "Turning it off",
    definition:
      'Settings › Privacy › "Count my runs in anonymous totals". Your runs leave the guides at the next rebuild, within a month.',
  },
];

export const STRAVA_API_AGREEMENT = "https://www.strava.com/legal/api";

export const QUESTIONS: readonly {
  question: string;
  answer: readonly Inline[];
}[] = [
  {
    question: "Who sees my runs?",
    answer: [
      "A private run is seen by you alone. A shared run is seen by runners signed in to [dialed.run]. A kit you make public can be seen by anyone, even people without an account, and it never shows when or where you ran. Where you ran is never shown to anyone.",
    ],
  },
  {
    question: "Does it connect to Strava?",
    answer: [
      "Only to remind you to log your kit after a run. ",
      { text: "Strava's API agreement", href: STRAVA_API_AGREEMENT },
      " limits what apps like ours may keep, so we never store the activity: not your route, your pace or anything else about it. Disconnect in Settings.",
    ],
  },
  {
    question: "And Garmin?",
    answer: [
      "Not yet. Connecting Garmin is coming. Until then, export the run from Garmin Connect and upload the file.",
    ],
  },
  {
    question: "How do I delete my account?",
    answer: [
      "Settings › Account › Delete account. You have 7 days to change your mind, then it is gone, and from our backups within 30 days. You can export your data first, from the same screen. The ",
      { text: "privacy policy", href: "/privacy" },
      " has the details.",
    ],
  },
];
