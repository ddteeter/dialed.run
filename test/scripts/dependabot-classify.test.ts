import { describe, expect, it } from "vitest";

import dependabotConfig from "../../.github/dependabot.yml?raw";
import {
  COOLDOWN_DAYS,
  decide,
  movedVersions,
  parsePackument,
  parseUpdates,
  semverReason,
  versionReason,
} from "../../scripts/dependabot-classify";
import type {
  Inputs,
  Moved,
  Packument,
} from "../../scripts/dependabot-classify";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const daysAgo = (days: number): string =>
  new Date(NOW - days * DAY).toISOString();

const tarball = (name: string, version: string): string =>
  `https://registry.npmjs.org/${name}/-/${name.slice(name.lastIndexOf("/") + 1)}-${version}.tgz`;

function lock(packages: Record<string, Record<string, unknown>>): string {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });
}

const entry = (name: string, version: string) => ({
  version,
  resolved: tarball(name, version),
});

const moved = (name: string, version: string): Moved => ({
  name,
  version,
  resolved: tarball(name, version),
});

/**
A package whose versions were each published `days` ago by `by`.
*/
function packument(
  versions: Record<string, { days: number; by?: string }>,
): Packument {
  const time: Record<string, string> = {};
  const publishers: Record<string, string> = {};
  for (const [version, { days, by }] of Object.entries(versions)) {
    time[version] = daysAgo(days);
    if (by !== undefined) publishers[version] = by;
  }
  return { time, publishers };
}

describe("the cooldown", () => {
  it("is dependabot.yml's default-days", () => {
    expect(/default-days: (\d+)/u.exec(dependabotConfig)?.[1]).toBe(
      String(COOLDOWN_DAYS),
    );
  });
});

describe("parseUpdates", () => {
  it("reads fetch-metadata's list", () => {
    expect(
      parseUpdates(
        JSON.stringify([
          {
            dependencyName: "a",
            updateType: "version-update:semver-patch",
            newVersion: "1.0.1",
            extra: 1,
          },
        ]),
      ),
    ).toStrictEqual([
      {
        dependencyName: "a",
        updateType: "version-update:semver-patch",
        newVersion: "1.0.1",
      },
    ]);
  });

  it.each([
    ["an empty list", "[]"],
    ["an object", "{}"],
    ["a missing name", '[{"updateType":"x","newVersion":"1"}]'],
    ["a missing type", '[{"dependencyName":"a","newVersion":"1"}]'],
    ["a missing version", '[{"dependencyName":"a","updateType":"x"}]'],
    ["a number for a field", '[{"dependencyName":1,"updateType":"x","newVersion":"1"}]'],
  ])("refuses %s", (_case, json) => {
    expect(parseUpdates(json)).toBeUndefined();
  });
});

const update = (updateType: string, newVersion: string) => ({
  dependencyName: "pkg",
  updateType: `version-update:semver-${updateType}`,
  newVersion,
});

describe("semverReason", () => {

  it.each([
    ["minor", "1.2.0"],
    ["minor", "10.0.0"],
    ["patch", "1.2.3"],
    ["patch", "0.3.1"],
  ])("lets a %s to %s through", (type, version) => {
    expect(semverReason(update(type, version))).toBeUndefined();
  });

  it.each([
    ["minor", "0.3.0"],
    ["patch", "0.0.4"],
    ["major", "2.0.0"],
  ])("holds a %s to %s", (type, version) => {
    expect(semverReason(update(type, version))).toBe(
      `pkg ${version}: version-update:semver-${type} is not a compatible minor or patch`,
    );
  });
});

