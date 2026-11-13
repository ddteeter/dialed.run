import { createContext, use } from "react";
import type { ReactNode } from "react";

const DeskSignOutContext = createContext<ReactNode>(undefined);

/**
 * The Desk's top bar's Sign out (R55·194), seated by the `/desk` layout
 * route once for every Desk page, as the runner app's bell is seated by
 * its route (`BellProvider`): a component may not import the sign-out,
 * and seven routes repeating one prop is seven places to forget it.
 */
export const DeskSignOutProvider = DeskSignOutContext;

/**
Where the bar draws it; nothing where no route seated one.
*/
export function DeskSignOut(): ReactNode {
  return use(DeskSignOutContext);
}
