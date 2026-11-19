import { getRouteApi } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { DeskToday } from "../desk";
import { DeskShell, type DeskPage as DeskPageName } from "./DeskShell";

/**
 * The `/desk` layout's loader data (Today's counts), read from any page
 * under it. Every Desk page needs it for the rail; Review and Today read
 * it for their own content too.
 *
 * `getRouteApi` is called here rather than held at module scope: a route
 * imports this, so it is in the client bundle, and nothing built at
 * import time may ride along (`.claude/rules/routes.md`).
 */
export function useDeskToday(): DeskToday {
  return getRouteApi("/desk").useLoaderData();
}

/**
 * One Desk page: the shell, its rail marking `current`, around the page's
 * own content. What every route under `/desk` would otherwise repeat:
 * reading the layout's data and handing it to `DeskShell`.
 */
export function DeskPage({
  current,
  children,
}: Readonly<{ current: DeskPageName; children: ReactNode }>) {
  return (
    <DeskShell current={current} today={useDeskToday()}>
      {children}
    </DeskShell>
  );
}
