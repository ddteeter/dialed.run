/**
 * What U1 Account shows about the signed-in runner (ACC-7, ACC-8): the
 * address, whether it is confirmed, and whether there is a password to
 * change — an account made with Google has none.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { account, user } from "../../db/schema-auth";
import type { ExportRowState } from "../../lib/data-export";
import { firstRowWhere, hasRowWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";
import { notificationSettings, type NotificationSettings } from "../email";
import { exportRowState } from "./data-exports";
import { usernameOf } from "./username";

type Db = ReturnType<typeof drizzle>;

export interface AccountView {
  readonly email: string;
  readonly isVerified: boolean;
  readonly hasPassword: boolean;
}

/**
 * `undefined` for nobody signed in, or an account that is gone — Au4 is
 * reachable signed out.
 */
export async function accountView(
  db: Db,
  userId: string | undefined,
): Promise<AccountView | undefined> {
  if (userId === undefined) return undefined;
  const row = await firstRowWhere(db, user, eq(user.id, userId));
  if (row === undefined) return undefined;
  return {
    email: row.email,
    isVerified: row.emailVerified,
    // Better Auth's email-and-password sign-up links a `credential`
    // account holding the hash; Google's links a `google` one.
    hasPassword: await hasRowWhere(
      db,
      account,
      account.id,
      and(eq(account.userId, userId), eq(account.providerId, "credential")),
    ),
  };
}

/**
 * The signed-in runner's own view, for pages behind a session. A session
 * whose account is gone cannot happen — sessions cascade with the user
 * row — so this is the compiler's case, and it fails loudly rather than
 * drawing an empty page.
 */
export async function ownAccountView(
  db: Db,
  userId: string,
): Promise<AccountView> {
  const view = await accountView(db, userId);
  if (view === undefined)
    throw new Error("signed in to an account that is gone");
  return view;
}

/**
 * Everything the account's settings pages show, in one read for one
 * route: the account, the handle, the email switches, and the export
 * row's state (ACC-10).
 */
export async function accountPage(
  db: Db,
  userId: string,
  now = nowSeconds(),
): Promise<{
  account: AccountView;
  username: string | undefined;
  notifications: NotificationSettings;
  dataExport: ExportRowState;
}> {
  const [account, username, notifications, dataExport] = await Promise.all([
    ownAccountView(db, userId),
    usernameOf(db, userId),
    notificationSettings(db, userId),
    exportRowState(db, userId, now),
  ]);
  return { account, username, notifications, dataExport };
}
