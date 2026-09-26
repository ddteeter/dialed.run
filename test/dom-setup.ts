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
import { afterAll, afterEach } from "vitest";
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
const backings = new WeakMap<
  HTMLCanvasElement,
  ReturnType<typeof createCanvas>
>();

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
      callback(
        new Blob([Uint8Array.from(buffer)], { type: type ?? "image/png" }),
      );
    },
  },
});

afterEach(() => {
  cleanup();
});

/**
 * A test file is not over until every timer it started has run.
 *
 * vitest tears happy-dom down when a file's last test returns, and a timer
 * the file started can still be pending then. When it fires into the torn
 * down globals, React's first act on a state update — reading
 * `window.event` to pick a lane — throws `window is not defined`, and
 * vitest fails the whole run on an unhandled error that no test owns.
 * `useFormSubmit` is the one that did it: a success waits one
 * `DURATION.instant` before `onSuccess` (D-44), then clears its pending
 * state, so any test that ends on "the status says Saved." leaves that
 * tail behind. Whether it fires into a live window or a dead one depends
 * on how long the worker takes to exit, which is why it failed on CI
 * (twice on PR #106, once on #103) and never locally.
 *
 * So this waits for the condition, not a period: every `setTimeout` a file
 * starts is tracked until it fires or is cleared, and the file's last hook
 * polls until none is left. A timer's callback runs its continuations
 * (the `await onSuccess` after the grace) as microtasks before the next
 * poll, so an empty set means the work is done, not just the timer. A
 * file that leaves one pending for good — a leak, or a real delay nothing
 * waits for — fails here by name instead of racing teardown.
 *
 * `setInterval` is not tracked: an interval never finishes on its own, and
 * one left running is a different bug. Fake timers replace `setTimeout`
 * while installed and restore this wrapper after, and the poll itself runs
 * on the captured originals, so a file ending with fakes still installed
 * cannot starve it.
 */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const pendingTimers = new Map<unknown, number>();
const DRAIN_LIMIT_MS = 5000;

Object.defineProperties(globalThis, {
  setTimeout: {
    configurable: true,
    writable: true,
    value: (
      handler: (...args: unknown[]) => void,
      delay?: number,
      ...args: unknown[]
    ): unknown => {
      const id = realSetTimeout(() => {
        pendingTimers.delete(id);
        handler(...args);
      }, delay);
      pendingTimers.set(id, delay ?? 0);
      return id;
    },
  },
  clearTimeout: {
    configurable: true,
    writable: true,
    value: (id: Parameters<typeof clearTimeout>[0]): void => {
      pendingTimers.delete(id);
      realClearTimeout(id);
    },
  },
});

afterAll(async () => {
  const started = Date.now();
  while (pendingTimers.size > 0) {
    if (Date.now() - started > DRAIN_LIMIT_MS) {
      const delays = Array.from(pendingTimers.values(), String).join(", ");
      throw new Error(
        `${String(pendingTimers.size)} timer(s) still pending ${String(DRAIN_LIMIT_MS)}ms after the file's last test (delays: ${delays}ms). They would fire into a torn-down window.`,
      );
    }
    await new Promise((resolve) => {
      realSetTimeout(resolve, 10);
    });
  }
});
