/**
 * Whether a Dependabot PR may merge itself: the `classify` job of
 * `.github/workflows/dependabot-pr.yml` runs this from main with Node's
 * own TypeScript support, and no `npm ci` (no package code runs in that
 * job). So it imports Node's built-ins only, and parses what it reads with
 * the narrow checks below rather than zod, which is not installed there.
 *
 * A PR merges itself only when all of these hold, and is held for a person
 * on any failure to read (SA-M38, SA-L10):
 *
 * 1. Every update fetch-metadata names is an npm minor at 1.0 or above, or
 *    a patch anywhere but 0.0.x (the semver rule, design 156).
 * 2. Every version the PR adds or moves in `package-lock.json`, named or
 *    not, comes from the npm registry and was published at least
 *    `COOLDOWN_DAYS` ago, by an npm account that published an earlier
 *    version of the same package. The lockfiles are read at the base and
 *    head commits as data; the registry's own record is what decides.
 */
import { appendFileSync } from "node:fs";
import process from "node:process";

/**
`.github/dependabot.yml`'s `default-days`; a test holds the two equal.
*/
export const COOLDOWN_DAYS = 7;

const DAY_MS = 86_400_000;

const REGISTRY = "https://registry.npmjs.org/";

export interface Update {
  readonly dependencyName: string;
  readonly updateType: string;
  readonly newVersion: string;
}

/**
One package version the PR installs that the base did not.
*/
export interface Moved {
  readonly name: string;
  readonly version: string;
  readonly resolved: string | undefined;
}

/**
What the registry says of one package: publish times and publishers.
*/
export interface Packument {
  readonly time: Readonly<Record<string, string>>;
  readonly publishers: Readonly<Record<string, string>>;
}

