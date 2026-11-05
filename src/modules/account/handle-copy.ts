/**
 * The handle field's words (round 26 #7, "O0 Handle taken"), in one place
 * so O0, Settings › Username and their tests read the same strings.
 *
 * The shape refusals live in `usernameSchema`'s messages (error copy lives
 * in the schema). This is the one refusal only the server can make.
 */
export const HANDLE_COPY = {
  label: "Username",
  /**
   * The rule, drawn as the board words it and said in words: a screen
   * reader reads "3–20 … or _" as "3 dash 20 … or underscore" or skips
   * the mark (a11y judgment audit, 2026-11-04). `Spoken` takes the pair.
   */
  rule: {
    shown: "3–20 letters, numbers or _.",
    said: "3 to 20 letters, numbers or underscores.",
  },
  /**
  What O0 and Settings add after the rule. A moderator's re-pick (round 27 #16) says the rule alone.
  */
  ruleReason: "It's on everything you share. You can change it in settings.",
} as const;

/**
 * *"@maya_runs is taken. Try another, like @maya_runs_pdx."* — with one
 * real, free suggestion when there is one. When there is none (a handle
 * built on a reserved word has no free neighbour), the sentence stops
 * before the "like": we never suggest a handle we would refuse.
 */
export function takenMessage(
  handle: string,
  suggestion: string | undefined,
): string {
  return suggestion === undefined
    ? `@${handle} is taken. Try another.`
    : `@${handle} is taken. Try another, like @${suggestion}.`;
}
