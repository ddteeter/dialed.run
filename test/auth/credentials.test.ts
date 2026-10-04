import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetSession,
  isRememberedForSession,
  rememberForSession,
} from "../../src/lib/browser/session-memo";
import { INVITE_COPY, TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import {
  AUTH_COPY,
  AccessRefused,
  AuthRejected,
} from "../../src/modules/auth/auth-copy";
import {
  AuthFieldError,
  changePassword,
  googleConsentUrl,
  requestPasswordReset,
  resetPassword,
  ResetLinkExpired,
  signIn,
  signOut,
  signOutEverywhere,
  signUp,
} from "../../src/modules/auth/credentials";

/**
 * Better Auth's answers, translated into the two failures the Auth board
 * draws: a field (Au3) or the band (Au4). The network client is the one
 * thing replaced.
 */
const client = vi.hoisted(() => ({
  email: vi.fn(),
  social: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  changePassword: vi.fn(),
  revokeSessions: vi.fn(),
}));
vi.mock("../../src/modules/auth/client", () => ({
  authClient: {
    signIn: { email: client.email, social: client.social },
    signUp: { email: client.signUp },
    signOut: client.signOut,
    requestPasswordReset: client.requestPasswordReset,
    resetPassword: client.resetPassword,
    changePassword: client.changePassword,
    revokeSessions: client.revokeSessions,
  },
}));

/**
What a promise rejected with, or nothing if it resolved.
*/
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

beforeEach(() => {
  client.email.mockReset();
  client.social.mockReset();
  client.signUp.mockReset();
  client.signOut.mockReset();
  client.requestPasswordReset.mockReset();
  client.resetPassword.mockReset();
  client.changePassword.mockReset();
  client.revokeSessions.mockReset();
  forgetSession();
});

/**
Not a secret: a fixture handed to a mocked client.
*/
const person = {
  email: "dana.k@hey.com",
  password: ["a", "long", "passphrase"].join("-"),
};

describe("signIn", () => {
  it("resolves when Better Auth answers without an error", async () => {
    client.email.mockResolvedValue({ data: {}, error: undefined });
    await expect(signIn(person)).resolves.toBeUndefined();
    expect(client.email).toHaveBeenCalledWith(person);
  });

  it("forgets what the browser remembered about the last runner, once it has signed someone in", async () => {
    rememberForSession("u1", "has-handle");
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    await caught(signIn(person));
    // Nobody new is signed in, so nothing is forgotten.
    expect(isRememberedForSession("has-handle")).toBe(true);
    client.email.mockResolvedValue({ data: {}, error: undefined });
    await signIn(person);
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("lands a wrong password on Password, in the board's one sentence", async () => {
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 },
    });
    const thrown = await caught(signIn(person));
    expect(thrown).toBeInstanceOf(AuthFieldError);
    expect(thrown).toMatchObject({
      name: "AuthFieldError",
      message: AUTH_COPY.wrongPassword,
      issues: [{ path: ["password"], message: AUTH_COPY.wrongPassword }],
    });
  });

  it("keeps any other refusal's status for the band", async () => {
    client.email.mockResolvedValue({
      data: undefined,
      error: { code: "TOO_MANY_REQUESTS", status: 429 },
    });
    const thrown = await caught(signIn(person));
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(thrown).toMatchObject({ status: 429, name: "AuthRejected" });
    expect(thrown).not.toHaveProperty("issues");
  });

  it("sends a refusal with no code to the band", async () => {
    client.email.mockResolvedValue({
      data: undefined,
      error: { status: 500 },
    });
    const thrown = await caught(signIn(person));
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(thrown).toMatchObject({ status: 500 });
  });
});

