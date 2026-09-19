import type { ReactNode } from "react";

/**
 * Which rung of the mono ramp. `design/tokens.js` MONO, and the whole
 * reason this prop exists: the ramp has four steps carrying four
 * trackings, and this component used to hardcode `tracking-[0.08em]` — a
 * value no step has. One primitive that could only ever be one treatment
 * is what produced 17 call sites writing `font-mono text-[11px]
 * tracking-[0.1em]` by hand instead of using it.
 */
export type MonoStep = "xs" | "sm" | "md" | "lg";

/**
 * The size utility carries the step's line-height and tracking with it
 * (Tailwind pairs `--text-x--letter-spacing` with the size), so tokens.js
 * law 1 — *tracking is a function of size, not context* — holds here by
 * construction: there is no second class to get wrong.
 *
 * Case is the one thing the utility cannot carry, so it is written out.
 * Uppercase is legal at `xs` and `sm` only; `md` and `lg` are mixed case
 * because they sit inside prose and in the data strip, where a shouted
 * value would be the loudest thing on the screen.
 */
const STEP_CLASS: Readonly<Record<MonoStep, string>> = {
  xs: "font-mono text-mono-xs uppercase",
  sm: "font-mono text-mono-sm uppercase",
  md: "font-mono text-mono-md",
  lg: "font-mono text-mono-lg",
};

/**
 * IBM Plex Mono span for measured values (pace, distance, weather,
 * timestamps, wear counts). Mono is the tell that a number came from a
 * sensor, not a person — docs/product.md §Brand application.
 *
 * `sm` is the default because it is what the call sites asked for: of the
 * 17 that bypassed this component, 10 wrote 11px and 3 wrote 10px, and of
 * the 35 that used it, 13 sized themselves at 12px — which COLLAPSE sends
 * to `sm`. It is also the step that keeps `Bracketed` uppercase, which its
 * contract depends on.
 */
export function Mono({
  step = "sm",
  children,
  className,
}: Readonly<{
  step?: MonoStep | undefined;
  children: ReactNode;
  className?: string | undefined;
}>) {
  const stepClass = STEP_CLASS[step];
  return (
    <span className={className ? `${stepClass} ${className}` : stepClass}>
      {children}
    </span>
  );
}
