/**
 * Reads the built client bundle and fails if server-only code reached it.
 *
 * **Why this check exists at all.** A route is in the client bundle, so what
 * it imports at module scope has to be reachable without `env` — and when
 * it is not, almost nothing says so. Pulling one decision out of
 * `feed/entries.ts` into a route loader dragged `cloudflare:workers` into
 * the browser bundle and broke `npm run build`; a second did the same with
 * the whole drizzle schema, 23 kB of it, and that one did not fail at all.
 * Neither is visible to tsc, to eslint, to dependency-cruiser or to the
 * test suite. Only the built chunk knows. See CLAUDE.md §Architecture.
 *
 * **Why it is a file now.** It lived as a `node -e` one-liner inside
 * package.json — about 1.5 kB of JSON-escaped JavaScript on a single line,
 * where every quote is backslashed and a reader has to unescape it in their
 * head before they can tell what it asserts. Raised on PR #73. The reason
 * it was inline is real but narrower than it looked: a `scripts/*.mjs` is
 * linted with no Node globals defined, so `process` and `console` are
 * `no-undef` — and `eslint.config.js` is a forbidden zone, so that cannot
 * be fixed from a lane. A **TypeScript** file has no such problem, because
 * typescript-eslint turns `no-undef` off (types do that job instead), which
 * is why `eval/run.ts` has always been able to call `console.log`. So this
 * runs under `tsx`, exactly as the evals do.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ASSETS = path.join("dist", "client", "assets");

/**
 * Markers that prove a server-only module is in the chunk, and the module
 * each one belongs to.
 *
 * A marker is a string the bundler cannot plausibly emit for anything else
 * — `drizzle:entityKind` is drizzle's own branding constant, not a name a
 * minifier would invent. Matching on module names would be worthless,
 * because minification removes them.
 */
const serverOnly: readonly (readonly [RegExp, string])[] = [
  [/drizzle:entityKind/, "drizzle-orm"],
  [/processEntities/, "fast-xml-parser"],
  [/wardrobe_items/, "db/schema-core"],
  [/FIT_EPOCH|fitsdk/, "@garmin/fitsdk"],
];

function chunks(): readonly string[] {
  if (!existsSync(ASSETS)) {
    throw new Error(`${ASSETS} does not exist — run \`npm run build\` first`);
  }
  return readdirSync(ASSETS).filter((name) => name.endsWith(".js"));
}

function read(name: string): string {
  return readFileSync(path.join(ASSETS, name), "utf8");
}

const names = chunks();

const leaks = names.flatMap((name) => {
  const text = read(name);
  return serverOnly
    .filter(([marker]) => marker.test(text))
    .map(([, module]) => `  ${name}: ${module}`);
});

if (leaks.length > 0) {
  throw new Error(
    `server-only code in the client bundle:\n${leaks.join("\n")}`,
  );
}

/**
 * MediaPipe is 11 MB of WASM loader behind a dynamic import, and the entry
 * chunk is what every visitor downloads before anything renders. If the
 * dynamic import is ever flattened — a stray top-level import, a bundler
 * setting — the cost moves to the first paint of the home page for a
 * feature only the photo step uses.
 */
const entry = names.filter((name) => /^index-.*\.js$/.test(name));
if (entry.length === 0) throw new Error("no entry chunk found");

for (const name of entry) {
  if (/FilesetResolver|vision_wasm_internal/.test(read(name))) {
    throw new Error(
      `@mediapipe/tasks-vision is in the ENTRY chunk ${name} — it must stay behind its dynamic import`,
    );
  }
}

// The other direction, and the one a "keep it out of the entry" check
// cannot see on its own: an import dropped entirely also keeps it out of
// the entry chunk, and would pass silently while the blur step is dead.
if (names.every((name) => !name.includes("vision_bundle"))) {
  throw new Error(
    "no mediapipe chunk emitted — the dynamic import may have been dropped",
  );
}

console.log("client bundle clean");
