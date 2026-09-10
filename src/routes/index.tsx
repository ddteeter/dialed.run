import { createFileRoute, useRouter } from "@tanstack/react-router";

import { authClient } from "../modules/auth/client";
import { SessionActions } from "../modules/auth/components/SessionActions";
import { getSession } from "../modules/auth/functions";
import { Bracketed, Layout, Wordmark } from "../ui";

export const Route = createFileRoute("/")({
  loader: async () => ({ session: await getSession() }),
  component: Home,
});

function Home() {
  const { session } = Route.useLoaderData();
  const router = useRouter();

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
        <SessionActions
          email={session?.user.email}
          signOut={async () => {
            await authClient.signOut();
            await router.invalidate();
          }}
        />
        <Bracketed className="text-sm">Phase 0</Bracketed>
      </main>
    </Layout>
  );
}
