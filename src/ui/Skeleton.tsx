/**
 * Loading block at real content dimensions — the caller sizes it via
 * className (e.g. "h-4 w-24"). No spinners, per docs/product.md
 * §System states.
 */
export function Skeleton({ className }: Readonly<{ className: string }>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-night/10 ${className}`}
    />
  );
}
