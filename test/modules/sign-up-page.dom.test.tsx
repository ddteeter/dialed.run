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
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INVITE_COPY, TURNSTILE_REFUSED } from "../../src/lib/access";
import { signUpSchema } from "../../src/lib/contracts";
import { AUTH_COPY } from "../../src/modules/auth/auth-copy";
import {
  AuthPage,
  CredentialFields,
  InviteCodeField,
  RequestAccessLink,
  SIGN_UP_LABELS,
  useAuthForm,
} from "../../src/modules/auth/auth-page";
import { signUp } from "../../src/modules/auth/credentials";
import { useGoogleSignIn } from "../../src/modules/auth/google-button";

/**
 * Au2 in the invite stage (task 126, ACC-5; round 26 #20, round 27 #12),
 * driven the way the sign-up route drives it, with only Better Auth's
 * network client replaced and the Turnstile widget standing in as a slot
 * that has already answered.
 */
const client = vi.hoisted(() => ({ social: vi.fn(), signUp: vi.fn() }));
vi.mock("../../src/modules/auth/client", () => ({
  authClient: {
    signIn: { social: client.social },
    signUp: { email: client.signUp },
  },
}));

const TOKEN = "turnstile-answer";

function SignUp({
  leave,
  onSignedUp,
  returnedError,
  isInviteOnly = true,
}: Readonly<{
  leave: (url: string) => void;
  onSignedUp: () => void;
  returnedError?: string | undefined;
  isInviteOnly?: boolean;
}>) {
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const google = useGoogleSignIn({
    callbackURL: "/",
    errorCallbackURL: "/auth/signup",
    returnedError,
    leave,
    admission: () => ({ inviteCode, turnstileToken: TOKEN }),
  });
  const { form, cause } = useAuthForm({
    schema: signUpSchema,
    action: (values) => signUp(values, TOKEN),
    successMessage: "Check your email.",
    labels: SIGN_UP_LABELS,
    onSuccess: async () => {
      onSignedUp();
      await Promise.resolve();
    },
  });
  return (
    <AuthPage
      heading="Create account"
      submitLabel="Create account"
      pendingLabel="Creating account"
      form={form}
      cause={cause}
      google={google}
      turnstile={<span data-part="turnstile-slot" />}
      requestLink={<RequestAccessLink isInviteOnly={isInviteOnly} />}
      onSubmit={() => {
        void form.submit({ inviteCode, email, password });
      }}
    >
      <InviteCodeField
        form={form}
        value={inviteCode}
        onChange={setInviteCode}
        isInviteOnly={isInviteOnly}
      />
      <CredentialFields
        form={form}
        email={email}
        onEmail={setEmail}
        password={password}
        onPassword={setPassword}
        passwordAutoComplete="new-password"
      />
    </AuthPage>
  );
}

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/auth/signup"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

async function signUpPage(
  overrides: Partial<Parameters<typeof SignUp>[0]> = {},
) {
  const leave = vi.fn();
  const onSignedUp = vi.fn();
  await renderWithRouter(
    <SignUp leave={leave} onSignedUp={onSignedUp} {...overrides} />,
  );
  return { leave, onSignedUp, user: userEvent.setup() };
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

const PASSPHRASE = ["a", "long", "passphrase"].join("-");

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
): Promise<void> {
  if (code !== "") await user.type(screen.getByLabelText("Invite code"), code);
  await user.type(screen.getByLabelText("Email"), "maya@example.com");
  await user.type(screen.getByLabelText("Password"), PASSPHRASE);
}

beforeEach(() => {
  client.social.mockReset();
  client.signUp.mockReset();
});

describe("Au2 · invite stage at rest", () => {
  it("asks for the code first, says why, and offers Au5 under Google", async () => {
    await signUpPage();
    expect(screen.getByText("dialed.run is invite-only for now.")).toBeVisible();
    const fields = [...document.querySelectorAll("input")].map(
      (input) => input.name,
    );
    expect(fields.slice(0, 3)).toStrictEqual(["inviteCode", "email", "password"]);
    const link = screen.getByRole("link", { name: "Request access" });
    expect(link).toHaveAttribute("href", "/account/request-access");
    expect(part("request-access")).toHaveTextContent("No code? Request access");
    expect(part("google-button")?.nextElementSibling).toBe(
      part("request-access"),
    );
  });

  it("puts Turnstile directly above the primary (round 27 #12)", async () => {
    await signUpPage();
    expect(part("turnstile-slot")?.nextElementSibling).toBe(
      screen.getByRole("button", { name: "Create account" }),
    );
  });

  it("drops the field, its line and the link when invite-only is off", async () => {
    await signUpPage({ isInviteOnly: false });
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    expect(screen.queryByText("dialed.run is invite-only for now.")).toBeNull();
    expect(part("request-access")).toBeNull();
  });
});

