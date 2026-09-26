/**
 * Wrangler/Vite's built-in "Data" module rule loads `*.bin` imports as raw
 * bytes; tsc has no ambient declaration for that by default. The OG card's
 * fonts are `.woff.bin` for exactly this reason: under the Cloudflare vite
 * plugin a `.woff` import becomes a URL string, and satori needs the bytes.
 */
declare module "*.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}
