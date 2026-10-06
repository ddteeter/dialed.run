import { describe, expect, it } from "vitest";

import {
  APPEAL_ADDRESS,
  CONTACT_ADDRESS,
} from "../../src/lib/contracts/contact";
import { repoPath, withoutComments } from "./source-text";

/**
 * Every address a runner is told to write to is written once, in
 * `lib/contracts/contact.ts`, and read from there: the From line, an
 * email's "write to", D4's appeal link. A second literal is a rival
 * truth — change the inbox and that copy keeps naming the old one.
 *
 * Comments are not copy, so a comment may still name an address (the
 * round-26 quote on `EMAIL_FROM` does); only code is scanned. The test
 * suite and `docs/legal/` are outside `src/` and outside this rule.
 */
const CONTACT_FILE = "src/lib/contracts/contact.ts";

const production: Record<string, string> = import.meta.glob(
  ["../../src/**/*.{ts,tsx}", "!../../src/db/migrations/**"],
  { query: "?raw", import: "default", eager: true },
);

const ADDRESS = /@dialed\.run\b/u;

describe("contact addresses", () => {
  it("are the two the terms name", () => {
    expect(CONTACT_ADDRESS).toBe("hello@dialed.run");
    expect(APPEAL_ADDRESS).toBe("desk@dialed.run");
  });

  it("are written as literals nowhere in src but their own file", () => {
    const paths = Object.keys(production).map((path) => repoPath(path));
    // The glob reached the constant's file and its readers, so an empty
    // answer is not an empty scan.
    expect(paths).toEqual(
      expect.arrayContaining([
        CONTACT_FILE,
        "src/modules/email/deliver.ts",
        "src/modules/email/content.ts",
        "src/modules/safety/components/AccountClosed.tsx",
      ]),
    );
    const offenders = Object.entries(production)
      .filter(([path]) => repoPath(path) !== CONTACT_FILE)
      .filter(([, source]) => ADDRESS.test(withoutComments(source)))
      .map(([path]) => repoPath(path));
    expect(offenders).toEqual([]);
  });

  it("would catch one", () => {
    expect(
      ADDRESS.test(withoutComments('foot: "Write to x@dialed.run."')),
    ).toBe(true);
    expect(ADDRESS.test(withoutComments("// write to x@dialed.run"))).toBe(
      false,
    );
  });
});