describe("movedVersions", () => {
  const base = lock({
    "node_modules/a": entry("a", "1.0.0"),
    "node_modules/b": entry("b", "2.0.0"),
    "node_modules/x/node_modules/a": entry("a", "1.0.0"),
  });

  it("lists what the head installs that the base does not, once each", () => {
    const head = lock({
      "node_modules/a": entry("a", "1.1.0"),
      "node_modules/b": entry("b", "2.0.0"),
      "node_modules/x/node_modules/a": entry("a", "1.1.0"),
      "node_modules/@s/c": entry("@s/c", "3.0.0"),
    });
    expect(movedVersions(base, head)).toStrictEqual([
      moved("a", "1.1.0"),
      moved("@s/c", "3.0.0"),
    ]);
  });

  it("counts a changed URL at the same version as moved", () => {
    const head = lock({
      "node_modules/a": { version: "1.0.0", resolved: "https://example.com/a.tgz" },
      "node_modules/b": entry("b", "2.0.0"),
      "node_modules/x/node_modules/a": entry("a", "1.0.0"),
    });
    expect(movedVersions(base, head)).toStrictEqual([
      { name: "a", version: "1.0.0", resolved: "https://example.com/a.tgz" },
    ]);
  });

  it("names an aliased entry by the lockfile's name field", () => {
    const head = lock({
      "node_modules/alias": { name: "real", ...entry("real", "1.0.0") },
    });
    expect(movedVersions(lock({}), head)).toStrictEqual([moved("real", "1.0.0")]);
  });

  it("skips the root and bundled entries", () => {
    const head = JSON.stringify({
      packages: {
        "": { version: "9.9.9" },
        "node_modules/p/node_modules/q": { version: "1.0.0", inBundle: true },
      },
    });
    expect(movedVersions(lock({}), head)).toStrictEqual([]);
  });

  it.each([
    ["no packages", JSON.stringify({})],
    ["an entry with no version", lock({ "node_modules/a": {} })],
    ["packages as a list", JSON.stringify({ packages: [] })],
  ])("refuses a lockfile with %s", (_case, broken) => {
    expect(movedVersions(base, broken)).toBeUndefined();
    expect(movedVersions(broken, base)).toBeUndefined();
  });
});

const trusted = (config: string) => ({
  _npmUser: {
    name: "GitHub Actions",
    trustedPublisher: { id: "github", oidcConfigId: config },
  },
});

describe("parsePackument", () => {
  it("keeps the publish times and each version's publisher", () => {
    expect(
      parsePackument(
        JSON.stringify({
          time: { created: "c", "1.0.0": "t1", "2.0.0": 5 },
          versions: {
            "1.0.0": { _npmUser: { name: "alice" } },
            "2.0.0": {},
            "3.0.0": { _npmUser: { name: 7 } },
          },
        }),
      ),
    ).toStrictEqual({
      time: { created: "c", "1.0.0": "t1" },
      publishers: { "1.0.0": "alice" },
    });
  });

  it("names a trusted publisher by its OIDC configuration too", () => {
    const versions = {
      "1.0.0": trusted("oidc:a"),
      "1.1.0": trusted("a"),
      "1.2.0": trusted("b"),
    };
    const document = JSON.stringify({ time: {}, versions });
    expect(parsePackument(document)?.publishers).toStrictEqual({
      "1.0.0": "GitHub Actions (a)",
      "1.1.0": "GitHub Actions (a)",
      "1.2.0": "GitHub Actions (b)",
    });
  });

  it.each([
    ["no time", { versions: {} }],
    ["no versions", { time: {} }],
    ["a list", []],
  ])("refuses a document with %s", (_case, document) => {
    expect(parsePackument(JSON.stringify(document))).toBeUndefined();
  });
});

describe("versionReason", () => {
  const known = packument({
    "1.0.0": { days: 40, by: "alice" },
    "1.1.0": { days: 10, by: "alice" },
  });

  it("lets a version through that is old enough, by a known publisher", () => {
    expect(versionReason(moved("p", "1.1.0"), known, NOW)).toBeUndefined();
  });

  it("lets a version through at exactly the cooldown", () => {
    const edge = packument({
      "1.0.0": { days: 40, by: "alice" },
      "1.1.0": { days: COOLDOWN_DAYS, by: "alice" },
    });
    expect(versionReason(moved("p", "1.1.0"), edge, NOW)).toBeUndefined();
  });

  it("holds a version younger than the cooldown", () => {
    const young = packument({
      "1.0.0": { days: 40, by: "alice" },
      "1.1.0": { days: COOLDOWN_DAYS - 0.01, by: "alice" },
    });
    expect(versionReason(moved("p", "1.1.0"), young, NOW)).toBe(
      `p@1.1.0: published under ${String(COOLDOWN_DAYS)} days ago`,
    );
  });

  it("holds a version from an account new to the package", () => {
    const taken = packument({
      "1.0.0": { days: 40, by: "alice" },
      "1.1.0": { days: 10, by: "mallory" },
    });
    expect(versionReason(moved("p", "1.1.0"), taken, NOW)).toBe(
      "p@1.1.0: published by an account new to the package",
    );
  });

  it("counts only versions published before it as earlier", () => {
    const later = packument({
      "1.1.0": { days: 10, by: "mallory" },
      "1.2.0": { days: 8, by: "mallory" },
    });
    expect(versionReason(moved("p", "1.1.0"), later, NOW)).toBe(
      "p@1.1.0: published by an account new to the package",
    );
  });

  it("holds a package's first version", () => {
    const first = packument({ "1.0.0": { days: 30, by: "alice" } });
    expect(versionReason(moved("p", "1.0.0"), first, NOW)).toBe(
      "p@1.0.0: published by an account new to the package",
    );
  });

  it("holds a version with no publisher recorded", () => {
    const unnamed = packument({
      "1.0.0": { days: 40, by: "alice" },
      "1.1.0": { days: 10 },
    });
    expect(versionReason(moved("p", "1.1.0"), unnamed, NOW)).toBe(
      "p@1.1.0: no publisher recorded",
    );
  });

  it("holds a version with no publish time", () => {
    expect(versionReason(moved("p", "9.0.0"), known, NOW)).toBe(
      "p@9.0.0: no publish time",
    );
  });

  it("holds a package the registry did not answer for", () => {
    expect(versionReason(moved("p", "1.1.0"), undefined, NOW)).toBe(
      "p@1.1.0: the registry could not be read",
    );
  });

  it("holds an entry from anywhere but its registry tarball", () => {
    const elsewhere = {
      ...moved("p", "1.1.0"),
      resolved: "https://example.com/p.tgz",
    };
    expect(versionReason(elsewhere, known, NOW)).toBe(
      "p@1.1.0: not resolved from the npm registry",
    );
    expect(versionReason({ ...elsewhere, resolved: undefined }, known, NOW)).toBe(
      "p@1.1.0: not resolved from the npm registry",
    );
  });

  it("builds a scoped package's tarball from the name after the slash", () => {
    const scoped = packument({
      "1.0.0": { days: 40, by: "alice" },
      "1.1.0": { days: 10, by: "alice" },
    });
    expect(versionReason(moved("@s/p", "1.1.0"), scoped, NOW)).toBeUndefined();
  });
});

