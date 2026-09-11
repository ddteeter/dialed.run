import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { AuthCrossLink, AuthPage } from "../../src/modules/auth/auth-page";
import { authClient } from "../../src/modules/auth/client";
import { GoogleButton } from "../../src/modules/auth/google-button";
import type { FormShell } from "../../src/ui";

// Better Auth's browser client talks to the network; the button's job is
// what it does with the two answers it can get back.
vi.mock("../../src/modules/auth/client", () => ({
  authClient: { signIn: { social: vi.fn() } },
}));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/**
 * A resting form: nothing submitted, nothing wrong, nothing pending.
 *
 * `AuthPage` takes the form's state as one prop rather than nine, so this
 * is the one place the shell's idle state is described — and `FormShell`
 * is picked off `useFormSubmit`, so a member added to the hook shows up
 * here as a type error rather than as a silently stale literal.
 */
function restingForm(): FormShell {
  return {
    status: "",
    summaryRows: [],
    summaryRef: createRef<HTMLDivElement>(),
    focusField: () => {
      // the summary is empty in these cases
    },
    failure: undefined,
    retry: () => {
      // no failure band in these cases
    },
    retryRef: createRef<HTMLButtonElement>(),
    pending: false,
    formRef: createRef<HTMLFormElement>(),
  };
}

function page(overrides: Partial<Parameters<typeof AuthPage>[0]> = {}) {
  return (
    <AuthPage
      heading="Sign in"
      submitLabel="Sign in"
      pendingLabel="Signing in"
      form={restingForm()}
      onSubmit={() => {
        // overridden where the call is what is being asserted
      }}
      footer={<AuthCrossLink prompt="New here?" to="/auth/signup" label="Sign up" />}
      {...overrides}
    >
      <input aria-label="Email" name="email" />
    </AuthPage>
  );
}

describe("AuthPage", () => {
  it("submits through the caller's handler, never the browser's", async () => {
    // `noValidate`: the browser's own bubbles are a second, unstyled error
    // system that fires first and says "Please fill in this field" —
    // banned copy, and it would pre-empt the schema.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    await renderWithRouter(page({ onSubmit }));

    const form = screen.getByRole("button", { name: "Sign in" }).closest("form");
    expect(form).toHaveAttribute("novalidate");

    // The submit is prevented, so the browser never navigates and the
    // handler owns the outcome. Listening on the document rather than the
    // form: React's own listener sits at the root and runs first, so this
    // sees the event after the component has had it.
    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Sign in" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("wears the shell both screens share", async () => {
    await renderWithRouter(page({ heading: "Create your account" }));
    expect(
      screen.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    expect(screen.getByText("or")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Email")).toBeVisible();
  });

  it("links to the other screen without either page naming the other's path", async () => {
    await renderWithRouter(page());
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/auth/signup",
    );
    // The space between the two is a deliberate `{" "}`: JSX drops
    // whitespace between elements, so without it the sentence reads
    // "New here?Sign up".
    expect(
      screen.getByRole("link", { name: "Sign up" }).parentElement,
    ).toHaveTextContent(/^New here\? Sign up$/);
  });
});

describe("GoogleButton", () => {
  it("starts the Google flow and says nothing while it works", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.social).mockResolvedValue({ error: undefined });
    render(<GoogleButton />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/",
    });
  });

  it("says nothing at rest, rather than reserving an empty line", () => {
    render(<GoogleButton />);
    // Not just "no text" — no element. An empty <p> in a flex column takes
    // a line's worth of gap with it.
    expect(screen.queryByRole("paragraph")).toBeNull();
  });

  it("clears the last refusal before trying again", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.social)
      .mockResolvedValueOnce({ error: { message: "Account is disabled." } })
      .mockResolvedValueOnce({ error: undefined });
    render(<GoogleButton />);
    const button = screen.getByRole("button", {
      name: "Continue with Google",
    });

    await user.click(button);
    expect(await screen.findByText("Account is disabled.")).toBeVisible();

    // A stale error next to a fresh attempt is a lie about what just
    // happened.
    await user.click(button);
    await waitFor(() => {
      expect(screen.queryByText("Account is disabled.")).toBeNull();
    });
  });

  it("shows the provider's own message when it refuses", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.social).mockResolvedValue({
      error: { message: "Account is disabled." },
    });
    render(<GoogleButton />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Account is disabled.")).toBeVisible();
  });

  it("falls back to copy of its own when the provider gives none", async () => {
    const user = userEvent.setup();
    vi.mocked(authClient.signIn.social).mockResolvedValue({
      error: { message: undefined },
    });
    render(<GoogleButton />);

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("That didn't work. Try again.")).toBeVisible();
  });
});
