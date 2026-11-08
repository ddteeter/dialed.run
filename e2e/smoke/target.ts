/**
 * Where the smoke test points, read from the environment the deploy job
 * sets (design 186). Everything is required: a smoke run that silently
 * tested whatever production already serves would pass on the old code,
 * and one that skipped the signed-in check would pass with auth broken.
 */
import { readFileSync } from "node:fs";

/**
 * The Worker's name, the override header's key, read from `wrangler.jsonc`
 * rather than restated: a renamed Worker would otherwise send an override
 * Cloudflare ignores, and the version check would be the only thing to
 * notice. Its top-level `name` is the first `"name"` in the file.
 */
function workerName(): string {
  const config = readFileSync("wrangler.jsonc", "utf8");
  const name = /"name":\s*"(?<name>[^"]+)"/u.exec(config)?.groups?.name;
  if (name === undefined) throw new Error("wrangler.jsonc names no Worker");
  return name;
}

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
      "Cloudflare-Workers-Version-Overrides": `${workerName()}="${versionId}"`,
    },
    account: { email, password },
  };
}
