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
      {brackets ? <span className="text-cold-text">[</span> : undefined}
      <span>dialed</span>
      {/* T1's --muted. The brand board draws #8B8B93, which is the *dark*
          column's muted; on paper the role resolves to #7A7A70 and keeps
          its contrast. CLAUDE.md §Design truth: the contract wins. */}
      <span className="text-muted">.run</span>
      {brackets ? <span className="text-cold-text">]</span> : undefined}
    </span>
  );
}
