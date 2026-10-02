import { afterEach, expect, it } from "vitest";
import { z } from "zod";

import { ZOD_JITLESS_SCRIPT } from "../../src/lib/zod-jitless";

/**
 * The head script, run the way the page runs it: as an inline `<script>`
 * in a real browser. Neither other project can: workerd refuses code
 * generation from strings, and happy-dom does not execute scripts.
 *
 * Reading the result back through `z.config()` is what pins the global the
 * script writes to the zod that is installed: if an upgrade moves zod's
 * settings, the script writes somewhere nobody reads, and this fails.
 */
function runAsTheHeadDoes(): void {
  const script = document.createElement("script");
  script.textContent = ZOD_JITLESS_SCRIPT;
  // `head.append(script)`, spelled this way because the Workers types'
  // `Element.append` (HTMLRewriter's) shadows the DOM's for tsc. A script
  // that already ran does not run again when it is re-inserted.
  document.head.replaceChildren(...document.head.childNodes, script);
  script.remove();
}

/**
 * Where zod keeps `z.config()`'s settings.
 */
const ZOD_CONFIG = "__zod_globalConfig";

const installed: unknown = Reflect.get(globalThis, ZOD_CONFIG);

afterEach(() => {
  Reflect.set(globalThis, ZOD_CONFIG, installed);
});

it("turns off the JIT of the zod that is installed", () => {
  z.config({ jitless: false });

  runAsTheHeadDoes();

  expect(z.config().jitless).toBe(true);
});

it("leaves the setting for zod to find when it runs before zod has loaded", () => {
  // The page's order: the head script first, zod's modules after.
  Reflect.deleteProperty(globalThis, ZOD_CONFIG);

  runAsTheHeadDoes();

  expect(Reflect.get(globalThis, ZOD_CONFIG)).toStrictEqual({ jitless: true });
});
