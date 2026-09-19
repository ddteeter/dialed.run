/**
 * The two pieces of the photo pipeline that are pure: fitting a size into a
 * box, and releasing a WASM image after use.
 *
 * In `lib/` rather than `closet/photos.ts`, where they were written, because
 * enrichment re-encodes a product image the same way a runner's photo is
 * re-encoded (PR #72 review) — and enrichment importing the closet's barrel
 * for them closed a cycle: `closet/service` enqueues enrichment, whose
 * consumer copies the image. Pure helpers with no bindings behind them are
 * what `lib/` is for; the R2 writes and the row updates stay in the modules.
 */

/**
 * The size an image is stored at: itself, or scaled down so its longest
 * edge is `max`. Never scaled up.
 *
 * One expression rather than an early return, and that is a mutation-test
 * decision: the guard it replaced (`if (width <= max && height <= max)`)
 * had two equivalent mutants, because `<=` and `<` differ only when a side
 * equals `max`, and then the scale is exactly 1 either way. Clamping the
 * scale says the same thing with no branch to mutate.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Runs `use`, then hands the WASM image's memory back — whether `use`
 * returned or threw.
 *
 * One helper rather than two `try/finally` blocks, because a release is
 * the kind of thing that is invisible when it stops happening: nothing in
 * a test can see a leak, and nothing in production sees it either until an
 * isolate runs out of memory mid-upload. Written down once, it can at
 * least be asserted once.
 */
export async function withReleased<Image extends { free: () => void }, Result>(
  image: Image,
  use: (image: Image) => Promise<Result>,
): Promise<Result> {
  try {
    return await use(image);
  } finally {
    image.free();
  }
}
