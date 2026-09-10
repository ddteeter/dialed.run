import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { JSX } from "react";

/**
 * The devtools panel, or nothing.
 *
 * `VITE_DEVTOOLS=off` is how a build turns it off, and the decision lives
 * here rather than in `__root.tsx` because a route file holds no
 * decisions — that is the rule
 * `test/architecture/server-functions-are-glue` enforces.
 */
export function areDevtoolsOff(flag: string | undefined): boolean {
  return flag === "off";
}

export function Devtools(): JSX.Element | undefined {
  if (areDevtoolsOff(import.meta.env.VITE_DEVTOOLS)) return undefined;
  return (
    <TanStackDevtools
      config={{ position: "bottom-right" }}
      plugins={[
        {
          name: "Tanstack Router",
          render: <TanStackRouterDevtoolsPanel />,
        },
      ]}
    />
  );
}
