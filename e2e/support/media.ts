import { readFile } from "node:fs/promises";

import { getPlatformProxy } from "wrangler";

/**
 * Puts the sample photo in local R2 under each of `keys`, as an upload
 * leaves a photo's file, for the specs whose rows name one. Like
 * `withLocalDb`, this runs in Node against the dev server's own local
 * state, never in the Worker.
 */
export async function putSamplePhotos(keys: readonly string[]): Promise<void> {
  const photo = await readFile("test/fixtures/sample-photo.bin");
  const media = await getPlatformProxy<Env>();
  try {
    for (const key of keys) {
      await media.env.MEDIA.put(key, photo, {
        httpMetadata: { contentType: "image/jpeg" },
      });
    }
  } finally {
    await media.dispose();
  }
}
