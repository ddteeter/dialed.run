const WORDMARK_CLASS = "inline-flex items-baseline font-display lowercase";

/**
 * The [dialed.run] lockup: pink brackets, "dialed" in Archivo Black in the
 * inherited ink, grey ".run". Lowercase always, including sentence-initial.
 *
 * **`brackets={false}` is the plain lockup** the signed-out surfaces draw:
 * Auth's header and panel, and round 21's landing bar, both set
 * "dialed" + grey ".run" and nothing else. Round 21's reason is the bar's
 * own rule — *"pink stays off this bar"* — and the brackets are the only
 * pink in the lockup. The product's own bar and the system states keep
 * them (round 22's X frames draw `[dialed.run]`).
 */
export function Wordmark({
  className,
  brackets = true,
}: Readonly<{
  className?: string | undefined;
  brackets?: boolean | undefined;
}>) {
  return (
    <span
      className={className ? `${WORDMARK_CLASS} ${className}` : WORDMARK_CLASS}
    >
      {/* The brackets are drawn, not said (plan 161, owner 2026-11-03):
          VoiceOver reads "dialed.run", not "left bracket dialed". */}
      {brackets ? (
        <span aria-hidden="true" className="text-cold-text">
          [
        </span>
      ) : undefined}
      <span aria-hidden="true">dialed</span>
      {/* T1's --muted. The brand board draws #8B8B93, which is the *dark*
          column's muted; on paper the role resolves to #6E6E64 and keeps
          its contrast. CLAUDE.md §Design truth: the contract wins. */}
      <span aria-hidden="true" className="text-muted">
        .run
      </span>
      {brackets ? (
        <span aria-hidden="true" className="text-cold-text">
          ]
        </span>
      ) : undefined}
      {/* Said once, as one word, last so the drawn lockup's text stays
          contiguous. The two halves above are separate flex items for
          their colours, and a screen reader walking them heard "dialed"
          and ".run" as two pieces. */}
      <span className="sr-only">dialed.run</span>
    </span>
  );
}