describe("signUp", () => {
  const account = person;
  const TOKEN = "turnstile-token";

  it("resolves when the account is made, sending Better Auth an empty name", async () => {
    // Sign-up asks email and password only (round 26 #7); Better Auth's
    // endpoint requires a `name`, which nothing reads.
    client.signUp.mockResolvedValue({ data: {}, error: undefined });
    await expect(
      signUp({ ...account, inviteCode: "DIAL-7K3P" }, TOKEN),
    ).resolves.toBeUndefined();
    expect(client.signUp).toHaveBeenCalledWith(
      { ...person, name: "" },
      {
        headers: {
          "x-invite-code": "DIAL-7K3P",
          "x-turnstile-token": TOKEN,
        },
      },
    );
  });

  it("sends empty headers rather than none when there is no code or token", async () => {
    client.signUp.mockResolvedValue({ data: {}, error: undefined });
    await signUp(account, undefined);
    expect(client.signUp).toHaveBeenCalledWith(
      { ...person, name: "" },
      { headers: { "x-invite-code": "", "x-turnstile-token": "" } },
    );
  });

  it.each([
    ["INVITE_MISSING", INVITE_COPY.missing],
    ["INVITE_INVALID", INVITE_COPY.invalid],
  ])(
    "lands %s on the invite code, in the board's words",
    async (code, message) => {
      client.signUp.mockResolvedValue({
        data: undefined,
        error: { code, status: 400 },
      });
      expect(await caught(signUp(account, TOKEN))).toMatchObject({
        issues: [{ path: ["inviteCode"], message }],
      });
    },
  );

  it("puts a Turnstile refusal in the band as NOT SENT (round 27 #12)", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "TURNSTILE_REFUSED", status: 403 },
    });
    const thrown = await caught(signUp(account, TOKEN));
    expect(thrown).toBeInstanceOf(AccessRefused);
    expect(thrown).toMatchObject({
      kicker: "Not sent",
      message: TURNSTILE_REFUSED,
    });
  });

  it("no longer lands a taken email on Email — Au3's exception is retired (round 26 #11)", async () => {
    // Better Auth no longer says "taken" at all (sign-up signs nobody in),
    // and should it ever, it is a fault for the band, not a field fix.
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
    });
    const thrown = await caught(signUp(account, TOKEN));
    expect(thrown).toBeInstanceOf(AuthRejected);
  });

  it("lands a breached password on Password (NIST SP 800-63B §3.1.1.2)", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "PASSWORD_BREACHED", status: 400 },
    });
    const thrown = await caught(signUp(account, TOKEN));
    expect(thrown).toMatchObject({
      issues: [{ path: ["password"], message: AUTH_COPY.passwordBreached }],
    });
  });

  it("does not read a wrong-password code as a taken email", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 500 },
    });
    const thrown = await caught(signUp(account, TOKEN));
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(thrown).toMatchObject({ status: 500 });
  });
});

describe("requestPasswordReset (ACC-4)", () => {
  it("asks Better Auth for the link, and fails only on a fault", async () => {
    client.requestPasswordReset.mockResolvedValue({
      data: {},
      error: undefined,
    });
    await expect(
      requestPasswordReset({ email: person.email }),
    ).resolves.toBeUndefined();
    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: person.email,
    });

    client.requestPasswordReset.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 429 },
    });
    const thrown = await caught(requestPasswordReset({ email: person.email }));
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(thrown).toMatchObject({ status: 429 });
  });
});

describe("resetPassword (ACC-4)", () => {
  it("sets the new password with the link's token", async () => {
    client.resetPassword.mockResolvedValue({ data: {}, error: undefined });
    await expect(
      resetPassword("tok", { password: person.password }),
    ).resolves.toBeUndefined();
    expect(client.resetPassword).toHaveBeenCalledWith({
      newPassword: person.password,
      token: "tok",
    });
  });

  it("says the link has run out when the token is spent or unknown", async () => {
    client.resetPassword.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_TOKEN", status: 400 },
    });
    const thrown = await caught(resetPassword("tok", { password: "x" }));
    expect(thrown).toBeInstanceOf(ResetLinkExpired);
    expect(thrown).toMatchObject({
      name: "ResetLinkExpired",
      message: "reset link expired",
    });
  });

  it("lands a breached password on Password, and anything else on the band", async () => {
    client.resetPassword.mockResolvedValue({
      data: undefined,
      error: { code: "PASSWORD_BREACHED", status: 400 },
    });
    expect(await caught(resetPassword("t", { password: "x" }))).toMatchObject({
      issues: [{ path: ["password"], message: AUTH_COPY.passwordBreached }],
    });
    client.resetPassword.mockResolvedValue({
      data: undefined,
      error: { code: "OTHER", status: 500 },
    });
    expect(await caught(resetPassword("t", { password: "x" }))).toBeInstanceOf(
      AuthRejected,
    );
  });
});

describe("changePassword (ACC-7)", () => {
  // Not secrets: fixtures handed to a mocked client.
  const OLD = ["old", "pass", "phrase"].join("-");
  const NEW = ["new", "pass", "phrase"].join("-");
  const values = { currentPassword: OLD, password: NEW };

  it("changes it and signs every other session out", async () => {
    client.changePassword.mockResolvedValue({ data: {}, error: undefined });
    await expect(changePassword(values)).resolves.toBeUndefined();
    expect(client.changePassword).toHaveBeenCalledWith({
      currentPassword: OLD,
      newPassword: NEW,
      revokeOtherSessions: true,
    });
  });

  it("lands a wrong current password on its own field, and a breached new one on the other", async () => {
    client.changePassword.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_PASSWORD", status: 400 },
    });
    expect(await caught(changePassword(values))).toMatchObject({
      issues: [
        { path: ["currentPassword"], message: AUTH_COPY.currentPasswordWrong },
      ],
    });
    client.changePassword.mockResolvedValue({
      data: undefined,
      error: { code: "PASSWORD_BREACHED", status: 400 },
    });
    expect(await caught(changePassword(values))).toMatchObject({
      issues: [{ path: ["password"], message: AUTH_COPY.passwordBreached }],
    });
    expect(AUTH_COPY.currentPasswordWrong).toBe(
      "That's not your current password.",
    );
  });
});

