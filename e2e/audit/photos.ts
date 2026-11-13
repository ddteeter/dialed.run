/**
 * Synthetic photos for the audit's seed, drawn on a canvas in a real
 * Chromium page (design 205, "Seeded data"). Glue: what to draw and at
 * what size is decided in `dense-seed.ts`; this only paints and encodes.
 *
 * Each artwork is a linear gradient between two colours, a faint noise
 * overlay so the encoder has texture to work with, and a white uppercase
 * label. Nothing real is in any of them, and no binary is committed.
 */
import type { Page } from "@playwright/test";
import { z } from "zod";

import type { Artwork, R2Object } from "./dense-seed";

/**
How a garment photo and a run photo differ: label, noise, quality.
*/
const STYLE = {
  garment: { noise: 0.18, labelPx: 110, labelAt: "center", alpha: 0.85 },
  entry: { noise: 0.22, labelPx: 80, labelAt: "bottom", alpha: 0.9 },
} as const;

const QUALITY = { "image/jpeg": 0.85, "image/webp": 0.82 } as const;

interface Paint {
  art: Artwork;
  style: (typeof STYLE)[keyof typeof STYLE];
  width: number;
  height: number;
  contentType: R2Object["contentType"];
  quality: number;
}

const encoded = z.string();

/**
 * Runs in the page: draws the artwork at its own size, scales it to the
 * requested one, and returns the encoded bytes as base64.
 */
async function paintInPage(paint: Paint): Promise<string> {
  const { art, style } = paint;
  const source = document.createElement("canvas");
  source.width = art.width;
  source.height = art.height;
  const context = source.getContext("2d");
  if (context === null) throw new Error("no 2d canvas in this page");
  const gradient = context.createLinearGradient(0, 0, 0, art.height);
  gradient.addColorStop(0, art.from);
  gradient.addColorStop(1, art.to);
  context.fillStyle = gradient;
  context.fillRect(0, 0, art.width, art.height);
  const noise = context.getImageData(0, 0, art.width, art.height);
  let seed = art.width * 31 + art.height;
  for (let index = 0; index < noise.data.length; index += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const grey = ((seed >>> 0) / 4_294_967_296) * 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = noise.data[index + channel] ?? 0;
      noise.data[index + channel] = value + (grey - value) * style.noise;
    }
  }
  context.putImageData(noise, 0, 0);
  context.fillStyle = `rgba(255, 255, 255, ${String(style.alpha)})`;
  context.font = `bold ${String(style.labelPx)}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = style.labelAt === "center" ? "middle" : "bottom";
  const y = style.labelAt === "center" ? art.height / 2 : art.height - 80;
  context.fillText(art.label.toUpperCase(), art.width / 2, y);

  const target = document.createElement("canvas");
  target.width = paint.width;
  target.height = paint.height;
  target.getContext("2d")?.drawImage(source, 0, 0, paint.width, paint.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    target.toBlob(
      (made) => {
        if (made === null) reject(new Error("the canvas did not encode"));
        else resolve(made);
      },
      paint.contentType,
      paint.quality,
    );
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

/**
 * The bytes for every object, drawn once per distinct artwork and size:
 * many rows share one picture, and drawing is the slow part.
 */
export async function renderPhotos(
  page: Page,
  objects: readonly R2Object[],
): Promise<Map<string, Uint8Array>> {
  const drawn = new Map<string, Uint8Array>();
  const byKey = new Map<string, Uint8Array>();
  for (const object of objects) {
    const id = `${object.art.kind}|${object.art.label}|${String(object.width)}x${String(object.height)}|${object.contentType}`;
    let bytes = drawn.get(id);
    if (bytes === undefined) {
      const base64 = encoded.parse(
        await page.evaluate(paintInPage, {
          art: object.art,
          style: STYLE[object.art.kind],
          width: object.width,
          height: object.height,
          contentType: object.contentType,
          quality: QUALITY[object.contentType],
        }),
      );
      bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      drawn.set(id, bytes);
    }
    byKey.set(object.key, bytes);
  }
  return byKey;
}
