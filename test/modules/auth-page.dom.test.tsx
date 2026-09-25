import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signInSchema } from "../../src/lib/contracts";
import { AUTH_COPY } from "../../src/modules/auth/auth-copy";
import {
  AuthCrossLink,
  AuthLegal,
  AuthPage,
  LoginCrossLink,
  PasswordField,
  SessionNotice,
  useAuthForm,
} from "../../src/modules/auth/auth-page";
import { signIn } from "../../src/modules/auth/credentials";
import { useGoogleSignIn } from "../../src/modules/auth/google-button";
import {
  CARRIED_EMAIL_KEY,
  useCarriedEmail,
} from "../../src/modules/auth/carried-email";
import type { CarriedForm } from "../../src/modules/auth/sign-in-search";
import { TextField } from "../../src/ui";

/**
 * Au1–Au7 (round 22, `design/Auth.dc.html`), through the page both auth
 * routes render — driven the way the log-in route drives it, with only
 * Better Auth's network client replaced.
 */
const client = vi.hoisted(() => ({
  email: vi.fn(),
  social: vi.fn(),
  signUp: vi.fn(),
}));
vi.mock("../../src/modules/auth/client", () => ({
  authClient: {
    signIn: { email: client.email, social: client.social },
    signUp: { email: client.signUp },
  },
}));

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/auth/login"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

/**
 * The log-in route, minus the router plumbing: the same hooks, the same
 * fields, the same page.
 */
function LogIn({
  carried,
  leave,
  onSignedIn,
  returnedError,
}: Readonly<{
  carried?: CarriedForm | undefined;
  leave: (url: string) => void;
  onSignedIn: () => void;
  returnedError?: string | undefined;
}>) {
  const [email, setEmail] = useCarriedEmail(carried);
  const [password, setPassword] = useState("");
  const google = useGoogleSignIn({
    callbackURL: "/closet",
    errorCallbackURL: "/auth/login?redirect=%2Fcloset",
    returnedError,
    leave,
  });
  const { form, cause } = useAuthForm({
    schema: signInSchema,
    action: signIn,
    successMessage: "Signed in.",
    labels: { email: "Email", password: "Password" },
    onSuccess: async () => {
      onSignedIn();
      await Promise.resolve();
    },
  });
  return (
    <AuthPage
      heading="Log in"
      submitLabel="Log in"
      pendingLabel="Logging in"
      form={form}
      cause={cause}
      google={google}
      notice={<SessionNotice carried={carried} />}
      crossLink={<LoginCrossLink carried={carried} />}
      legal={<AuthLegal />}
      onSubmit={() => {
        void form.submit({ email, password });
      }}
    >
      <TextField
        name="email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        field={form.field}
        error={form.fieldErrors.email}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
        field={form.field}
        error={form.fieldErrors.password}
        focusOnArrival={carried !== undefined}
      />
    </AuthPage>
  );
}

/**
Not a secret: a fixture typed into a form that never leaves this process.
*/
const PASSPHRASE = ["a", "long", "passphrase"].join("-");

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

async function logIn(overrides: Partial<Parameters<typeof LogIn>[0]> = {}) {
  const leave = vi.fn();
  const onSignedIn = vi.fn();
  await renderWithRouter(
    <LogIn leave={leave} onSignedIn={onSignedIn} {...overrides} />,
  );
  return { leave, onSignedIn, user: userEvent.setup() };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "dana.k@hey.com");
  await user.type(screen.getByLabelText("Password"), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: "Log in" }));
}

beforeEach(() => {
  client.email.mockReset();
  client.social.mockReset();
});

