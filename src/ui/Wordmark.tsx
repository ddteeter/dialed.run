const WORDMARK_CLASS =
  "inline-flex items-baseline font-display lowercase tracking-[-0.045em]";

/**
 * The [dialed.run] lockup: pink brackets, "dialed" in Archivo Black in the
 * inherited ink, grey ".run". Lowercase always, including sentence-initial.
 */
export function Wordmark({ className }: Readonly<{ className?: string | undefined }>) {
  return (
    <span
      className={className ? `${WORDMARK_CLASS} ${className}` : WORDMARK_CLASS}
    >
      <span className="text-pink">[</span>
      <span>dialed</span>
      {/* Grey from the brand artboards (design/Brand Brief.dc.html). */}
      <span className="text-[#8B8B93]">.run</span>
      <span className="text-pink">]</span>
    </span>
  );
}
