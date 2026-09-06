/**
 * Client-side "Continue with Google" button, shared by the login and signup
 * routes. Like client.ts, deliberately NOT exported from index.ts — route
 * components import this file directly.
 */
import { useState } from "react";

import { authClient } from "./client";

export function GoogleButton() {
  const [error, setError] = useState<string | undefined>();

  async function start() {
    setError(undefined);
    // On success the browser navigates away to Google's consent screen.
    const result = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });
    if (result.error) {
      setError(result.error.message ?? "That didn't work. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          void start();
        }}
        className="rounded-md border border-night/20 bg-white px-4 py-2 font-semibold"
      >
        Continue with Google
      </button>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
    </div>
  );
}
