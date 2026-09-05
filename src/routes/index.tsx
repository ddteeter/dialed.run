import { createFileRoute, Link, useRouter } from "@tanstack/react-router";

import { getSession } from "../modules/auth/functions";
// Client entry imported directly by design — see modules/auth/client.ts.
import { authClient } from "../modules/auth/client";
import { Bracketed, Layout, Mono, Wordmark } from "../ui";

export const Route = createFileRoute("/")({
  loader: async () => ({ session: await getSession() }),
  component: Home,
});

function Home() {
  const { session } = Route.useLoaderData();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    await router.invalidate();
  }

  return (
    <Layout>
      <main className="mx-auto flex w-full max-w-xl flex-col items-start gap-6 px-6 pt-16">
        <Wordmark className="text-2xl" />
        <h1 className="m-0 font-display text-4xl leading-[1.04] uppercase tracking-[-0.02em] sm:text-5xl">
          Every run has an outfit. Log it.
        </h1>
        <p className="m-0 max-w-md text-base leading-relaxed text-night/70">
          A virtual wardrobe for runners: what you wore, on which run, in which
          weather.
        </p>
        {session === null ? (
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
            <Mono className="text-xs">{session.user.email}</Mono>
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
        )}
        <Bracketed className="text-sm">Phase 0</Bracketed>
      </main>
    </Layout>
  );
}
