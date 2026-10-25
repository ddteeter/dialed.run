import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which server function a request calls, by name, against either server
 * the suite drives (`E2E_SERVER` in playwright.config.ts).
 *
 * TanStack Start addresses a server function by an id at the end of its
 * `/_serverFn/` URL. In dev that id is the declaration itself, base64url
 * JSON naming the file and the export, so the name reads straight off the
 * URL. A production build hashes it instead, and the one place the hash
 * meets the name again is the resolver manifest the build writes into the
 * server bundle, which is read here, once.
 *
 * Reading the manifest leans on how Start lays out its build output. If an
 * update moves it, this throws and says so, rather than letting every stub
 * silently match nothing (design 156).
 */
const ASSETS = path.join("dist", "server", "assets");
const RESOLVER = "__23tanstack-start-server-fn-resolver-";
const HASHED = /^[\da-f]{64}(?:_\d+)?$/u;
const ENTRY =
  /"(?<id>[\da-f]{64}(?:_\d+)?)":\s*\{\s*functionName:\s*"(?<name>[^"]+)"/gu;

/**
 * Filled on first use, so a run against dev never reads the build.
 */
const manifest = new Map<string, string>();

function manifestNames(): ReadonlyMap<string, string> {
  if (manifest.size > 0) return manifest;
  const file = readdirSync(ASSETS).find((entry) => entry.startsWith(RESOLVER));
  if (file === undefined) {
    throw new Error(
      `No server-function manifest in ${ASSETS}: run \`npm run build\` first, or TanStack Start has moved it.`,
    );
  }
  const source = readFileSync(path.join(ASSETS, file), "utf8");
  for (const match of source.matchAll(ENTRY)) {
    const { id, name } = match.groups ?? {};
    if (id !== undefined && name !== undefined) manifest.set(id, name);
  }
  if (manifest.size === 0) {
    throw new Error(
      `${file} names no server functions: TanStack Start has changed its manifest.`,
    );
  }
  return manifest;
}

function serverFnName(segment: string): string {
  if (HASHED.test(segment)) return manifestNames().get(segment) ?? "";
  return Buffer.from(segment, "base64url").toString("utf8");
}

/**
 * Whether `url` is a call to the server function whose name holds `name`.
 */
export function isServerFnCall(url: string, name: string): boolean {
  const segment = new URL(url).pathname.split("/").pop() ?? "";
  return `${url} ${serverFnName(segment)}`.includes(name);
}
