import { describe, expect, it } from "vitest";

import start from "../../src/start.ts?raw";
import vite from "../../vite.config.ts?raw";
import { withoutComments } from "./source-text";

/**
 * **A server function answers only this app's own pages, and a payload
 * carries data, never a server function** (SA-M1, SA-M25, design 230).
 *
 * `src/start.ts` cannot be imported by a test (it pulls the framework's
 * entries), so its wiring is read as text. The behaviour, a foreign
 * `Sec-Fetch-Site` answered 403 on GET and POST, is
 * `e2e/auth/server-fn-origin.spec.ts`'s.
 */
const code = withoutComments(start);

describe("src/start.ts", () => {
  it("lists TanStack Start's CSRF middleware as request middleware", () => {
    expect(code).toMatch(
      /const csrfMiddleware = createCsrfMiddleware\(\{\s*filter: \(ctx\) => ctx\.handlerType === "serverFn",\s*\}\);/u,
    );
    expect(code).toMatch(/requestMiddleware: \[csrfMiddleware\]/u);
  });

  it("filters on the handler alone, so every method is checked", () => {
    expect(code).not.toMatch(/ctx\.request\.method|\bmethod\b/u);
  });

  it("lists the refusing adapter before any other", () => {
    expect(code).toMatch(
      /serializationAdapters: \[\s*createSerializationAdapter\(refuseServerFnArgument\),/u,
    );
  });
});

describe("vite.config.ts", () => {
  it("leaves the framework's missing-middleware warning on", () => {
    expect(withoutComments(vite)).not.toMatch(/disableCsrfMiddlewareWarning/u);
  });
});
