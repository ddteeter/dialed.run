import type { ReactNode } from "react";

import { TabBar } from "./TabBar";

/**
 * Page shell: chalk surface, ink type, the five-tab footer, and the
 * top-right slot where the notification bell will live.
 */
export function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col bg-chalk text-night">
      <header className="flex items-center justify-end px-5 pt-4">
        {/* Empty slot: lane 102 mounts the notification bell here. */}
        <div aria-hidden="true" data-slot="notification-bell" />
      </header>
      <div className="flex-1 pb-24">{children}</div>
      <TabBar />
    </div>
  );
}
