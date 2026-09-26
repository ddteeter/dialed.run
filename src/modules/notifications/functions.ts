/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireUserId } from "../auth";
import { notificationsDb } from "./db";
import { nowSeconds } from "../../lib/now";
import {
  bellState,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./service";

export const listNotificationsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return listNotifications(notificationsDb(), userId, nowSeconds());
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
  await markAllNotificationsRead(notificationsDb(), userId, nowSeconds());
});

/**
 * Everything the bell needs, for a route to spread into `BelledLayout`:
 * the unread count (the dot) and the runs waiting for a verdict (the
 * number). Round 22, item 13.
 */
export const bellStateFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const userId = await requireUserId();
    return bellState(notificationsDb(), userId, nowSeconds());
  },
);
