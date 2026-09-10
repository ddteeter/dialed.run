import { describe, expect, it, vi } from "vitest";

import { authClient } from "../../src/modules/auth/client";
import { signIn, signUp } from "../../src/modules/auth/credentials";

/**
 * Better Auth returns `{ error }` rather than rejecting, and
 * `useFormSubmit` classifies a *throw* into the failure band — so a
 * returned error object reads as a success and the form announces "signed
 * in" to someone who is not. Translating it is the whole job here, and it
 * was a `useCallback` inside two route files, where no test could reach
 * it.
 */
vi.mock("../../src/modules/auth/client", () => ({
  authClient: {
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
  },
}));

const credentials = { email: "runner@example.com", password: "hunter2" };

describe("signIn", () => {
  it("passes the credentials through and resolves", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({ error: undefined });

    await expect(signIn(credentials)).resolves.toBeUndefined();
    expect(authClient.signIn.email).toHaveBeenCalledWith(credentials);
  });

  it("throws the provider's own message", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      error: { message: "Account is locked." },
    });

    await expect(signIn(credentials)).rejects.toThrow("Account is locked.");
  });

  it("throws something when the provider gives no message", async () => {
    // A rejection with an empty message would announce a blank failure
    // band; the fallback is never shown to the user but is what makes the
    // throw a real Error.
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      error: { message: undefined },
    });

    await expect(signIn(credentials)).rejects.toThrow("sign-in rejected");
  });
});

describe("signUp", () => {
  const details = { name: "Drew", ...credentials };

  it("passes the details through and resolves", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({ error: undefined });

    await expect(signUp(details)).resolves.toBeUndefined();
    expect(authClient.signUp.email).toHaveBeenCalledWith(details);
  });

  it("throws the provider's own message", async () => {
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      error: { message: "That email is taken." },
    });

    await expect(signUp(details)).rejects.toThrow("That email is taken.");
  });

  it("throws something when the provider gives no message", async () => {
    // Deliberately a different sentence from sign-in's: the two are
    // separate paths and a shared string would hide which one failed.
    vi.mocked(authClient.signUp.email).mockResolvedValue({
      error: { message: undefined },
    });

    await expect(signUp(details)).rejects.toThrow("sign-up rejected");
  });
});
