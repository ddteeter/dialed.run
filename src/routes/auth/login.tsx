import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

// Client entry imported directly by design — see modules/auth/client.ts.
import { authClient } from "../../modules/auth/client";
import { Layout, Wordmark } from "../../ui";

export const Route = createFileRoute("/auth/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const result = await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "That didn't work. Try again.");
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <Layout>
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-12">
        <Wordmark className="text-2xl" />
        <h1 className="font-display text-3xl uppercase leading-none">
          Log in
        </h1>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
            />
          </label>
          {error === undefined ? undefined : (
            <p className="text-sm font-semibold text-pink">{error}</p>
          )}
          <button
            type="submit"
            className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
          >
            Log in
          </button>
        </form>
        <p className="text-sm">
          New here?{" "}
          <Link to="/auth/signup" className="font-semibold text-pink">
            Sign up
          </Link>
        </p>
      </div>
    </Layout>
  );
}
