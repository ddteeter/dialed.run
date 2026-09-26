import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { securityHeaders } from "../../src/modules/ops/security-headers";

/**
 * `public/_headers` is the static assets' copy of the Worker's security
 * headers (OPS-8): the assets layer answers `/favicon.ico`, `/fonts/…` and
 * the built JS without running the Worker, so `server.ts` never sees them.
 * A copy is a rival truth unless something pins it, and this is that.
 *
 * In the ui project because it reads the file off disk, from the repo root
 * where vitest runs.
 */

const file = readFileSync("public/_headers", "utf8");

/**
The `name: value` lines under the `/*` rule.
*/
function staticHeaders(): [string, string][] {
  const lines = file.split("\n");
  const rule = lines.indexOf("/*");
  return lines
    .slice(rule + 1)
    .filter((line) => line.startsWith("  "))
    .map((line) => {
      const trimmed = line.trim();
      const colon = trimmed.indexOf(": ");
      return [trimmed.slice(0, colon), trimmed.slice(colon + 2)];
    });
}

describe("public/_headers", () => {
  it("applies to every static path", () => {
    expect(file.split("\n")).toContain("/*");
  });

  it("carries exactly the Worker's headers, without a report-uri", () => {
    expect(staticHeaders()).toStrictEqual(
      securityHeaders(undefined).map(([name, value]) => [name, value]),
    );
  });
});
