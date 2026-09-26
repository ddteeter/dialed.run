/**
 * Rendering a share card to PNG in the Worker (OPS-16), and caching it.
 *
 * **The library, measured before adopting it** (decision D-51; numbers in
 * `docs/designs/125-ops-platform.md`): `@cf-wasm/og`, satori for layout and
 * resvg for paint, about 0.8 MB gzipped on a Worker whose limit is 64 MiB
 * uncompressed, rendering in ~25 ms warm. It is imported lazily, inside
 * the render, so its WebAssembly is compiled by the first card request and
 * not by every request the isolate serves.
 */
import type { JSX } from "react";

import archivo400 from "./fonts/archivo-400.woff.bin";
import archivo600 from "./fonts/archivo-600.woff.bin";
import archivoBlack from "./fonts/archivo-black-400.woff.bin";
import plexMono400 from "./fonts/ibm-plex-mono-400.woff.bin";
import plexMono600 from "./fonts/ibm-plex-mono-600.woff.bin";
import { OG_HEIGHT, OG_WIDTH } from "./cards";

/**
The three families, in the weights the cards use.
*/
const FONTS = [
  { name: "Archivo", data: archivo400, weight: 400, style: "normal" },
  { name: "Archivo", data: archivo600, weight: 600, style: "normal" },
  { name: "Archivo Black", data: archivoBlack, weight: 400, style: "normal" },
  { name: "IBM Plex Mono", data: plexMono400, weight: 400, style: "normal" },
  { name: "IBM Plex Mono", data: plexMono600, weight: 600, style: "normal" },
] as const;

function cardOptions() {
  return { width: OG_WIDTH, height: OG_HEIGHT, fonts: [...FONTS] };
}

/**
 * A card as a PNG response — the library's default format, and the one
 * every social preview accepts (none takes an SVG `og:image`).
 */
export async function renderCard(card: JSX.Element): Promise<Response> {
  const { ImageResponse } = await import("@cf-wasm/og/workerd");
  return ImageResponse.async(card, cardOptions());
}

/**
 * The same card as SVG, for a test: satori's output before paint, which is
 * where every size, colour and gap is written down.
 */
export async function renderCardSvg(card: JSX.Element): Promise<Response> {
  const { ImageResponse } = await import("@cf-wasm/og/workerd");
  return ImageResponse.async(card, { ...cardOptions(), format: "svg" });
}

/**
 * How long a card may be served from cache. The default card never
 * changes between deploys, so an hour is only about deploys; an entry's
 * card is shorter, because an entry that turns private or is deleted must
 * stop previewing — our cache is the one we control, even if a social
 * network's is not.
 */
export const CARD_TTL_SECONDS = { default: 3600, entry: 600 } as const;

/**
The named cache the cards live in, apart from anything else cached.
*/
const CARD_CACHE = "og-cards";

/**
 * The card for this request from the Worker's cache, rendering and storing
 * it on a miss. The Cache API, explicitly: a workers.dev host gets nothing
 * cached from response headers alone.
 */
export async function cachedCard(
  request: Request,
  ttlSeconds: number,
  render: () => Promise<Response>,
): Promise<Response> {
  const cache = await caches.open(CARD_CACHE);
  const hit = await cache.match(request);
  if (hit !== undefined) return hit;
  const rendered = await render();
  const response = new Response(rendered.body, rendered);
  response.headers.set(
    "Cache-Control",
    `public, max-age=${String(ttlSeconds)}`,
  );
  await cache.put(request, response.clone());
  return response;
}