describe("Au2 · at rest", () => {
  it("is the board's regions in the board's order, with no tab bar", async () => {
    await logIn();

    const panel = part("panel");
    expect(panel?.tagName).toBe("MAIN");
    expect(
      [...(panel?.querySelectorAll<HTMLElement>("[data-part]") ?? [])].map(
        (element) => element.dataset.part,
      ),
    ).toEqual([
      "header",
      "wordmark",
      "form",
      "or-divider",
      "google",
      "cross-link",
    ]);
    // "A signed-out page never shows the tab bar."
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    // The landing bar with no action — the cross-link does its job.
    expect(document.querySelector("[data-part='bar-actions']")).toBeNull();
    expect(screen.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  it("drops the panel's own wordmark from 720 up, and keeps it plain", async () => {
    await logIn();
    // "The panel drops its own wordmark, so there is one" — the bar's.
    const own = part("panel")?.querySelector("[data-part='wordmark']");
    expect(own).toHaveClass("wide:hidden");
    expect(own).toHaveTextContent(/^dialed\.run$/u);
    expect(
      document.querySelector("[data-part='top-bar'] [data-part='wordmark']"),
    ).not.toBeNull();
  });

  it("says nothing in the status region and marks no state", async () => {
    await logIn();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);
    expect(part("form")).not.toHaveAttribute("data-state");
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("offers Create an account, and never Sign up", async () => {
    await logIn();
    const link = screen.getByRole("link", { name: "Create an account" });
    expect(link).toHaveAttribute("href", "/auth/signup");
    expect(part("cross-link")).toHaveTextContent(
      /^New here\? Create an account$/u,
    );
    expect(screen.queryByText(/sign up/iu)).toBeNull();
  });

  it("submits through the page's handler, never the browser's", async () => {
    const { user } = await logIn();
    client.email.mockResolvedValue({
      data: {},
      error: undefined,
    });
    const form = screen.getByRole("button", { name: "Log in" }).closest("form");
    expect(form).toHaveAttribute("novalidate");

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await fillAndSubmit(user);
    } finally {
      document.removeEventListener("submit", watch);
    }
    expect(prevented).toBe(true);
    expect(client.email).toHaveBeenCalledWith({
      email: "dana.k@hey.com",
      password: PASSPHRASE,
    });
  });

  it("goes where the page says once signed in", async () => {
    const { user, onSignedIn } = await logIn();
    client.email.mockResolvedValue({
      data: {},
      error: undefined,
    });
    await fillAndSubmit(user);
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Signed in.");
  });
});

describe("Au3 · wrong password", () => {
  it("marks Password with the one sentence and opens the status with Auth's words", async () => {
    const { user } = await logIn();
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    await fillAndSubmit(user);

    expect(await screen.findByText(AUTH_COPY.wrongPassword)).toBeVisible();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Only Password: never "email or password" split across two.
    expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-invalid");
    expect(part("form")).toHaveAttribute("data-state", "field-failure");
    expect(screen.getByRole("status")).toHaveTextContent(
      /^Not signed in\. One field needs a fix\.$/u,
    );
    // A field failure is not a band.
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });
});

describe("Au4 · form failure", () => {
  it("is the band above the primary, opening Not signed in, naming a fault", async () => {
    const { user } = await logIn();
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INTERNAL", status: 500 },
    });
    await fillAndSubmit(user);

    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not signed in");
    expect(band).toHaveTextContent(AUTH_COPY.server);
    expect(band).not.toHaveTextContent("Nothing saved");
    // Above the primary, inside the form.
    expect(band?.nextElementSibling).toBe(
      screen.getByRole("button", { name: "Log in" }),
    );
    expect(part("form")).toHaveAttribute("data-state", "form-failure");
    expect(screen.getByRole("status")).toHaveTextContent(
      `Not signed in. ${AUTH_COPY.server}`,
    );
    // No field is marked.
    expect(screen.getByLabelText("Password")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("says a rate limit is one, with no countdown", async () => {
    const { user } = await logIn();
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "TOO_MANY", status: 429 },
    });
    await fillAndSubmit(user);
    expect(await screen.findByText(AUTH_COPY.rateLimited)).toBeVisible();
  });

  it("says the connection dropped when the request never arrived", async () => {
    const { user } = await logIn();
    client.email.mockRejectedValue(new TypeError("Failed to fetch"));
    await fillAndSubmit(user);
    expect(await screen.findByText(AUTH_COPY.network)).toBeVisible();
  });

  it("tries again with what was typed", async () => {
    const { user, onSignedIn } = await logIn();
    client.email
      .mockResolvedValueOnce({
        data: undefined,
        error: { code: "INTERNAL", status: 500 },
      })
      .mockResolvedValueOnce({ data: {}, error: undefined });
    await fillAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledTimes(1);
    });
    expect(client.email).toHaveBeenLastCalledWith({
      email: "dana.k@hey.com",
      password: PASSPHRASE,
    });
  });
});

