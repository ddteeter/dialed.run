import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { themeChoiceSchema } from "../lib/contracts";
import { applyTheme, followOtherTabs } from "../lib/browser/theme";

/**
 * The account's theme over the device's (R48·133, design 185): "On
 * sign-in the account's value takes over", and signed out it is always
 * the system.
 *
 * The root's answer carries the theme whenever it asked who is signed in
 * (`modules/account/theme-answer`), which every sign-in and sign-out makes
 * it do again. On an open-web page it does not ask, so there is no theme
 * and the device keeps what it has: that page is the same for every
 * viewer, and nothing about this one may decide it.
 *
 * Another tab's change reaches this one through the device
 * (`followOtherTabs`, #511), so every open tab shows the same theme.
 *
 * Read from the router's state and parsed, as `SystemState` reads the same
 * answer: at this distance a match's loader data is `unknown`.
 */
const rootMatchSchema = z.object({
  loaderData: z.object({ theme: themeChoiceSchema }),
});

export function ThemeSync(): undefined {
  const [root] = useRouterState({ select: (state) => state.matches });
  const parsed = rootMatchSchema.safeParse(root);
  const theme = parsed.success ? parsed.data.loaderData.theme : undefined;
  useEffect(() => {
    if (theme !== undefined) applyTheme(theme);
    return followOtherTabs();
  }, [theme]);
}
