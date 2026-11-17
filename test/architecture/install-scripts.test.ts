import { describe, expect, it } from "vitest";
import { z } from "zod";

import npmrc from "../../.npmrc?raw";
import lockSource from "../../package-lock.json?raw";
import manifestSource from "../../package.json?raw";

/**
 * SA-L10: a dependency's install script runs only when `allowScripts`
 * names the package, and any other fails the install. Both settings are
 * npm 11.19's; `engine-strict` with the `engines` floor stops an older
 * npm, which would ignore them, from installing at all.
 *
 * Entries are bare names, so any version of a named package may run its
 * script: pinning a version would fail CI on every esbuild or workerd
 * bump until someone re-approved it.
 */

const workflows: Record<string, string> = import.meta.glob(
  "../../.github/workflows/*.yml",
  { query: "?raw", import: "default", eager: true },
);

const manifest = z
  .looseObject({
    allowScripts: z.record(z.string(), z.boolean()),
    engines: z.looseObject({ node: z.string(), npm: z.string() }),
  })
  .parse(JSON.parse(manifestSource));

const lockEntry = z.looseObject({ hasInstallScript: z.boolean().optional() });

const lock = z
  .looseObject({ packages: z.record(z.string(), lockEntry) })
  .parse(JSON.parse(lockSource));

const byName = (left: string, right: string): number =>
  left.localeCompare(right);

const settings = npmrc
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.startsWith("#"));

describe("install scripts", () => {
  it("fail the install unless allowed, on an npm that knows the rule", () => {
    expect(settings.toSorted(byName)).toStrictEqual([
      "engine-strict=true",
      "strict-allow-scripts=true",
    ]);
    expect(manifest.engines.npm).toBe(">=11.19.0");
    // 24.20.0 is the first Node 24 that ships npm 11.19.
    expect(manifest.engines.node).toBe("^24.20.0 || >=26");
  });

  it("are allowed by bare name for exactly the locked packages that have one", () => {
    const scripted = Object.entries(lock.packages)
      .filter(([, entry]) => entry.hasInstallScript === true)
      .map(([path]) => path.slice(path.lastIndexOf("node_modules/") + 13));
    expect(Object.keys(manifest.allowScripts).toSorted(byName)).toStrictEqual(
      [...new Set(scripted)].toSorted(byName),
    );
    expect(Object.values(manifest.allowScripts).every(Boolean)).toBe(true);
  });

  it("name no other package manager's allowlist", () => {
    expect(JSON.parse(manifestSource)).not.toHaveProperty("pnpm");
  });

  it("run on a Node that meets the floor in every workflow", () => {
    // Without check-latest, setup-node takes a cached Node 24 that may
    // predate 24.20, and engine-strict then fails the install.
    const setups = Object.values(workflows).flatMap((source) =>
      Array.from(
        source.matchAll(/uses: actions\/setup-node@.+\n(?: {8}.+\n){1,5}/gu),
        (match) => match[0],
      ),
    );
    expect(setups.length).toBeGreaterThanOrEqual(7);
    const loose = setups.filter(
      (block) =>
        !/node-version: "?24"?\n/u.test(block) ||
        !block.includes("check-latest: true"),
    );
    expect(loose).toStrictEqual([]);
  });
});
