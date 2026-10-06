import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { Mono } from "../../../ui";

/**
 * Settings › Account while the runner is behind on the terms (round 30
 * #4a; D-95): the account is still theirs to read, export and delete, and
 * nothing on it can be changed until they accept. Otherwise the ordinary
 * one, `children`. The route asks twice: once for the shell (no tab bar
 * while behind, because every tab is closed to them) and once for U1's
 * body.
 *
 * A component rather than a choice in the route, because a route cannot
 * be imported by a test and the choice is the point.
 */
export function AccountUnlessBehindOnTerms({
  isBehind,
  behind,
  children,
}: Readonly<{
  isBehind: boolean;
  /**
  The read-only page, `AccountWhileBehind`, the route's to wire.
  */
  behind: ReactNode;
  children: ReactNode;
}>): ReactNode {
  return isBehind ? behind : children;
}

/**
 * The read-only body of U1, as round 30 draws it ("Account gated r30"),
 * under the sub-page's own heading "Account":
 *
 * - **No tab bar** (the route's shell). The board's back link reads
 *   "‹ Terms"; the build keeps the sub-page's "‹ Settings", which the
 *   root's gate sends to the prompt, because a screen has one heading
 *   source and that frame is it (design-deltas item 50).
 * - **Values as text, not fields**, each with the hint "Accept the Terms
 *   to change this." in TYPE.small `--muted` and no band, "because nothing
 *   failed", and a link back to the prompt. The editing controls leave the
 *   tab order because there are none.
 * - **Sign out everywhere stays live**, "because it's a safety action",
 *   and **Export and Delete run their normal flows** (D-95), so the route
 *   hands in the same three it gives the ordinary page.
 *
 * The board draws Email and Strava. Strava's connect control is on
 * Settings › Strava, not here, so it is not on this page; Username and
 * Password are, because the ordinary page edits them.
 */
export function AccountWhileBehind({
  account,
  username,
  signOutEverywhere,
  dataExport,
  deletion,
}: Readonly<{
  account: { email: string; hasPassword: boolean };
  username: string | undefined;
  signOutEverywhere: ReactNode;
  dataExport: ReactNode;
  deletion: ReactNode;
}>): JSX.Element {
  return (
    <div data-part="account-while-behind" className="flex flex-col gap-6">
      <ul data-part="read-only" className="m-0 flex list-none flex-col p-0">
        <ReadOnlyRow label="Email" value={account.email} />
        <ReadOnlyRow
          label="Username"
          value={username === undefined ? "Not picked" : `@${username}`}
        />
        {account.hasPassword ? <ReadOnlyRow label="Password" /> : undefined}
      </ul>
      {signOutEverywhere}
      {dataExport}
      {deletion}
    </div>
  );
}

/**
 * One setting, read only: its label, its value as text, and why it
 * cannot be changed yet.
 */
function ReadOnlyRow({
  label,
  value,
}: Readonly<{ label: string; value?: string | undefined }>): JSX.Element {
  return (
    <li
      data-part="read-only-row"
      className="flex flex-col gap-1 border-b border-hairline py-3"
    >
      <Mono step="xs" className="text-muted">
        {label}
      </Mono>
      {value === undefined ? undefined : (
        <span data-part="value" className="text-body text-ink">
          {value}
        </span>
      )}
      <span className="text-small text-muted">
        Accept the Terms to change this.{" "}
        <Link
          data-target="inline"
          to="/account/terms"
          className="font-semibold text-ink underline underline-offset-4"
        >
          Accept
        </Link>
      </span>
    </li>
  );
}
