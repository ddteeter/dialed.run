import type { ReactNode } from "react";
import { useEffect } from "react";

import { TabBar } from "./TabBar";

/**
 * Page shell: chalk surface, ink type, the five-tab footer, and the
 * top-right slot where the notification bell lives. `bell` is supplied by
 * the caller (lane 102's NotificationBell component) rather than imported
 * here — ui/ is foundation and may not import from modules/ (CLAUDE.md
 * architecture rules; enforced by dependency-cruiser).
 */
export function Layout({
  children,
  bell,
}: Readonly<{ children: ReactNode; bell?: ReactNode }>) {
  // Deterministic hydration signal: controlled inputs are only safe to
  // drive (by humans or Playwright) once React has attached. E2e specs
  // wait for html[data-hydrated="true"] instead of racing hydration.
  // Equivalent mutant on the dependency list: stryker replaces `[]` with a
  // constant one-element array, which is just as stable across renders, so
  // the effect still runs exactly once either way. The block form rather
  // than `next-line` because the mutant's line begins with the arrow
  // function's closing brace, and a directive above it does not attach.
  // Stryker disable ArrayDeclaration
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  // Stryker restore ArrayDeclaration

  return (
    <div className="flex min-h-dvh flex-col bg-chalk text-night">
      <header className="flex items-center justify-end px-5 pt-4">
        {bell ?? <div aria-hidden="true" data-slot="notification-bell" />}
      </header>
      <div className="flex-1 pb-24">{children}</div>
      <TabBar />
    </div>
  );
}