export interface Decision {
  readonly merge: boolean;
  readonly reasons: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/**
fetch-metadata's `updated-dependencies-json`, or `undefined` if not that shape.
*/
export function parseUpdates(json: string): Update[] | undefined {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const updates: Update[] = [];
  for (const entry of value) {
    const dependencyName = stringField(entry, "dependencyName");
    const updateType = stringField(entry, "updateType");
    const newVersion = stringField(entry, "newVersion");
    if (
      dependencyName === undefined ||
      updateType === undefined ||
      newVersion === undefined
    ) {
      return undefined;
    }
    updates.push({ dependencyName, updateType, newVersion });
  }
  return updates;
}

/**
Rule 1: why an update may not merge itself, or `undefined` if it may.
*/
export function semverReason(update: Update): string | undefined {
  const { dependencyName, updateType, newVersion } = update;
  const isMinor =
    updateType === "version-update:semver-minor" && /^[1-9]/u.test(newVersion);
  const isPatch =
    updateType === "version-update:semver-patch" &&
    /^(?:[1-9]|0\.[1-9])/u.test(newVersion);
  return isMinor || isPatch
    ? undefined
    : `${dependencyName} ${newVersion}: ${updateType} is not a compatible minor or patch`;
}

const NODE_MODULES = "node_modules/";

function lockPackages(json: string): Map<string, Moved> | undefined {
  const value: unknown = JSON.parse(json);
  const packages = isRecord(value) ? value.packages : undefined;
  if (!isRecord(packages)) return undefined;
  const entries = new Map<string, Moved>();
  for (const [path, entry] of Object.entries(packages)) {
    // The root is the repo itself; a bundled entry ships inside its
    // parent's tarball, which is checked as that parent.
    if (path === "" || (isRecord(entry) && entry.inBundle === true)) continue;
    const version = stringField(entry, "version");
    if (version === undefined) return undefined;
    const installed = path.slice(path.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    entries.set(path, {
      name: stringField(entry, "name") ?? installed,
      version,
      resolved: stringField(entry, "resolved"),
    });
  }
  return entries;
}

/**
 * Every package version the head lockfile installs that the base does not
 * install at the same path, once per name and version. `undefined` when
 * either file is not a lockfile.
 */
export function movedVersions(
  baseLock: string,
  headLock: string,
): Moved[] | undefined {
  const base = lockPackages(baseLock);
  const head = lockPackages(headLock);
  if (base === undefined || head === undefined) return undefined;
  const seen = new Set<string>();
  const moved: Moved[] = [];
  for (const [path, entry] of head) {
    const before = base.get(path);
    const key = `${entry.name}@${entry.version}`;
    const isSame =
      before?.version === entry.version && before.resolved === entry.resolved;
    if (isSame || seen.has(key)) continue;
    seen.add(key);
    moved.push(entry);
  }
  return moved;
}

/**
Who published a version: the npm account's name, and for a trusted
publisher (every one is named "GitHub Actions") also the OIDC
configuration it published through, so a new repository or workflow
reads as a new publisher. The registry has written the same id with and
without an `oidc:` prefix (is-unsafe 2.0.2 and 2.0.3), so that is dropped.
*/
function publisherOf(npmUser: unknown): string | undefined {
  const name = stringField(npmUser, "name");
  if (name === undefined || !isRecord(npmUser)) return name;
  const config = stringField(npmUser.trustedPublisher, "oidcConfigId");
  return config === undefined
    ? name
    : `${name} (${config.replace(/^oidc:/u, "")})`;
}

/**
The registry's full document for a package, reduced to what rule 2 reads.
*/
export function parsePackument(json: string): Packument | undefined {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !isRecord(value.time) || !isRecord(value.versions)) {
    return undefined;
  }
  const time: Record<string, string> = {};
  for (const [version, stamp] of Object.entries(value.time)) {
    if (typeof stamp === "string") time[version] = stamp;
  }
  const publishers: Record<string, string> = {};
  for (const [version, manifest] of Object.entries(value.versions)) {
    const publisher = isRecord(manifest)
      ? publisherOf(manifest._npmUser)
      : undefined;
    if (publisher !== undefined) publishers[version] = publisher;
  }
  return { time, publishers };
}

/**
The URL a registry entry must resolve to (as lockfile-shape pins it).
*/
function registryTarball(entry: Moved): string {
  const base = entry.name.slice(entry.name.lastIndexOf("/") + 1);
  return `${REGISTRY}${entry.name}/-/${base}-${entry.version}.tgz`;
}

/**
Rule 2 for one moved version: why it is held, or `undefined`.
*/
export function versionReason(
  entry: Moved,
  packument: Packument | undefined,
  now: number,
): string | undefined {
  const label = `${entry.name}@${entry.version}`;
  if (entry.resolved !== registryTarball(entry)) {
    return `${label}: not resolved from the npm registry`;
  }
  if (packument === undefined) return `${label}: the registry could not be read`;
  const published = Date.parse(packument.time[entry.version] ?? "");
  if (Number.isNaN(published)) return `${label}: no publish time`;
  if (now - published < COOLDOWN_DAYS * DAY_MS) {
    return `${label}: published under ${String(COOLDOWN_DAYS)} days ago`;
  }
  const publisher = packument.publishers[entry.version];
  if (publisher === undefined) return `${label}: no publisher recorded`;
  const earlier = Object.entries(packument.publishers).filter(
    ([version]) => Date.parse(packument.time[version] ?? "") < published,
  );
  return earlier.some(([, name]) => name === publisher)
    ? undefined
    : `${label}: published by an account new to the package`;
}

export interface Inputs {
  readonly ecosystem: string;
  readonly updatesJson: string;
  readonly baseLock: string;
  readonly headLock: string;
  /**
  The registry document for a package name, or `undefined` if unreadable.
  */
  readonly packument: (name: string) => Promise<Packument | undefined>;
  readonly now: number;
}

/**
The whole decision. Anything unreadable holds the PR.
*/
export async function decide(inputs: Inputs): Promise<Decision> {
  if (inputs.ecosystem !== "npm_and_yarn") {
    return { merge: false, reasons: [`ecosystem ${inputs.ecosystem}`] };
  }
  const updates = parseUpdates(inputs.updatesJson);
  if (updates === undefined) {
    return { merge: false, reasons: ["the update list could not be read"] };
  }
  const moved = movedVersions(inputs.baseLock, inputs.headLock);
  if (moved === undefined) {
    return { merge: false, reasons: ["a lockfile could not be read"] };
  }
  const names = [...new Set(moved.map((entry) => entry.name))];
  const documents = new Map(
    await Promise.all(
      names.map(async (name) => [name, await inputs.packument(name)] as const),
    ),
  );
  const reasons = [
    ...updates.flatMap((update) => semverReason(update) ?? []),
    ...moved.flatMap(
      (entry) =>
        versionReason(entry, documents.get(entry.name), inputs.now) ?? [],
    ),
  ];
  return { merge: reasons.length === 0, reasons };
}

const TIMEOUT_MS = 20_000;

async function readText(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)}`);
  return response.text();
}

async function registryPackument(name: string): Promise<Packument | undefined> {
  try {
    const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
    return parsePackument(await readText(`${REGISTRY}${path}`, {}));
  } catch {
    return undefined;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
`package-lock.json` at a commit, as data, through the contents API.
*/
function lockAt(sha: string): Promise<string> {
  return readText(
    `https://api.github.com/repos/${required("REPO")}/contents/package-lock.json?ref=${sha}`,
    {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${required("GH_TOKEN")}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  );
}

async function main(): Promise<void> {
  let decision: Decision;
  try {
    decision = await decide({
      ecosystem: required("ECOSYSTEM"),
      updatesJson: required("UPDATES"),
      baseLock: await lockAt(required("BASE_SHA")),
      headLock: await lockAt(required("HEAD_SHA")),
      packument: registryPackument,
      now: Date.now(),
    });
  } catch (error) {
    decision = { merge: false, reasons: [`not read: ${String(error)}`] };
  }
  const reasons = decision.reasons.map((reason) => `- held: ${reason}`);
  appendFileSync(
    required("GITHUB_OUTPUT"),
    `merge=${String(decision.merge)}\nheld<<END_OF_HELD\n${reasons.join("\n")}\nEND_OF_HELD\n`,
  );
  process.stdout.write(
    `May merge itself: ${String(decision.merge)}\n${reasons.join("\n")}\n`,
  );
}

if (import.meta.main) await main();
