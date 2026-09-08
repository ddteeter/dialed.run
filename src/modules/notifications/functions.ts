/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireUserId } from "../auth";
import { notificationsDb } from "./db";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./service";

export const listNotificationsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return listNotifications(notificationsDb(), userId);
  },
);

export const unreadNotificationCountFn = createServerFn({
  method: "GET",
}).handler(async () => {
  const userId = await requireUserId();
  return unreadNotificationCount(notificationsDb(), userId);
});

export const markAllNotificationsReadFn = createServerFn({
  method: "POST",
}).handler(async () => {
  const userId = await requireUserId();
  await markAllNotificationsRead(notificationsDb(), userId);
});