describe("decide", () => {
  const patch = JSON.stringify([
    {
      dependencyName: "p",
      updateType: "version-update:semver-patch",
      newVersion: "1.1.0",
    },
  ]);
  const base = lock({ "node_modules/p": entry("p", "1.0.0") });
  const head = lock({
    "node_modules/p": entry("p", "1.1.0"),
    "node_modules/q": entry("q", "2.0.0"),
    "node_modules/z/node_modules/q": entry("q", "2.0.0"),
  });
  const documents: Record<string, Packument> = {
    p: packument({ "1.0.0": { days: 40, by: "a" }, "1.1.0": { days: 9, by: "a" } }),
    q: packument({ "1.0.0": { days: 40, by: "b" }, "2.0.0": { days: 2, by: "b" } }),
  };

  function inputs(overrides: Partial<Inputs> = {}): Inputs {
    return {
      ecosystem: "npm_and_yarn",
      updatesJson: patch,
      baseLock: base,
      headLock: head,
      packument: (name) => Promise.resolve(documents[name]),
      now: NOW,
      ...overrides,
    };
  }

  it("merges when every rule holds", async () => {
    const onlyP = lock({ "node_modules/p": entry("p", "1.1.0") });
    expect(await decide(inputs({ headLock: onlyP }))).toStrictEqual({
      merge: true,
      reasons: [],
    });
  });

  it("holds for a version the update list does not name, and says why", async () => {
    expect(await decide(inputs())).toStrictEqual({
      merge: false,
      reasons: [`q@2.0.0: published under ${String(COOLDOWN_DAYS)} days ago`],
    });
  });

  it("lists the semver reasons before the lockfile's", async () => {
    const major = JSON.stringify([
      {
        dependencyName: "p",
        updateType: "version-update:semver-major",
        newVersion: "2.0.0",
      },
    ]);
    const decision = await decide(inputs({ updatesJson: major }));
    expect(decision.reasons).toStrictEqual([
      "p 2.0.0: version-update:semver-major is not a compatible minor or patch",
      `q@2.0.0: published under ${String(COOLDOWN_DAYS)} days ago`,
    ]);
  });

  it("reads the registry once per package", async () => {
    const asked: string[] = [];
    await decide(
      inputs({
        packument: (name) => {
          asked.push(name);
          return Promise.resolve(documents[name]);
        },
      }),
    );
    expect(asked).toStrictEqual(["p", "q"]);
  });

  it("holds anything that is not npm", async () => {
    expect(await decide(inputs({ ecosystem: "github_actions" }))).toStrictEqual({
      merge: false,
      reasons: ["ecosystem github_actions"],
    });
  });

  it("holds an update list it cannot read", async () => {
    expect(await decide(inputs({ updatesJson: "[]" }))).toStrictEqual({
      merge: false,
      reasons: ["the update list could not be read"],
    });
  });

  it("holds a lockfile it cannot read", async () => {
    expect(await decide(inputs({ headLock: "{}" }))).toStrictEqual({
      merge: false,
      reasons: ["a lockfile could not be read"],
    });
  });
});
