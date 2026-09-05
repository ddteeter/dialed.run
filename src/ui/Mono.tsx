import type { ReactNode } from "react";

const MONO_CLASS = "font-mono uppercase tracking-[0.08em]";

/**
 * IBM Plex Mono span for measured values (pace, distance, weather,
 * timestamps, wear counts). Mono is the tell that a number came from a
 * sensor, not a person — docs/product.md §Brand application.
 */
export function Mono({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string | undefined;
}>) {
  return (
    <span className={className ? `${MONO_CLASS} ${className}` : MONO_CLASS}>
      {children}
    </span>
  );
}
