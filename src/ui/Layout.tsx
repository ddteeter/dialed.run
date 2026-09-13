import type { ReactNode } from "react";

import { TabBar } from "./TabBar";
import { useHydrated } from "./use-hydrated";

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
  useHydrated();

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
