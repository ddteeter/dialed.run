import type { ReactNode } from "react";

/**
 * Where Report sits on D and H (round 22, item 21): *"a quiet text link at
 * the foot, never in the header (the header's slot is for back)."* The
 * control itself is lane 124's W1 trigger, handed in by the route; this
 * is only its place.
 */
export function ReportFoot({ children }: Readonly<{ children?: ReactNode }>) {
  if (children === undefined) return;
  return (
    <div data-part="report" className="pb-3 text-small text-label">
      {children}
    </div>
  );
}
