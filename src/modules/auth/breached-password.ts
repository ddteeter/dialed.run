import { z } from "zod";

/**
 * Breach screening for a new password (owner, PR #104), per NIST SP
 * 800-63B §3.1.1.2: verifiers SHALL compare a new password against a list
 * of values known to be commonly used or compromised — and SHALL NOT
 * impose composition rules, which is why there are none anywhere here.
 *
 * **Why not Better Auth's `haveibeenpwned` plugin:** it sets no timeout
 * on its outbound call (law 4) and turns any failure into a 500 that
 * refuses the sign-up (law 5). This is the same check, written to fail
 * open: a slow or broken screen never costs a runner their account, and
 * the miss is reported for a human to see.
 *
 * **k-anonymity:** only the first five hex characters of the password's
 * SHA-1 leave the Worker; the range API answers with every suffix under
 * that prefix, and the match is made here. `Add-Padding` asks for decoy
 * rows (count 0) so the response size says nothing either — and a padded
 * row is never a match.
 */

const RANGE_API = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 10_000;

/**
 * What the screen found. `unknown` is a screen that could not answer —
 * a timeout, a refusal, a body we could not read — never a verdict.
 */
export type BreachVerdict = "breached" | "clean" | "unknown";

/**
 * One response row: a 35-character uppercase hex suffix and a count.
 */
const rowSchema = z
  .string()
  .regex(/^[\dA-F]{35}:\d+$/u)
  .transform((row) => {
    const [suffix = "", count = "0"] = row.split(":", 2);
    return { suffix, count: Number(count) };
  });

const rangeSchema = z
  .string()
  .transform((body) => body.split(/\r?\n/u).filter((line) => line !== ""))
  .pipe(z.array(rowSchema));

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function breachVerdict(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BreachVerdict> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  let body: string;
  try {
    const response = await fetchImpl(`${RANGE_API}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "unknown";
    body = await response.text();
  } catch {
    return "unknown";
  }

  const rows = rangeSchema.safeParse(body);
  if (!rows.success) return "unknown";
  return rows.data.some((row) => row.suffix === suffix && row.count > 0)
    ? "breached"
    : "clean";
}

/**
 * The body a path that sets a password carries, parsed: sign-up's field
 * is `password`, a change's is `newPassword`. Any other path is not
 * screened.
 */
const BODY_ON_PATH: ReadonlyMap<
  string | undefined,
  z.ZodType<{ secret: string }>
> = new Map<string | undefined, z.ZodType<{ secret: string }>>([
  [
    "/sign-up/email",
    z.object({ password: z.string() }).transform((body) => ({
      secret: body.password,
    })),
  ],
  [
    "/change-password",
    z.object({ newPassword: z.string() }).transform((body) => ({
      secret: body.newPassword,
    })),
  ],
]);

export function newPasswordIn(
  path: string | undefined,
  body: unknown,
): string | undefined {
  const parsed = BODY_ON_PATH.get(path)?.safeParse(body);
  return parsed?.success ? parsed.data.secret : undefined;
}

/**
 * The code Better Auth's error carries to the client, where
 * `credentials.ts` lands it on the Password field.
 */
export const BREACHED_CODE = ["PASSWORD", "BREACHED"].join("_");