describe("Au5 · Google in flight", () => {
  it("breathes, stays a live control, and goes to Google with the answer", async () => {
    const { user, leave } = await logIn();
    // At rest the board's ringed "G" leads the label — composed from the
    // type system, hidden from the accessible name.
    const mark = part("google")?.querySelector("[aria-hidden='true']");
    expect(mark).toHaveTextContent(/^G$/u);
    expect(mark).toHaveClass("rounded-pill", "border-ink");
    const answer = Promise.withResolvers<unknown>();
    client.social.mockReturnValue(answer.promise);
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    const google = part("google");
    expect(google).toHaveAttribute("data-state", "pending");
    expect(google).toHaveAttribute("aria-busy", "true");
    expect(google).not.toHaveAttribute("disabled");
    expect(google?.querySelectorAll(".breathe")).toHaveLength(2);
    expect(google).toHaveTextContent("Opening Google");
    expect(client.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/closet",
      errorCallbackURL: "/auth/login?redirect=%2Fcloset",
      disableRedirect: true,
    });

    await act(async () => {
      answer.resolve({
        data: { url: "https://accounts.example/consent" },
        error: undefined,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(leave).toHaveBeenCalledWith("https://accounts.example/consent");
    });
    expect(part("google")).not.toHaveAttribute("data-state");
  });

  it("is cancelled by Log in: the late answer is dropped, not followed", async () => {
    const { user, leave } = await logIn();
    const answer = Promise.withResolvers<unknown>();
    client.social.mockReturnValue(answer.promise);
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await fillAndSubmit(user);

    // At rest at once, not when the abandoned answer eventually lands.
    expect(part("google")).not.toHaveAttribute("data-state");
    expect(part("google")).not.toHaveAttribute("aria-busy");
    expect(part("google")).toHaveTextContent("Continue with Google");

    await act(async () => {
      answer.resolve({
        data: { url: "https://accounts.example/consent" },
        error: undefined,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(part("google")).not.toHaveAttribute("data-state");
    });
    expect(leave).not.toHaveBeenCalled();
  });

  it("says nothing when a cancelled attempt fails after all", async () => {
    const { user } = await logIn();
    const answer = Promise.withResolvers<unknown>();
    client.social.mockReturnValue(answer.promise);
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await fillAndSubmit(user);
    await screen.findByText(AUTH_COPY.wrongPassword);

    await act(async () => {
      answer.resolve({ data: undefined, error: { status: 502 } });
      await Promise.resolve();
    });

    // The runner moved on to Log in; a band for the button they abandoned
    // would sit over the form they are using.
    await waitFor(() => {
      expect(client.social).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(AUTH_COPY.google)).toBeNull();
    expect(part("failure-band")).toBeNull();
  });
});

describe("Au6 · a refusal Google's round trip brought back", () => {
  it("shows the band for any code but the runner's own cancel", async () => {
    await logIn({ returnedError: "invalid_code" });
    const band = part("failure-band");
    expect(band).toHaveTextContent("Not signed in");
    expect(band).toHaveTextContent(AUTH_COPY.google);
    expect(band?.nextElementSibling).toBe(part("google"));
  });

  it("returns to rest, silently, when consent was cancelled", async () => {
    await logIn({ returnedError: "access_denied" });
    expect(part("failure-band")).toBeNull();
    expect(screen.queryByText(AUTH_COPY.google)).toBeNull();
  });

  it("tries Google afresh from that band, and the band goes", async () => {
    const { user, leave } = await logIn({ returnedError: "invalid_code" });
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent" },
      error: undefined,
    });

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(leave).toHaveBeenCalledWith("https://accounts.example/consent");
    });
    expect(client.social).toHaveBeenCalledTimes(1);
    expect(part("failure-band")).toBeNull();
  });
});

