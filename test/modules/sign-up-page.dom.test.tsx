import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { INVITE_COPY, TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import { signUpSchema } from "../../src/lib/contracts";
import { AUTH_COPY } from "../../src/modules/auth/auth-copy";
import {
  AuthPage,
  BirthDateField,
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
  const [birthDate, setBirthDate] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const google = useGoogleSignIn({
    callbackURL: "/",
    errorCallbackURL: "/auth/signup",
    returnedError,
    leave,
    admission: () => ({ inviteCode, birthDate, turnstileToken: TOKEN }),
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
        void form.submit({ inviteCode, birthDate, email, password });
      }}
    >
      <InviteCodeField
        form={form}
        value={inviteCode}
        onChange={setInviteCode}
        isInviteOnly={isInviteOnly}
      />
      <BirthDateField form={form} value={birthDate} onChange={setBirthDate} />
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

const BIRTH_DATE = "1990-04-21";

/**
 * The date control is the platform's, which takes no typing in happy-dom;
 * a change event with the value it would produce stands in for the picker.
 */
function pickBirthDate(date: string): void {
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: date },
  });
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
  birthDate = BIRTH_DATE,
): Promise<void> {
  if (code !== "") await user.type(screen.getByLabelText("Invite code"), code);
  if (birthDate !== "") pickBirthDate(birthDate);
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
    expect(
      screen.getByText("dialed.run is invite-only for now."),
    ).toBeVisible();
    const fields = [...document.querySelectorAll("input")].map(
      (input) => input.name,
    );
    expect(fields.slice(0, 4)).toStrictEqual([
      "inviteCode",
      "birthDate",
      "email",
      "password",
    ]);
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
          "x-birth-date": BIRTH_DATE,
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
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => {
      expect(leave).toHaveBeenCalledWith("https://accounts.example/consent");
    });
    expect(client.social).toHaveBeenCalledWith(
      expect.objectContaining({ requestSignUp: true }),
      {
        headers: {
          "x-invite-code": "DIAL-7K3P",
          "x-birth-date": "",
          "x-turnstile-token": TOKEN,
        },
      },
    );
  });

  it("says a refused code in Google's band under it, with Request access and no retry, and Au6's words again for a later fault (round 28 #9)", async () => {
    client.social.mockResolvedValueOnce({
      data: undefined,
      error: { code: "INVITE_INVALID", status: 400 },
    });
    const { user, leave } = await signUpPage();
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    const band = await waitFor(() => {
      const found = part("control-failure");
      expect(found).toHaveTextContent(INVITE_COPY.invalid);
      return found;
    });
    expect(band).toHaveTextContent("Not created");
    expect(band).toHaveAttribute("data-state", "refused");
    expect(band?.previousElementSibling).toBe(part("google-button"));
    const requestAccess = within(band ?? document.body).getByRole("link", {
      name: "Request access",
    });
    expect(requestAccess).toHaveAttribute("href", "/account/request-access");
    expect(requestAccess).toHaveClass("target");
    // Pressing again cannot fix a refused code, so there is no Try again.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(leave).not.toHaveBeenCalled();

    client.social.mockResolvedValueOnce({
      data: undefined,
      error: { status: 503 },
    });
    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: "Continue with Google" }),
      );
    });
    await waitFor(() => {
      expect(part("control-failure")).toHaveTextContent(AUTH_COPY.google);
    });
    expect(part("control-failure")).not.toHaveTextContent(INVITE_COPY.invalid);
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  });

  it("tells a Google address with no account where accounts are made, as NOT LOGGED IN (round 28 #9)", async () => {
    await signUpPage({ returnedError: "signup_disabled" });
    const band = part("control-failure");
    expect(band).toHaveTextContent("Not logged in");
    expect(band).toHaveTextContent(AUTH_COPY.googleNoAccount);
    expect(
      within(band ?? document.body).getByRole("link", {
        name: "Create an account",
      }),
    ).toHaveAttribute("href", "/auth/signup");
    expect(AUTH_COPY.googleNoAccount).toBe(
      "No account uses that Google address. Create one first.",
    );
  });

  it.each([
    ["INVITE_MISSING", AUTH_COPY.googleNoCode, false],
    ["INVITE_INVALID", INVITE_COPY.invalid, true],
  ])(
    "says a new Google account's %s from the round trip as round 28 #9 draws it",
    async (error, message, linksRequestAccess) => {
      await signUpPage({ returnedError: error });
      const band = part("control-failure");
      expect(band).toHaveTextContent(`Not created${message}`);
      expect(within(band ?? document.body).queryByRole("link") !== null).toBe(
        linksRequestAccess,
      );
      expect(AUTH_COPY.googleNoCode).toBe(
        "Enter your invite code above, then continue with Google.",
      );
    },
  );
});

describe("Au2 · date of birth (design 134)", () => {
  it("asks with the platform's date control, invite-only or not", async () => {
    await signUpPage({ isInviteOnly: false });
    const field = screen.getByLabelText("Date of birth");
    expect(field).toHaveAttribute("type", "date");
    expect(field).toHaveAttribute("autocomplete", "bday");
  });

  it("says a missing date on the field, before any round trip", async () => {
    const { user } = await signUpPage();
    await fill(user, "DIAL-7K3P", "");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Enter your date of birth.")).toBeVisible();
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(client.signUp).not.toHaveBeenCalled();
  });

  it("puts the server's age refusal in the band as NOT CREATED", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "AGE_REFUSED", status: 403 },
    });
    const { user } = await signUpPage();
    await fill(user, "DIAL-7K3P");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not created");
    expect(band).toHaveTextContent("dialed.run is for runners 18 and over.");
    expect(band).not.toHaveTextContent("Not signed in");
    // Round 35 #56c: a retry is refused for a day, so the band offers
    // nothing to press.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("carries the date with Google", async () => {
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent" },
      error: undefined,
    });
    const { user, leave } = await signUpPage();
    pickBirthDate(BIRTH_DATE);
    await user.click(
      screen.getByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => {
      expect(leave).toHaveBeenCalled();
    });
    expect(client.social).toHaveBeenCalledWith(expect.anything(), {
      headers: {
        "x-invite-code": "",
        "x-birth-date": BIRTH_DATE,
        "x-turnstile-token": TOKEN,
      },
    });
  });

  it("says a new Google account's missing date from the round trip, above Google", async () => {
    await signUpPage({ returnedError: "AGE_MISSING" });
    const band = part("control-failure");
    expect(band).toHaveTextContent(
      "Not createdEnter your date of birth above, then continue with Google.",
    );
    expect(within(band ?? document.body).queryByRole("link")).toBeNull();
  });
});