describe("Au2 · submitting with a code", () => {
  it("sends the code and the Turnstile answer beside the account", async () => {
    client.signUp.mockResolvedValue({ data: {}, error: undefined });
    const { user, onSignedUp } = await signUpPage();
    await fill(user, "dial-7k3p");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => {
      expect(onSignedUp).toHaveBeenCalledTimes(1);
    });
    expect(client.signUp).toHaveBeenCalledWith(
      { email: "maya@example.com", password: PASSPHRASE, name: "" },
      {
        headers: {
          "x-invite-code": "DIAL-7K3P",
          "x-turnstile-token": TOKEN,
        },
      },
    );
  });

  it("says a missing code on the field, before any round trip", async () => {
    const { user } = await signUpPage();
    await fill(user, "");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(INVITE_COPY.missing)).toBeVisible();
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it("lands a refused code on the code field, in the board's words", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "INVITE_INVALID", status: 400 },
    });
    const { user } = await signUpPage();
    await fill(user, "DIAL-7K3P");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(INVITE_COPY.invalid)).toBeVisible();
    expect(screen.getByLabelText("Invite code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(part("failure-band")).toBeNull();
  });

  it("puts a Turnstile refusal in the band as NOT SENT", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "TURNSTILE_REFUSED", status: 403 },
    });
    const { user } = await signUpPage();
    await fill(user, "DIAL-7K3P");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not sent");
    expect(band).toHaveTextContent(TURNSTILE_REFUSED);
    expect(band).not.toHaveTextContent("Not signed in");
    expect(screen.getByRole("status")).toHaveTextContent(
      `Not sent. ${TURNSTILE_REFUSED}`,
    );
  });
});

describe("Au2 · Google in the invite stage", () => {
  it("asks to sign up with the code and the Turnstile answer", async () => {
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent" },
      error: undefined,
    });
    const { user, leave } = await signUpPage();
    await user.type(screen.getByLabelText("Invite code"), "DIAL-7K3P");
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => {
      expect(leave).toHaveBeenCalledWith("https://accounts.example/consent");
    });
    expect(client.social).toHaveBeenCalledWith(
      expect.objectContaining({ requestSignUp: true }),
      {
        headers: { "x-invite-code": "DIAL-7K3P", "x-turnstile-token": TOKEN },
      },
    );
  });

  it("says a refused code in Google's band, and Au6's words again for a later fault", async () => {
    client.social.mockResolvedValueOnce({
      data: undefined,
      error: { code: "INVITE_INVALID", status: 400 },
    });
    const { user, leave } = await signUpPage();
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).toHaveTextContent(INVITE_COPY.invalid);
      return found;
    });
    expect(band).toHaveTextContent("Not signed in");
    expect(band?.nextElementSibling).toBe(part("google-button"));
    expect(leave).not.toHaveBeenCalled();

    client.social.mockResolvedValueOnce({
      data: undefined,
      error: { status: 503 },
    });
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Try again" }));
    });
    await waitFor(() => {
      expect(part("failure-band")).toHaveTextContent(AUTH_COPY.google);
    });
    expect(part("failure-band")).not.toHaveTextContent(INVITE_COPY.invalid);
  });

  it("tells a Google address with no account where accounts are made", async () => {
    await signUpPage({ returnedError: "signup_disabled" });
    expect(part("failure-band")).toHaveTextContent(AUTH_COPY.googleNoAccount);
    expect(AUTH_COPY.googleNoAccount).toBe(
      "No account uses that Google address. Create one first.",
    );
  });

  it.each([
    ["INVITE_MISSING", INVITE_COPY.missing],
    ["INVITE_INVALID", INVITE_COPY.invalid],
  ])(
    "says a new Google account's %s from the round trip in the code field's words",
    async (error, message) => {
      await signUpPage({ returnedError: error });
      expect(part("failure-band")).toHaveTextContent(message);
    },
  );
});
