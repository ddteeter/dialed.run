const WORDMARK_CLASS = "inline-flex items-baseline font-display lowercase";

/**
 * The [dialed.run] lockup: pink brackets, "dialed" in Archivo Black in the
 * inherited ink, grey ".run". Lowercase always, including sentence-initial.
 *
 * Every bar draws the brackets, the signed-out frame's included (R55·176
 * rules one wordmark, the bar's, pink-bracketed), so there is no plain
 * lockup any more.
 *
 * **`isDeskMark` is the Desk's `[dialed]`** (R55·194): the brackets and
 * "dialed", no ".run". Heard the same as every other lockup.
 */
export function Wordmark({
  className,
  isDeskMark = false,
}: Readonly<{
  className?: string | undefined;
  isDeskMark?: boolean | undefined;
}>) {
  return (
    <span
      className={className ? `${WORDMARK_CLASS} ${className}` : WORDMARK_CLASS}
    >
      {/* The brackets are drawn, not said (plan 161, owner 2026-11-03):
          VoiceOver reads "dialed.run", not "left bracket dialed". */}
      <span aria-hidden="true" className="text-cold-text">
        [
      </span>
      <span aria-hidden="true">dialed</span>
      {/* T1's --muted. The brand board draws #8B8B93, which is the *dark*
          column's muted; on paper the role resolves to #6E6E64 and keeps
          its contrast. CLAUDE.md §Design truth: the contract wins. */}
      {isDeskMark ? undefined : (
        <span aria-hidden="true" className="text-muted">
          .run
        </span>
      )}
      <span aria-hidden="true" className="text-cold-text">
        ]
      </span>
      {/* Said once, as one word, last so the drawn lockup's text stays
          contiguous. The two halves above are separate flex items for
          their colours, and a screen reader walking them heard "dialed"
          and ".run" as two pieces. */}
      <span className="sr-only">dialed.run</span>
    </span>
  );
}
