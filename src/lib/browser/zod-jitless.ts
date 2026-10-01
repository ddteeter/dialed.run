/**
 * zod without its JIT, for a CSP with no `'unsafe-eval'` (OPS-8).
 *
 * zod v4 compiles an object schema's parser with `new Function` when it
 * can, and finds out whether it can by trying `new Function("")`. Under
 * this app's policy that probe is a `script-src` violation on every page
 * view, in dev and in production: report-only lets it through, so zod
 * then compiles every object parser and each compile is another report;
 * enforced, the probe throws and zod falls back quietly, but the report is
 * sent regardless. `jitless` skips the probe and the compile alike, and
 * the interpreted parser zod falls back to gives the same results.
 *
 * **It has to be set before the first `z.object(...)` is built, not before
 * the first parse.** An object schema reads the setting, and runs the
 * probe, when it is constructed, and nearly every schema in this app is
 * constructed at module scope. **No module can guarantee that in the
 * production bundle**: rollup puts zod in the shared chunk alongside the
 * modules that declare schemas, and a chunk's imports run before its own
 * body, so a `z.config({ jitless: true })` imported first thing by
 * `router.tsx` — measured — still runs after the probe it was meant to
 * prevent. The dev server serves modules one by one and hides this.
 *
 * So this is a classic inline script, which the root route puts in the
 * document's `<head>` with the request's nonce, and which runs while the
 * head is parsed, before any module script. It writes where
 * `z.config()` keeps its settings: `globalThis.__zod_globalConfig`, which
 * zod creates only if it is absent so that every copy of zod on a page
 * shares one config. `test/lib/zod-jitless.dom.test.tsx` pins that name
 * against the installed zod, so an upgrade that moves it fails there.
 *
 * Nothing sets it on the server, because nothing there needs it: workerd
 * refuses code generation from strings, and zod already skips the probe
 * when the user agent is Cloudflare's.
 */
export const ZOD_JITLESS_SCRIPT =
  "Object.assign((globalThis.__zod_globalConfig ??= {}), { jitless: true });";
