/**
 * What U1 Account shows about the signed-in runner (ACC-7, ACC-8): the
 * address, whether it is confirmed, and whether there is a password to
 * change — an account made with Google has none.
 */
import { and, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { account, user } from "../../db/schema-auth";
import type { ExportRowState } from "../../lib/contracts/data-export";
import { firstRowWhere, hasRowWhere } from "../../lib/sql/keyed-read";
import { nowSeconds } from "../../lib/now";
import { notificationSettings, type NotificationSettings } from "../email";
import { exportRowState } from "./data-exports";
import { currentTermsVersion, termsStanding } from "./terms-acceptance";
import { usernameOf } from "./username";

type Db = ReturnType<typeof drizzle>;

/**
 * The address and whether it is confirmed: all that Feed, You, D and H
 * need (seam 7's nag band and confirm sheet), in the one read of the
 * `user` row.
 */
export interface AddressView {
  readonly email: string;
  readonly isVerified: boolean;
}

export interface AccountView extends AddressView {
  readonly hasPassword: boolean;
}

async function addressView(
  db: Db,
  userId: string,
): Promise<AddressView | undefined> {
  const row = await firstRowWhere(db, user, eq(user.id, userId));
  if (row === undefined) return undefined;
  return { email: row.email, isVerified: row.emailVerified };
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
  const address = await addressView(db, userId);
  if (address === undefined) return undefined;
  return {
    ...address,
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
 * A view of the signed-in runner's own account, for pages behind a
 * session. A session whose account is gone cannot happen — sessions
 * cascade with the user row — so this is the compiler's case, and it
 * fails loudly rather than drawing an empty page.
 */
function signedIn<T>(view: T | undefined): T {
  if (view === undefined)
    throw new Error("signed in to an account that is gone");
  return view;
}

/**
The signed-in runner's own view, with whether there is a password.
*/
export async function ownAccountView(
  db: Db,
  userId: string,
): Promise<AccountView> {
  return signedIn(await accountView(db, userId));
}

/**
 * The signed-in runner's address alone, for the screens that only need
 * to know whether it is confirmed — no read of the `account` table they
 * would throw away.
 */
export async function ownAddressView(
  db: Db,
  userId: string,
): Promise<AddressView> {
  return signedIn(await addressView(db, userId));
}

/**
 * Everything the account's settings pages show, in one read for one
 * route: the account, the handle, the email switches, the export row's
 * state (ACC-10), and whether the runner is behind on the terms — the
 * page is read only until they accept (round 30 #4a; D-95), and its
 * loader is one of the reads the terms gate lets through, so it asks.
 */
export async function accountPage(
  db: Db,
  userId: string,
  now = nowSeconds(),
  current: number | undefined = currentTermsVersion(),
): Promise<{
  account: AccountView;
  username: string | undefined;
  notifications: NotificationSettings;
  dataExport: ExportRowState;
  isBehindOnTerms: boolean;
}> {
  const [account, username, notifications, dataExport, terms] =
    await Promise.all([
      ownAccountView(db, userId),
      usernameOf(db, userId),
      notificationSettings(db, userId),
      exportRowState(db, userId, now),
      termsStanding(db, userId, current),
    ]);
  return {
    account,
    username,
    notifications,
    dataExport,
    isBehindOnTerms: terms.state === "behind",
  };
}
