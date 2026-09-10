import { authClient } from "./client";

/**
 * Signing in and signing up, as promises that reject.
 *
 * Better Auth returns `{ error }` rather than rejecting, and
 * `useFormSubmit` classifies a *throw* into the failure band — so a
 * returned error object reads as a success and the form announces "signed
 * in" to someone who is not. Translating it is the whole job here.
 *
 * A form failure, not a field failure, and deliberately: the server will
 * not say *which* of email or password was wrong, because that tells an
 * attacker which addresses have accounts. So there is no field to attach
 * it to.
 *
 * This lives in the module rather than in the two route files because a
 * route holds no decisions — see
 * `test/architecture/server-functions-are-glue`.
 */
export async function signIn(values: {
  email: string;
  password: string;
}): Promise<void> {
  const result = await authClient.signIn.email(values);
  if (result.error) {
    throw new Error(result.error.message ?? "sign-in rejected");
  }
}

export async function signUp(values: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  const result = await authClient.signUp.email(values);
  if (result.error) {
    throw new Error(result.error.message ?? "sign-up rejected");
  }
}
