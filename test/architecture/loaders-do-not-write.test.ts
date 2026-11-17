import { describe, expect, it } from "vitest";

import { repoPath, serverFunctionsIn, withoutComments } from "./source-text";

/**
 * **A route loader calls no POST server function, unless it says what ties
 * the write to the runner** (SA-L03, design 230).
 *
 * A loader runs on the page's GET, and on a server render its call to a
 * server function is in-process: neither the function's declared method
 * nor the CSRF middleware in `src/start.ts` sees it. A link from anywhere
 * is a GET. So a loader that writes needs a reason the write is the
 * runner's own, and each one is listed here with it.
 *
 * Read as text: a route and a `functions.ts` cannot be imported by a test.
 */
const functionSources: Record<string, string> = import.meta.glob(
  "../../src/modules/*/functions.ts",
  { query: "?raw", import: "default", eager: true },
);
const routeSources: Record<string, string> = import.meta.glob(
  "../../src/routes/**/*.tsx",
  { query: "?raw", import: "default", eager: true },
);

const GUARDED = new Map([
  [
    "src/routes/onboarding/done.tsx completeOnboardingFn",
    "writes only for the runner's own arrival (lib/fetch-site)",
  ],
  [
    "src/routes/runs/strava-callback.tsx completeStravaConnectFn",
    "needs the OAuth state nonce from this host's own cookie",
  ],
]);

const POST = /createServerFn\(\s*\{\s*method:\s*"POST",?\s*\}\s*\)/u;

const postNames = serverFunctionsIn(functionSources)
  .filter(({ body }) => POST.test(body))
  .map(({ name }) => name.split(" ", 2)[1] ?? "");

/**
 * The text of a route's `loader:` and `beforeLoad:`, each up to the next
 * route option the file names.
 */
function loadingCode(code: string): string {
  return ["loader:", "beforeLoad:"]
    .map((option) => {
      const at = code.indexOf(option);
      if (at === -1) return "";
      const rest = code.slice(at + option.length);
      const next = /\n {2}\w+:/u.exec(rest);
      return next === null ? rest : rest.slice(0, next.index);
    })
    .join("\n");
}

function postCallsIn(code: string): string[] {
  return postNames.filter((name) =>
    new RegExp(String.raw`\b${name}\(`, "u").test(code),
  );
}

describe("route loaders", () => {
  const calls = Object.entries(routeSources).flatMap(([path, source]) =>
    postCallsIn(loadingCode(withoutComments(source))).map(
      (name) => `${repoPath(path)} ${name}`,
    ),
  );

  it("finds the POST functions it looks for", () => {
    expect(postNames.length).toBeGreaterThan(80);
  });

  it("call no POST server function but the guarded ones", () => {
    expect(calls.filter((call) => !GUARDED.has(call))).toStrictEqual([]);
  });

  it("still make every guarded call, so the list says nothing stale", () => {
    expect(new Set(calls)).toStrictEqual(new Set(GUARDED.keys()));
  });

  it("would see a loader's call", () => {
    expect(
      postCallsIn(
        loadingCode(
          "  loader: async () => {\n    await completeOnboardingFn({ data: {} });\n  },\n  component: X,",
        ),
      ),
    ).toStrictEqual(["completeOnboardingFn"]);
    expect(
      postCallsIn(
        loadingCode("  component: X,\n  loader: () => listItemsFn(),"),
      ),
    ).toStrictEqual([]);
  });
});
