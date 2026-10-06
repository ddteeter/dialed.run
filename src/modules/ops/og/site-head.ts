/**
 * The document head every page starts from (OPS-9; round 26 #22): what a
 * link previews as, the icons, the manifest, and whether search engines
 * may index it. `routes/__root.tsx` spreads these; a page with something
 * better to say (task 129's entry page) overrides by the same name.
 *
 * Imports nothing, because a route imports it and a route is in the client
 * bundle.
 *
 * **The `robots` default is `noindex` for the whole site** until the
 * public launch (owner, 2026-09-26; decision D-53). A route's own
 * `robots` meta replaces this one — TanStack de-dupes head meta by name
 * and a child route's wins — which is how the landing page flips at the
 * stage 2 gate and how 129's pages keep profiles and entries noindex.
 */

/**
 * The production origin, which an `og:image` must be absolute against —
 * previews fetch it from outside, with no page to resolve a path against.
 * The same value as `wrangler.jsonc`'s `BETTER_AUTH_URL`, which a route
 * cannot read; `test/bindings-conformance.test.ts` fails if they differ.
 */
export const PUBLIC_ORIGIN = "https://dialed.run";

const TITLE = "dialed.run";
/**
 * The default card's own line (round 31 #6, D-107), which is the hero's.
 */
const DESCRIPTION = "Wear what worked.";

export const SITE_META = [
  { name: "description", content: DESCRIPTION },
  // Not indexed until the owner decides whether runners' names and kit
  // belong in search (development plan, open decision 1); robots.txt says
  // the same for profiles, entries and photos.
  { name: "robots", content: "noindex" },
  // `--night-run`, the icon tile's ink. A meta tag cannot read a CSS
  // variable; test/ops/theme-colour.dom.test.tsx pins this to tokens.css.
  { name: "theme-color", content: "#0B0B0E" },
  { property: "og:site_name", content: TITLE },
  { property: "og:title", content: TITLE },
  { property: "og:description", content: DESCRIPTION },
  { property: "og:type", content: "website" },
  { property: "og:image", content: `${PUBLIC_ORIGIN}/og/default` },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { name: "twitter:card", content: "summary_large_image" },
] as const;

export const SITE_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/manifest.webmanifest" },
] as const;
