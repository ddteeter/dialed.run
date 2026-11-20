/**
 * What a runner is called anywhere the feed names one, in words: `@maya`,
 * or "A runner" for an account that has no handle yet.
 *
 * The "@" is part of the name (round 26 #7, "@ included"), so it is in the
 * text a screen reader reads and a sentence quotes, not drawn beside it.
 */
export function handleText(username: string | null | undefined): string {
  return typeof username === "string" ? `@${username}` : "A runner";
}

/**
 * Round 26 #7, "Handle placements": **one style — Archivo 600, "@"
 * included, lowercase as stored, never mono.** "A handle is a name, not
 * data", so it is never set in the measured-value face, and search, G and
 * H moved off mono to this.
 *
 * Lowercase is the stored form (the rule lowercases as typed), so nothing
 * here transforms it; size is the placement's, which is why this sets only
 * the weight and inherits the rest.
 */
export function Handle({
  username,
}: Readonly<{ username: string | null | undefined }>) {
  return (
    <span className="font-sans font-semibold">{handleText(username)}</span>
  );
}