describe("Au6 · Google failed", () => {
  it("puts the band above Google, not above Log in, and says so once", async () => {
    const { user, leave } = await logIn();
    client.social.mockResolvedValue({
      data: undefined,
      error: { status: 502 },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not signed in");
    expect(band).toHaveTextContent(AUTH_COPY.google);
    // The band belongs to the button that failed.
    expect(band?.nextElementSibling).toBe(part("google"));
    expect(band?.closest("form")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      `Not signed in. ${AUTH_COPY.google}`,
    );
    expect(leave).not.toHaveBeenCalled();
  });

  it("tries Google again from the band", async () => {
    const { user, leave } = await logIn();
    client.social
      .mockResolvedValueOnce({ data: undefined, error: { status: 502 } })
      .mockResolvedValueOnce({
        data: { url: "https://accounts.example/consent" },
        error: undefined,
      });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await user.click(await screen.findByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(leave).toHaveBeenCalledWith("https://accounts.example/consent");
    });
    expect(part("failure-band")).toBeNull();
  });

  it("lets the form's own band speak first when both failed", async () => {
    const { user } = await logIn();
    client.social.mockResolvedValue({
      data: undefined,
      error: { status: 502 },
    });
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INTERNAL", status: 500 },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await screen.findByText(AUTH_COPY.google);
    await fillAndSubmit(user);

    await screen.findByText(AUTH_COPY.server);
    expect(screen.getByRole("status")).toHaveTextContent(
      `Not signed in. ${AUTH_COPY.server}`,
    );
  });
});

describe("Au7 · signed out arrival", () => {
  beforeEach(() => {
    sessionStorage.setItem(CARRIED_EMAIL_KEY, "dana.k@hey.com");
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it("names the carried form in an ink notice above the heading, with no cross-link", async () => {
    await logIn({ carried: "garment" });

    const notice = part("session-notice");
    expect(notice).toHaveAttribute("data-state", "session-expired");
    // An ink block: a statement, not an error — no band, no yellow.
    expect(notice).toHaveAttribute("data-ground", "ink");
    expect(notice).toHaveTextContent("You were signed out");
    expect(notice).toHaveTextContent(
      "Log in and you're back on your garment. What you entered is kept.",
    );
    expect(notice?.nextElementSibling).toBe(
      screen.getByRole("heading", { name: "Log in" }),
    );
    expect(part("cross-link")).toBeNull();
  });

  it("prefills the email from session storage, never from the URL", async () => {
    await logIn({ carried: "run" });
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveValue("dana.k@hey.com");
    });
  });

  it("prefills nothing from storage that is not an email", async () => {
    sessionStorage.setItem(CARRIED_EMAIL_KEY, "<script>");
    await logIn({ carried: "run" });
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("prefills nothing when storage refuses to be read", async () => {
    // What a browser with site data blocked does: touching the property
    // at all throws.
    const refused = vi
      .spyOn(globalThis, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    await logIn({ carried: "run" });
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });
    expect(screen.getByLabelText("Email")).toHaveValue("");
    refused.mockRestore();
  });

  it("puts focus in Password, the one thing left to type", async () => {
    await logIn({ carried: "run" });
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveFocus();
    });
  });

  it("takes focus once: typing in Email after arrival stays in Email", async () => {
    const { user } = await logIn({ carried: "run" });
    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveValue("dana.k@hey.com");
    });
    const emailField = screen.getByLabelText("Email");

    await user.clear(emailField);
    await user.type(emailField, "dana@hey.com");

    expect(emailField).toHaveFocus();
    expect(emailField).toHaveValue("dana@hey.com");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("is plain Au2 when nothing was carried, and reads no stored email", async () => {
    await logIn();
    expect(part("session-notice")).toBeNull();
    expect(screen.getByLabelText("Password")).not.toHaveFocus();
    expect(part("cross-link")).not.toBeNull();
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });
});

describe("PasswordField", () => {
  it("shows and hides what was typed, from inside the field's box", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <PasswordField
        label="Password"
        autoComplete="new-password"
        value="hunter2hunter2"
        onChange={() => {
          // read-only in this case
        }}
        field={(name) => ({
          name,
          readOnly: false,
          "aria-invalid": undefined,
          "aria-describedby": undefined,
          onInput: () => {
            // nothing to clear
          },
        })}
        hint="At least 10 characters."
      />,
    );
    const input = screen.getByLabelText("Password");
    // Only Au7's arrival takes focus; an ordinary form leaves it alone.
    expect(input).not.toHaveFocus();
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input).toHaveAttribute("name", "password");
    expect(screen.getByText("At least 10 characters.")).toBeVisible();

    const toggle = screen.getByRole("button", { name: "Show" });
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-controls", "password");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("survives being unmounted after focusing on arrival", async () => {
    const { unmount } = await renderWithRouter(
      <PasswordField
        label="Password"
        autoComplete="current-password"
        value=""
        onChange={() => {
          // not typed into
        }}
        field={(name) => ({
          name,
          readOnly: false,
          "aria-invalid": undefined,
          "aria-describedby": undefined,
          onInput: () => {
            // nothing to clear
          },
        })}
        focusOnArrival
      />,
    );
    expect(screen.getByLabelText("Password")).toHaveFocus();
    // React hands a callback ref `null` on the way out.
    expect(() => {
      unmount();
    }).not.toThrow();
  });
});

describe("AuthCrossLink and AuthLegal", () => {
  it("reads as one sentence with an ink link, never pink", async () => {
    await renderWithRouter(
      <AuthCrossLink
        prompt="Have an account?"
        to="/auth/login"
        label="Log in"
      />,
    );
    const link = screen.getByRole("link", { name: "Log in" });
    expect(link).toHaveAttribute("href", "/auth/login");
    expect(link).toHaveClass("text-ink", "font-bold", "underline");
    expect(link).not.toHaveClass("text-cold-text");
    expect(part("cross-link")).toHaveTextContent(/^Have an account\? Log in$/u);
  });

  it("carries Au1's legal line at micro", async () => {
    await renderWithRouter(<AuthLegal />);
    expect(
      screen.getByText(
        "By creating an account you agree to the terms and privacy policy.",
      ),
    ).toHaveClass("text-micro", "text-muted");
  });
});
