/**
 * Setup for the `ui` project (happy-dom). `@testing-library/jest-dom` adds the
 * accessibility-shaped matchers the forms contract is written in —
 * `toHaveAccessibleDescription`, `toHaveFocus`, `toBeVisible` — and the
 * cleanup unmounts between tests so one test's DOM cannot answer another's
 * query.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createCanvas, loadImage } from "canvas";
import { afterEach } from "vitest";
import { z } from "zod";

/**
 * A real 2D context for happy-dom's canvas.
 *
 * happy-dom ships a canvas stub whose `getContext` returns null — the same
 * hole jsdom has, and the reason `modules/safety/blur/paint.ts` had a
 * mutation score of zero on every line that touches one. node-canvas
 * provides a real implementation; this hands each `<canvas>` element its
 * own, sized to match, so a test can assert what was actually drawn
 * rather than only what was asked for.
 *
 * Patched here rather than swapping the environment: the project chose
 * happy-dom deliberately because jsdom does not implement `<dialog>`'s
 * `showModal`, which `ui/Sheet` is built on (see vitest.config.ts).
 */
const NOTHING = z.null().parse(JSON.parse("null"));

/**
 * A real `createImageBitmap`, for the same reason as the canvas context.
 *
 * happy-dom's rejects anything it is given, so `browserPipeline.load` —
 * the one line that turns a picked file into something drawable — could
 * not be exercised at all. node-canvas's `loadImage` returns an Image its
 * own `drawImage` accepts, which is what makes an end-to-end blur test
 * possible.
 *
 * `close` is a no-op: nothing here holds GPU memory, and the production
 * code does not call it.
 */
Object.defineProperty(globalThis, "createImageBitmap", {
  configurable: true,
  value: async (source: Blob): Promise<ImageBitmap> => {
    const bytes = new Uint8Array(await source.arrayBuffer());
    const image = await loadImage(Buffer.from(bytes));
    return Object.assign(image, {
      close: () => {
        // Nothing to release.
      },
    });
  },
});

const contexts = new WeakMap<HTMLCanvasElement, unknown>();
const backings = new WeakMap<HTMLCanvasElement, ReturnType<typeof createCanvas>>();

Object.defineProperties(HTMLCanvasElement.prototype, {
  getContext: {
  configurable: true,
  value(this: HTMLCanvasElement, kind: string): unknown {
    if (kind !== "2d") return undefined;
    const existing = contexts.get(this);
    if (existing !== undefined) return existing;
    const backing = createCanvas(this.width || 1, this.height || 1);
    const context = backing.getContext("2d");
    contexts.set(this, context);
    backings.set(this, backing);
    return context;
  },
},
  toBlob: {
  configurable: true,
  value(
    this: HTMLCanvasElement,
    callback: (blob: Blob | null) => void,
    type?: string,
  ): void {
    const backing = backings.get(this);
    if (backing === undefined) {
      callback(NOTHING);
      return;
    }
    const buffer = backing.toBuffer("image/png");
    // Copied into a plain Uint8Array: node's Buffer is backed by a shared
    // pool, and Blob's types will not take one.
    callback(new Blob([Uint8Array.from(buffer)], { type: type ?? "image/png" }));
  },
},
});

afterEach(() => {
  cleanup();
});