describe("signOutEverywhere (ACC-7)", () => {
  it("ends every session and forgets what the browser kept about this one", async () => {
    rememberForSession("u1", "has-handle");
    client.revokeSessions.mockResolvedValue({ data: {}, error: undefined });
    await expect(signOutEverywhere()).resolves.toBeUndefined();
    expect(client.revokeSessions).toHaveBeenCalledTimes(1);
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("says still signed in when Better Auth refuses", async () => {
    rememberForSession("u1", "has-handle");
    client.revokeSessions.mockResolvedValue({
      data: undefined,
      error: { status: 500 },
    });
    const thrown = await caught(signOutEverywhere());
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(isRememberedForSession("has-handle")).toBe(true);
  });
});

describe("googleConsentUrl", () => {
  it("asks for the consent URL without leaving, and returns to the form if refused", async () => {
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent", redirect: false },
      error: undefined,
    });
    await expect(googleConsentUrl("/closet", "/auth/signup")).resolves.toBe(
      "https://accounts.example/consent",
    );
    expect(client.social).toHaveBeenCalledWith(
      {
        provider: "google",
        callbackURL: "/closet",
        // Back to the page it left from — sign-up stays sign-up.
        errorCallbackURL: "/auth/signup",
        disableRedirect: true,
      },
      {},
    );
  });

  it("asks to sign up, carrying the code and token, only when admitted (Au2)", async () => {
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent", redirect: false },
      error: undefined,
    });
    await googleConsentUrl("/", "/auth/signup", {
      inviteCode: "DIAL-7K3P",
      turnstileToken: "t",
    });
    expect(client.social).toHaveBeenCalledWith(
      {
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/signup",
        disableRedirect: true,
        requestSignUp: true,
      },
      { headers: { "x-invite-code": "DIAL-7K3P", "x-turnstile-token": "t" } },
    );
  });

  it("sends no sign-up request and no headers from the log-in page", async () => {
    client.social.mockResolvedValue({
      data: { url: "https://accounts.example/consent", redirect: false },
      error: undefined,
    });
    await googleConsentUrl("/", "/auth/login");
    expect(client.social).toHaveBeenCalledWith(
      {
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/login",
        disableRedirect: true,
      },
      {},
    );
  });

  it("says a refused code in the band as round 28 #9's NOT CREATED, with no retry and Request access", async () => {
    client.social.mockResolvedValue({
      data: undefined,
      error: { code: "INVITE_INVALID", status: 400 },
    });
    const thrown = await caught(
      googleConsentUrl("/", "/auth/signup", {
        inviteCode: "DIAL-7K3P",
        turnstileToken: "t",
      }),
    );
    expect(thrown).toBeInstanceOf(AccessRefused);
    expect(thrown).toMatchObject({
      kicker: "Not created",
      message: INVITE_COPY.invalid,
      retry: false,
      link: "request-access",
    });
  });

  it("says a Turnstile refusal as NOT SENT", async () => {
    client.social.mockResolvedValue({
      data: undefined,
      error: { code: "TURNSTILE_REFUSED", status: 403 },
    });
    expect(
      await caught(
        googleConsentUrl("/", "/auth/signup", {
          inviteCode: "DIAL-7K3P",
          turnstileToken: undefined,
        }),
      ),
    ).toMatchObject({ kicker: "Not sent", message: TURNSTILE_REFUSED });
  });

  it("reads a breach code as the status, not a field (Google has no password)", async () => {
    client.social.mockResolvedValue({
      data: undefined,
      error: { code: "PASSWORD_BREACHED", status: 400 },
    });
    const thrown = await caught(
      googleConsentUrl("/", "/auth/signup", {
        turnstileToken: "t",
      }),
    );
    expect(thrown).toBeInstanceOf(AuthRejected);
  });

  it("fails with the status when Better Auth refuses", async () => {
    client.social.mockResolvedValue({
      data: undefined,
      error: { status: 503 },
    });
    await expect(googleConsentUrl("/", "/auth/login")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("fails rather than going nowhere when no URL comes back", async () => {
    client.social.mockResolvedValue({
      data: { redirect: false },
      error: undefined,
    });
    await expect(googleConsentUrl("/", "/auth/login")).rejects.toThrow(
      "no consent URL in Google's answer",
    );
  });
});

describe("signOut", () => {
  it("resolves when the session is gone", async () => {
    client.signOut.mockResolvedValue({
      data: { success: true },
      error: undefined,
    });
    rememberForSession("u1", "has-handle");
    await expect(signOut()).resolves.toBeUndefined();
    expect(client.signOut).toHaveBeenCalledTimes(1);
    // The next runner to sign in on this page is asked about afresh.
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("rejects with the status when Better Auth refuses, so Sign out can say Still signed in", async () => {
    client.signOut.mockResolvedValue({
      data: undefined,
      error: { status: 500 },
    });
    rememberForSession("u1", "has-handle");
    const error = await caught(signOut());
    expect(isRememberedForSession("has-handle")).toBe(true);
    expect(error).toBeInstanceOf(AuthRejected);
    expect(error).toMatchObject({ status: 500 });
  });
});
