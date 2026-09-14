import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The corpus pages, fetched once and cached on disk.
 *
 * **Cached because the eval is run repeatedly and the pages are not the
 * variable.** Comparing three models over twenty pages means sixty
 * extractions and twenty fetches; re-fetching on every run would burn
 * Firecrawl credits to re-measure something that did not change, and would
 * quietly re-measure it against a page the shop edited yesterday, which is
 * the opposite of an eval.
 *
 * **Gitignored, not committed.** Copyrighted marketing HTML in a public
 * repo, at a megabyte and a half each. `docs/designs/107` records the same
 * decision for the unit fixtures, which are trimmed fragments instead.
 *
 * Fetched through Firecrawl because a Worker is refused by most of these
 * shops and a laptop is not the environment the app runs in — the proxy is
 * the production fetch path, so the eval reads what production would read.
 *
 * **Named `page-cache.ts`, not `pages.ts`, and that is load-bearing.** The
 * cache directory beside it is `eval/pages/`, so `import "./pages"` resolves
 * to the *directory* under Node's ESM rules and fails with
 * `ERR_UNSUPPORTED_DIR_IMPORT`. It worked exactly once — the first run,
 * before the directory it creates existed — and would have failed on every
 * run after that.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, "pages");
const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

/**
A URL as a filename: stable, readable, and unique enough for a cache.
*/
export function cacheNameFor(url: string): string {
  const { host, pathname } = new URL(url);
  const slug = `${host}${pathname}`.replaceAll(/[^a-z0-9]+/giu, "-");
  // `slug` has no run of two dashes in it — the replace above collapsed
  // every one — so this trims at most a single trailing dash and cannot
  // backtrack.
  return `${slug.endsWith("-") ? slug.slice(0, -1) : slug}.html`;
}

export function cachedPage(url: string): string | undefined {
  const file = path.join(CACHE, cacheNameFor(url));
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/**
 * The page, from the cache or from the network.
 *
 * Throws rather than returning nothing: a corpus entry that cannot be
 * fetched is a hole in the measurement, and a run that silently skipped it
 * would report an accuracy figure over a corpus nobody chose.
 */
export async function fetchPage(url: string, apiKey: string): Promise<string> {
  const cached = cachedPage(url);
  if (cached !== undefined) return cached;

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ url, formats: ["rawHtml"], proxy: "auto" }),
  });
  if (!response.ok) {
    throw new Error(`${url}: proxy returned ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const html = rawHtmlOf(body);
  if (html === undefined) throw new Error(`${url}: no HTML in the response`);

  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path.join(CACHE, cacheNameFor(url)), html, "utf8");
  return html;
}

function rawHtmlOf(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const data: unknown = Reflect.get(body, "data");
  if (typeof data !== "object" || data === null) return undefined;
  const html: unknown = Reflect.get(data, "rawHtml");
  return typeof html === "string" ? html : undefined;
}
