/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps ./index.ts loadable in the vitest workers pool with no
 * TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";

import { getRequestHeaders } from "@tanstack/react-start/server";

import { auth } from "../auth";
import { notificationsDb } from "./db";
import {
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
} from "./service";

class UnauthenticatedError extends Error {}

/**
 * TEMPORARY. The shared auth gate lands with lane 101 (modules/auth
 * exports requireUserId), and the eslint rule that ships with it makes a
 * local copy like this an error — which is the signal to delete this
 * function and import the real one. It exists only because that branch has
 * not merged yet and this module cannot deep-import lane 102's copy.
 */
async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (session === null) throw new UnauthenticatedError();
  return session.user.id;
}


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
