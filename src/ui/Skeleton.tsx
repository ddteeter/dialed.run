/**
 * Loading block at real content dimensions — the caller sizes it via
 * className (e.g. "h-4 w-24"). No spinners, per docs/product.md
 * §System states.
 *
 * **It breathes rather than pulsing, and the difference is not cosmetic.**
 * This carried Tailwind's `animate-pulse` until task 114: a 2s loop from 1
 * to 0.5 on `cubic-bezier(0.4, 0, 0.6, 1)`, which is a second waiting
 * device with a duration and a curve from outside the doctrine — and one
 * that keeps animating under `prefers-reduced-motion`, because Tailwind's
 * default theme has no opinion about that. `breathe` is the product's one
 * waiting device (1 to 0.35 over 900ms, linear, static when reduced), and
 * a skeleton is a wait like any other.
 */
export function Skeleton({ className }: Readonly<{ className: string }>) {
  return (
    <div
      aria-hidden="true"
      className={`breathe rounded-tight bg-hairline ${className}`}
    />
  );
}
