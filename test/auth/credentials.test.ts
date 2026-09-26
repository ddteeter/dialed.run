import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COPY, AuthRejected } from "../../src/modules/auth/auth-copy";
import {
  AuthFieldError,
  googleConsentUrl,
  signIn,
  signOut,
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
}));
vi.mock("../../src/modules/auth/client", () => ({
  authClient: {
    signIn: { email: client.email, social: client.social },
    signUp: { email: client.signUp },
    signOut: client.signOut,
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
  const account = { name: "Dana", ...person };

  it("resolves when the account is made", async () => {
    client.signUp.mockResolvedValue({ data: {}, error: undefined });
    await expect(signUp(account)).resolves.toBeUndefined();
    expect(client.signUp).toHaveBeenCalledWith(account);
  });

  it("lands a taken email on Email — Au3's one exception", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 },
    });
    const thrown = await caught(signUp(account));
    expect(thrown).toMatchObject({
      issues: [{ path: ["email"], message: AUTH_COPY.emailTaken }],
    });
  });

  it("lands a breached password on Password (NIST SP 800-63B §3.1.1.2)", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "PASSWORD_BREACHED", status: 400 },
    });
    const thrown = await caught(signUp(account));
    expect(thrown).toMatchObject({
      issues: [{ path: ["password"], message: AUTH_COPY.passwordBreached }],
    });
  });

  it("does not read a wrong-password code as a taken email", async () => {
    client.signUp.mockResolvedValue({
      data: undefined,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", status: 500 },
    });
    const thrown = await caught(signUp(account));
    expect(thrown).toBeInstanceOf(AuthRejected);
    expect(thrown).toMatchObject({ status: 500 });
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
    expect(client.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/closet",
      // Back to the page it left from — sign-up stays sign-up.
      errorCallbackURL: "/auth/signup",
      disableRedirect: true,
    });
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
    await expect(signOut()).resolves.toBeUndefined();
    expect(client.signOut).toHaveBeenCalledTimes(1);
  });

  it("rejects with the status when Better Auth refuses, so Sign out can say Still signed in", async () => {
    client.signOut.mockResolvedValue({
      data: undefined,
      error: { status: 500 },
    });
    const error = await caught(signOut());
    expect(error).toBeInstanceOf(AuthRejected);
    expect(error).toMatchObject({ status: 500 });
  });
});
