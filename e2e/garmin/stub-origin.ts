/**
 * Where the Garmin stub listens, and how the server under test learns it
 * (plan 160, step 9).
 *
 * The stub's port follows the app's: app port + 900, so CI's 3000 gives
 * 3900 and a lane on 3007 gives 3907. Worktrees already run on distinct
 * app ports (`playwright.config.ts`'s `resolvePort`), so their stubs never
 * share one either. One number, chosen once, handed to both sides.
 *
 * Handing it to the server is the awkward half, because the Worker reads
 * `GARMIN_API_ORIGIN` from a vars file and never from the process
 * environment while a `.dev.vars` exists
 * (https://developers.cloudflare.com/workers/development-testing/environment-variables/):
 *
 * - **dev** — `CLOUDFLARE_ENV=e2e` makes the Vite plugin load
 *   `.dev.vars.e2e` *instead of* `.dev.vars`. That file is written here:
 *   `.dev.vars` as it stands, with the origin line set to the stub. There
 *   is no `env.e2e` in `wrangler.jsonc`, so the top-level config applies
 *   unchanged and Wrangler warns "No environment found" once at startup.
 * - **preview** — `vite preview` ignores `CLOUDFLARE_ENV` and reads the
 *   `.dev.vars` the build wrote beside its `wrangler.json`, so that copy's
 *   origin line is set in place. It is a build artifact, rewritten by the
 *   next `npm run build`.
 *
 * Both writes happen only when the content would change, because the
 * config is loaded again in every test worker and the dev server restarts
 * when its vars file is touched.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STUB_PORT_OFFSET = 900;

/**
The Cloudflare environment name whose vars file dev reads.
*/
const E2E_CLOUDFLARE_ENV = "e2e";

/**
Where `npm run build` writes the Worker's vars for `vite preview`.
*/
const BUILT_DEV_VARS = "dist/server/.dev.vars";

export function garminStubPort(appPort: number): number {
  return appPort + STUB_PORT_OFFSET;
}

/**
`vars` (dotenv text) with its `GARMIN_API_ORIGIN` line set to `origin`.
*/
export function withStubOrigin(vars: string, origin: string): string {
  const kept = vars
    .split("\n")
    .filter((line) => !/^\s*GARMIN_API_ORIGIN\s*=/u.test(line));
  while (kept.length > 0 && kept.at(-1)?.trim() === "") kept.pop();
  return [...kept, `GARMIN_API_ORIGIN=${origin}`, ""].join("\n");
}

function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function writeIfChanged(file: string, content: string): void {
  if (readIfPresent(file) !== content) writeFileSync(file, content);
}

/**
 * Points the server `E2E_SERVER` names at the stub on `stubPort`, and
 * returns what the server's process needs in its environment for that.
 */
export function pointServerAtStub(
  server: "dev" | "preview",
  stubPort: number,
): Record<string, string> {
  const origin = `http://localhost:${String(stubPort)}`;
  if (server === "preview") {
    writeIfChanged(
      BUILT_DEV_VARS,
      withStubOrigin(readIfPresent(BUILT_DEV_VARS), origin),
    );
    return {};
  }
  writeIfChanged(
    `.dev.vars.${E2E_CLOUDFLARE_ENV}`,
    `# Written by e2e/garmin/stub-origin.ts from .dev.vars; edit that instead.\n${withStubOrigin(readIfPresent(".dev.vars"), origin)}`,
  );
  return { CLOUDFLARE_ENV: E2E_CLOUDFLARE_ENV };
}
