/**
 * Wrangler/Vite's built-in "Data" module rule loads `*.bin` imports as raw
 * bytes; tsc has no ambient declaration for that by default. Scoped to
 * test/closet (this lane's ownership) rather than the shared test/env.d.ts.
 */
declare module "*.bin" {
  const bytes: ArrayBuffer;
  export default bytes;
}
