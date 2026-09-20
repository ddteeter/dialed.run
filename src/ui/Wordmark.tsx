const WORDMARK_CLASS = "inline-flex items-baseline font-display lowercase";

/**
 * The [dialed.run] lockup: pink brackets, "dialed" in Archivo Black in the
 * inherited ink, grey ".run". Lowercase always, including sentence-initial.
 */
export function Wordmark({
  className,
}: Readonly<{ className?: string | undefined }>) {
  return (
    <span
      className={className ? `${WORDMARK_CLASS} ${className}` : WORDMARK_CLASS}
    >
      <span className="text-cold-text">[</span>
      <span>dialed</span>
      {/* T1's --muted. The brand board draws #8B8B93, which is the *dark*
          column's muted; on paper the role resolves to #7A7A70 and keeps
          its contrast. CLAUDE.md §Design truth: the contract wins. */}
      <span className="text-muted">.run</span>
      <span className="text-cold-text">]</span>
    </span>
  );
}
