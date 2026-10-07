import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  CREDENTIAL_LABELS,
  CredentialFields,
  LoginCrossLink,
  SessionNotice,
  useAuthForm,
} from "../../src/modules/auth/auth-page";
import { PasswordField } from "../../src/modules/auth/password-field";
import { signIn } from "../../src/modules/auth/credentials";
import { useGoogleSignIn } from "../../src/modules/auth/google-button";
import {
  CARRIED_EMAIL_KEY,
  useCarriedEmail,
} from "../../src/modules/auth/carried-email";
import type { CarriedForm } from "../../src/modules/auth/sign-in-search";

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
    labels: CREDENTIAL_LABELS,
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
      <CredentialFields
        form={form}
        email={email}
        onEmail={setEmail}
        password={password}
        onPassword={setPassword}
        passwordAutoComplete="current-password"
        focusPasswordOnArrival={carried !== undefined}
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
      "google-button",
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
    // At rest Google's own full-colour "G" leads the label — the official
    // asset, as Google's branding guidelines require (PR #104) — and it is
    // decoration: the words are the button's name.
    const mark = part("google-button")?.querySelector("img");
    expect(mark).toHaveAttribute("src", "/brand/google-g.png");
    expect(mark).toHaveAttribute("alt", "");
    expect(mark).toHaveAttribute("width", "20");
    expect(mark).toHaveAttribute("height", "20");
    expect(mark).toHaveClass("size-5");
    // Round 26 #13: Google's light spec in our pill, 48 high, and the dark
    // set keyed on the theme — its colours, not T1's.
    expect(part("google-button")).toHaveClass(
      "target",
      "h-12",
      "w-full",
      "rounded-pill",
      "border",
      "font-semibold",
      "border-[#747775]",
      "bg-[#FFFFFF]",
      "text-[#1F1F1F]",
      "in-data-[theme=dark]:border-[#8E918F]",
      "in-data-[theme=dark]:bg-[#131314]",
      "in-data-[theme=dark]:text-[#E3E3E3]",
    );
    const answer = Promise.withResolvers<unknown>();
    client.social.mockReturnValue(answer.promise);
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    const google = part("google-button");
    expect(google).toHaveAttribute("data-state", "pending");
    expect(google).toHaveAttribute("aria-busy", "true");
    expect(google).not.toHaveAttribute("disabled");
    expect(google?.querySelectorAll(".breathe")).toHaveLength(2);
    expect(google).toHaveTextContent("Opening Google");
    expect(client.social).toHaveBeenCalledWith(
      {
        provider: "google",
        callbackURL: "/closet",
        errorCallbackURL: "/auth/login?redirect=%2Fcloset",
        disableRedirect: true,
      },
      {},
    );

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
    expect(part("google-button")).not.toHaveAttribute("data-state");
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
    expect(part("google-button")).not.toHaveAttribute("data-state");
    expect(part("google-button")).not.toHaveAttribute("aria-busy");
    expect(part("google-button")).toHaveTextContent("Continue with Google");

    await act(async () => {
      answer.resolve({
        data: { url: "https://accounts.example/consent" },
        error: undefined,
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(part("google-button")).not.toHaveAttribute("data-state");
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
    expect(part("control-failure")).toBeNull();
  });
});

describe("Au6 · a refusal Google's round trip brought back", () => {
  it("shows the band for any code but the runner's own cancel", async () => {
    await logIn({ returnedError: "invalid_code" });
    const band = part("control-failure");
    expect(band).toHaveTextContent("Not signed in");
    expect(band).toHaveTextContent(AUTH_COPY.google);
    // Under the button, as every band Google owns is (round 29 #13).
    expect(band?.previousElementSibling).toBe(part("google-button"));
  });

  it("returns to rest, silently, when consent was cancelled", async () => {
    await logIn({ returnedError: "access_denied" });
    expect(part("control-failure")).toBeNull();
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
    expect(part("control-failure")).toBeNull();
  });
});

