/**
 * Where the smoke test points, read from the environment the deploy job
 * sets (design 186). Everything is required: a smoke run that silently
 * tested whatever production already serves would pass on the old code,
 * and one that skipped the signed-in check would pass with auth broken.
 */

/**
The Worker's name in `wrangler.jsonc`, the override header's key.
*/
const WORKER_NAME = "dialed";

export interface SmokeTarget {
  readonly baseURL: string;
  readonly versionId: string;
  readonly headers: Readonly<Record<string, string>>;
  /**
  The seeded smoke account (deployment.md §9).
  */
  readonly account: { readonly email: string; readonly password: string };
}

function required(
  vars: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = vars[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the smoke test`);
  }
  return value;
}

export function smokeTarget(
  vars: Readonly<Record<string, string | undefined>>,
): SmokeTarget {
  const baseURL = required(vars, "SMOKE_BASE_URL");
  const versionId = required(vars, "SMOKE_VERSION_ID");
  const email = required(vars, "SMOKE_EMAIL");
  const password = required(vars, "SMOKE_PASSWORD");
  return {
    baseURL,
    versionId,
    // A Dictionary Structured Header: the Worker's name, then the version
    // id as a quoted string. A value Cloudflare cannot parse is ignored,
    // which is why the spec checks the version that answered.
    headers: {
      "Cloudflare-Workers-Version-Overrides": `${WORKER_NAME}="${versionId}"`,
    },
    account: { email, password },
  };
}
