import { Link } from "@tanstack/react-router";

import { Mono } from "../../../ui";

/**
 * The home page's two states: sign up / log in, or who you are and a way
 * out.
 *
 * A component rather than a ternary in the route because the route cannot
 * be imported by a test, and "a signed-out visitor is offered a way in" is
 * the first thing anyone sees.
 */
export function SessionActions({
  email,
  signOut,
}: Readonly<{ email: string | undefined; signOut: () => Promise<unknown> }>) {
  return email === undefined ? (
    <div className="flex items-center gap-4">
      <Link
        to="/auth/signup"
        className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
      >
        Sign up
      </Link>
      <Link to="/auth/login" className="font-semibold text-pink">
        Log in
      </Link>
    </div>
  ) : (
    <div className="flex items-center gap-4">
      <Mono className="text-xs">{email}</Mono>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
        className="font-semibold text-pink"
      >
        Sign out
      </button>
    </div>
  );
}