describe("Au6 · Google failed", () => {
  it("puts the band under Google, not above Log in, and says so once", async () => {
    const { user, leave } = await logIn();
    client.social.mockResolvedValue({
      data: undefined,
      error: { status: 502 },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );

    const band = await waitFor(() => {
      const found = part("control-failure");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not signed in");
    expect(band).toHaveTextContent(AUTH_COPY.google);
    // Au6 as round 33 draws it: a control failure, not the form's band
    // (R-128), with Try again as its one filled thing.
    expect(band).toHaveAttribute("data-state", "google-failed");
    expect(part("failure-band")).toBeNull();
    expect(
      within(band ?? document.body).getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    // The band belongs to the button that failed, directly under it
    // (round 29 #13), and nothing of Google's sits above the button.
    expect(band?.previousElementSibling).toBe(part("google-button"));
    expect(part("google-button")?.previousElementSibling).not.toHaveAttribute(
      "data-part",
      "control-failure",
    );
    expect(band?.closest("form")).toBeNull();
    // One status region on the screen (Accessibility Contract rule 08):
    // the band is not a second one, and the page's region speaks for it.
    expect(screen.getAllByRole("status")).toHaveLength(1);
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
    expect(part("control-failure")).toBeNull();
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

  it("reads the key the session-expiry carry writes", () => {
    // The wire name between this reader and its writer (the carry in
    // `ui/use-form-submit`, and the e2e specs): changing it on one side
    // alone silently loses every prefilled email.
    expect(CARRIED_EMAIL_KEY).toBe("dialed.carried-email");
  });

  it("prefills when a form is carried after the page has mounted", async () => {
    const leave = vi.fn();
    const onSignedIn = vi.fn();
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const page = createRoute({
      getParentRoute: () => rootRoute,
      path: "/auth/login",
      validateSearch: (search: Record<string, unknown>) => ({
        carried: search.carried === "run" ? ("run" as const) : undefined,
      }),
      component: function Page() {
        const { carried } = page.useSearch();
        return (
          <LogIn carried={carried} leave={leave} onSignedIn={onSignedIn} />
        );
      },
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([page]),
      history: createMemoryHistory({ initialEntries: ["/auth/login"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByLabelText("Email");
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Password")).not.toHaveFocus();

    await act(async () => {
      await router.navigate({ to: "/auth/login", search: { carried: "run" } });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Email")).toHaveValue("dana.k@hey.com");
    });
    expect(screen.getByLabelText("Password")).toHaveFocus();
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

/**
A bare PasswordField, arriving or not.
*/
function ArrivingPassword({ isArrival }: Readonly<{ isArrival: boolean }>) {
  return (
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
      focusOnArrival={isArrival}
    />
  );
}

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

  it("is a text field's height: the toggle's 44px target cancels the box's padding rather than growing it", () => {
    // happy-dom lays nothing out, so this pins the class contract that
    // makes the heights equal; the auth demo measures them in a browser.
    // The box is 50 (`min-h-field`) only while nothing inside it is taller
    // than its content area, and `target` is 44 — so the toggle's margins
    // must cancel exactly the box's padding.
    render(<ArrivingPassword isArrival={false} />);
    const toggle = screen.getByRole("button", { name: "Show" });
    const box = toggle.parentElement;
    expect(box).toHaveClass("field-box", "min-h-field", "py-3");
    expect(toggle).toHaveClass("target", "-my-3", "self-stretch");
  });

  it("focuses when arrival is decided after it has mounted", () => {
    const { rerender } = render(<ArrivingPassword isArrival={false} />);
    expect(screen.getByLabelText("Password")).not.toHaveFocus();

    rerender(<ArrivingPassword isArrival />);

    expect(screen.getByLabelText("Password")).toHaveFocus();
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
  it("carries a deep link's way back across to the other form", async () => {
    await renderWithRouter(
      <LoginCrossLink carried={undefined} redirect="/feed/entry/01ENTRY" />,
    );
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute(
      "href",
      "/auth/signup?redirect=%2Ffeed%2Fentry%2F01ENTRY",
    );
  });

  it("carries the way back from sign-up to log-in too", async () => {
    await renderWithRouter(
      <AuthCrossLink
        prompt="Have an account?"
        to="/auth/login"
        label="Log in"
        redirect="/@ravi_k"
      />,
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login?redirect=%2F%40ravi_k",
    );
  });

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

  it("carries Au2's terms and age lines at micro (round 27 #12; D-52, D-71)", async () => {
    await renderWithRouter(<AuthLegal />);
    const legal = screen.getByText(
      "dialed.run is for runners 16 and over.",
    ).parentElement;
    expect(legal).toHaveClass("text-micro", "text-muted");
    expect(legal).toHaveTextContent(
      /^By creating an account you agree to the Terms and have read the Privacy policy\.dialed\.run is for runners 16 and over\.$/u,
    );
    const terms = screen.getByRole("link", { name: "Terms" });
    expect(terms).toHaveAttribute("href", "/terms");
    expect(terms).toHaveClass("text-ink", "underline", "underline-offset-4");
    const policy = screen.getByRole("link", { name: "Privacy policy" });
    expect(policy).toHaveAttribute("href", "/privacy");
    expect(policy).toHaveClass("text-ink", "underline", "underline-offset-4");
  });
});

describe("CredentialFields (round 26 #7, #18)", () => {
  const form = {
    field: (name: string) => ({
      name,
      readOnly: false,
      "aria-invalid": undefined,
      "aria-describedby": undefined,
      onInput: () => {
        // nothing to clear
      },
    }),
    fieldErrors: { email: "Enter your email address." },
  };

  it("is email then password, wired for sign-up's hint and autocomplete", () => {
    render(
      <CredentialFields
        form={form}
        email="dana.k@hey.com"
        onEmail={vi.fn()}
        password=""
        onPassword={vi.fn()}
        passwordAutoComplete="new-password"
        passwordHint="At least 10 characters."
      />,
    );
    const email = screen.getByLabelText(CREDENTIAL_LABELS.email);
    expect(CREDENTIAL_LABELS).toStrictEqual({
      email: "Email",
      password: "Password",
    });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveValue("dana.k@hey.com");
    expect(screen.getByText("Enter your email address.")).toBeVisible();
    const password = screen.getByLabelText(CREDENTIAL_LABELS.password);
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).not.toHaveFocus();
    expect(screen.getByText("At least 10 characters.")).toBeVisible();
    expect(email.compareDocumentPosition(password)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("carries log-in's autocomplete, no hint, and Au7's focus", () => {
    render(
      <CredentialFields
        form={{ ...form, fieldErrors: {} }}
        email=""
        onEmail={vi.fn()}
        password=""
        onPassword={vi.fn()}
        passwordAutoComplete="current-password"
        focusPasswordOnArrival
      />,
    );
    const password = screen.getByLabelText(CREDENTIAL_LABELS.password);
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveFocus();
    expect(screen.queryByText(/characters/u)).toBeNull();
  });
});
