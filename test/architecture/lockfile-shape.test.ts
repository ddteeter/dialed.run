import { describe, expect, it } from "vitest";
import { z } from "zod";

import lockSource from "../../package-lock.json?raw";
import manifestSource from "../../package.json?raw";

/**
 * SA-M18: every entry of `package-lock.json` resolves to the one tarball
 * its install path and `version` name, and to nothing else.
 *
 * lockfile-lint checks hosts, https and integrity; this checks the whole
 * URL. The real name of an aliased entry comes from the table below, never
 * from the lockfile's own `name` field, which only an aliased entry may
 * carry. The one entry off the registry is guardrails-core, at exactly the
 * URL `package.json` gives. An entry the lockfile marks `inBundle` comes
 * inside its parent's tarball, so it has no URL of its own to check.
 */

const REGISTRY = "https://registry.npmjs.org/";

/**
An alias's real package, pinned here. A new alias fails until added.
*/
const ALIASES: Readonly<Record<string, string>> = {
  // @cf-wasm/resvg's own dependency, `npm:@resvg/resvg-wasm`.
  "@resvg/resvg-wasm-legacy": "@resvg/resvg-wasm",
};

const entrySchema = z.looseObject({
  name: z.string().optional(),
  version: z.string().optional(),
  resolved: z.string().optional(),
  integrity: z.string().optional(),
  inBundle: z.boolean().optional(),
  link: z.boolean().optional(),
});

type Entry = z.infer<typeof entrySchema>;

const lockSchema = z.looseObject({
  packages: z.record(z.string(), entrySchema),
});

const manifestSchema = z.looseObject({
  devDependencies: z.looseObject({ "guardrails-core": z.string() }),
});

const OFF_REGISTRY: Readonly<Record<string, string>> = {
  "node_modules/guardrails-core":
    manifestSchema.parse(JSON.parse(manifestSource)).devDependencies[
      "guardrails-core"
    ],
};

const NODE_MODULES = "node_modules/";

function installedAs(path: string): string {
  return path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
}

/**
The registry URL an entry at `path` must resolve to.
*/
function canonicalUrl(path: string, version: string | undefined): string {
  const installed = installedAs(path);
  const name = ALIASES[installed] ?? installed;
  const base = name.slice(name.lastIndexOf("/") + 1);
  return `${REGISTRY}${name}/-/${base}-${String(version)}.tgz`;
}

function entryProblems(path: string, entry: Entry): string[] {
  const problems: string[] = [];
  const alias = ALIASES[installedAs(path)];
  if (entry.name !== alias) {
    problems.push(`${path}: name ${String(entry.name)}`);
  }
  if (entry.link === true) problems.push(`${path}: a link`);
  if (entry.inBundle === true) {
    if (entry.resolved !== undefined || entry.integrity !== undefined) {
      problems.push(`${path}: bundled, yet resolved on its own`);
    }
    return problems;
  }
  const expected = OFF_REGISTRY[path] ?? canonicalUrl(path, entry.version);
  if (entry.resolved !== expected) {
    problems.push(`${path}: resolves to ${String(entry.resolved)}`);
  }
  if (!(entry.integrity ?? "").startsWith('sha512-')) {
    problems.push(`${path}: integrity ${String(entry.integrity)}`);
  }
  return problems;
}

function lockfileProblems(source: string): string[] {
  const { packages } = lockSchema.parse(JSON.parse(source));
  return Object.entries(packages).flatMap(([path, entry]) =>
    path === "" ? [] : entryProblems(path, entry),
  );
}

/**
The real lockfile with one entry replaced by `change(entry)`.
*/
function tampered(path: string, change: (entry: Entry) => Entry): string {
  const lock = lockSchema.parse(JSON.parse(lockSource));
  const entry = lock.packages[path];
  if (entry === undefined) throw new Error(`no entry at ${path}`);
  lock.packages[path] = change(entry);
  return JSON.stringify(lock);
}

const ALIASED = "node_modules/@resvg/resvg-wasm-legacy";
const PLAIN = "node_modules/better-auth";
const BUNDLED =
  "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/tslib";

describe("package-lock.json", () => {
  it("resolves every entry to the tarball its path and version name", () => {
    expect(lockfileProblems(lockSource)).toStrictEqual([]);
  });

  it("rejects an aliased entry that resolves to another package", () => {
    const source = tampered(ALIASED, (entry) => ({
      ...entry,
      resolved: `${REGISTRY}resvg-helper/-/resvg-helper-2.4.1.tgz`,
    }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${ALIASED}: resolves to ${REGISTRY}resvg-helper/-/resvg-helper-2.4.1.tgz`,
    ]);
  });

  it("rejects an entry that resolves to another version of itself", () => {
    const old = `${REGISTRY}better-auth/-/better-auth-1.0.0.tgz`;
    const source = tampered(PLAIN, (entry) => ({ ...entry, resolved: old }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${PLAIN}: resolves to ${old}`,
    ]);
  });

  it("rejects an entry with no resolved URL and a name of its own", () => {
    const source = tampered(PLAIN, (entry) => ({
      ...entry,
      resolved: undefined,
      name: "not-better-auth",
    }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${PLAIN}: name not-better-auth`,
      `${PLAIN}: resolves to undefined`,
    ]);
  });

  it("rejects an aliased entry whose name is not the pinned one", () => {
    const source = tampered(ALIASED, (entry) => ({
      ...entry,
      name: "resvg-helper",
    }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${ALIASED}: name resvg-helper`,
    ]);
  });

  it("rejects an entry with no integrity, or a weaker one", () => {
    for (const integrity of [undefined, "sha1-abc"]) {
      const source = tampered(PLAIN, (entry) => ({ ...entry, integrity }));
      expect(lockfileProblems(source)).toStrictEqual([
        `${PLAIN}: integrity ${String(integrity)}`,
      ]);
    }
  });

  it("rejects guardrails-core anywhere but its release URL", () => {
    const path = "node_modules/guardrails-core";
    const source = tampered(path, (entry) => ({
      ...entry,
      resolved: "https://example.com/guardrails-core.tgz",
    }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${path}: resolves to https://example.com/guardrails-core.tgz`,
    ]);
  });

  it("lets a bundled entry pass only without a URL of its own", () => {
    const source = tampered(BUNDLED, (entry) => ({
      ...entry,
      resolved: `${REGISTRY}tslib/-/tslib-1.0.0.tgz`,
    }));
    expect(lockfileProblems(source)).toStrictEqual([
      `${BUNDLED}: bundled, yet resolved on its own`,
    ]);
  });

  it("rejects a link entry", () => {
    const source = tampered(PLAIN, (entry) => ({ ...entry, link: true }));
    expect(lockfileProblems(source)).toStrictEqual([`${PLAIN}: a link`]);
  });
});
