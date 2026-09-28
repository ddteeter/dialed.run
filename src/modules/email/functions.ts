/**
 * Server-fn glue for the email module (imported directly by route files,
 * per modules/auth's pattern) — keeps this module's other files loadable
 * in the vitest workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { requireUserId } from "../auth";
import { linkSearchInput, notificationSettingsInput } from "./inputs";
import { readByLink, switchByLink } from "./landing";
import { setEmailPreference } from "./preferences";
import { notificationSettings } from "./settings";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
 * The unsubscribe landing's loader: reads the link and changes nothing
 * (D-64) — the landing asks.
 */
export const unsubscribeLinkQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => linkSearchInput.parse(data))
  .handler(async ({ data }) =>
    readByLink(db(), env.UNSUBSCRIBE_SECRET, data.search),
  );

/**
The landing's one button: the unsubscribe itself.
*/
export const unsubscribeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => linkSearchInput.parse(data))
  .handler(async ({ data }) =>
    switchByLink(db(), env.UNSUBSCRIBE_SECRET, data.search, false),
  );

/**
"Turn them back on", on the same page, with the same signed link.
*/
export const resubscribeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => linkSearchInput.parse(data))
  .handler(async ({ data }) =>
    switchByLink(db(), env.UNSUBSCRIBE_SECRET, data.search, true),
  );

/**
Settings › Notifications (ACC-11): the address emails go to, and the switch.
*/
export const notificationSettingsQuery = createServerFn({
  method: "GET",
}).handler(async () => notificationSettings(db(), await requireUserId()));

export const saveNotificationSettingsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => notificationSettingsInput.parse(data))
  .handler(async ({ data }) => {
    await setEmailPreference(
      db(),
      await requireUserId(),
      "run_reminder",
      data.runReminder,
    );
  });
