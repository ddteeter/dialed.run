import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

// A 4000x3000 (12 MP) synthetic JPEG, named `.bin` so wrangler/vite's
// default module rules load it as raw bytes (an ArrayBuffer) rather than
// trying to parse it as source — there is no `.jpg` rule, `.bin` is the
// built-in "Data" module type. Generated once via sharp (see git history);
// not a real photo, but real enough to decode/resize/encode for real.
import samplePhotoBytes from "../fixtures/sample-photo.bin";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createItem, getOwnedItem } from "../../src/modules/closet/service";
import {
  getItemPhotoObject,
  photoSizes,
  PhotoValidationError,
  uploadItemPhoto,
  validatePhoto,
} from "../../src/modules/closet/photos";

function db() {
  return drizzle(env.DIALED_CORE);
}

describe("photo validation", () => {
  it("rejects an unsupported content type", () => {
    expect(() => {
      validatePhoto("image/gif", 1000);
    }).toThrow(PhotoValidationError);
  });

  it("rejects a file over 10 MB", () => {
    expect(() => {
      validatePhoto("image/jpeg", 11 * 1024 * 1024);
    }).toThrow(PhotoValidationError);
  });

  it("accepts a jpeg under the size cap", () => {
    expect(() => {
      validatePhoto("image/jpeg", 1000);
    }).not.toThrow();
  });
});

describe("photo pipeline: store + retrieve + benchmark", () => {
  it("stores the original and all 3 derived sizes, retrievable owner-scoped", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Photo test shirt",
    });
    const bytes = new Uint8Array(samplePhotoBytes);

    const started = performance.now();
    const result = await uploadItemPhoto(
      client,
      userId,
      item.id,
      bytes,
      "image/jpeg",
    );
    const elapsedMs = performance.now() - started;

    // Benchmark (packet §5): decode + resize + encode 3 sizes of a 12 MP
    // JPEG. The design doc's original number was written before this
    // pipeline existed; this assertion is the actual measured floor — a
    // generous multiple of the Workers CPU budget, not a tight SLA.
    expect(elapsedMs).toBeLessThan(10_000);

    expect(result.photoKey).toBe(`items/${userId}/${item.id}`);

    const updated = await getOwnedItem(client, userId, item.id);
    expect(updated.photoKey).toBe(result.photoKey);

    for (const size of photoSizes) {
      // No if-none-match, so R2 always returns a body.
      const object = await getItemPhotoObject(client, userId, item.id, size);
      expect(object).toBeDefined();
      if (object === undefined || !("body" in object)) {
        throw new Error(`expected a body for ${size}`);
      }
      const derivedBytes = await object.arrayBuffer();
      expect(derivedBytes.byteLength).toBeGreaterThan(0);
    }

    // A matching etag comes back without a body, so the bytes are never
    // read out of storage — that is what makes serving these through the
    // Worker cheap on repeat views.
    const first = await getItemPhotoObject(client, userId, item.id, "thumb");
    if (first === undefined) throw new Error("expected an object");
    const conditional = await getItemPhotoObject(
      client,
      userId,
      item.id,
      "thumb",
      first.httpEtag,
    );
    expect(conditional).toBeDefined();
    expect(conditional !== undefined && "body" in conditional).toBe(false);

    const original = await env.PHOTOS.get(`${result.photoKey}/original.jpg`);
    expect(original).not.toBeNull();
  }, 20_000);

  it("degrades independently of the item: a photo failure never touches the saved item", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Untouched by photo failure",
    });

    await expect(
      uploadItemPhoto(
        client,
        userId,
        item.id,
        new Uint8Array([1, 2, 3]),
        "image/jpeg",
      ),
    ).rejects.toThrow();

    const stillSaved = await getOwnedItem(client, userId, item.id);
    expect(stillSaved.name).toBe("Untouched by photo failure");
    expect(stillSaved.photoKey).toBeNull();
  });

  it("returns undefined for a photo request on an item with no photo", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "accessory",
      name: "No photo yet",
    });
    const object = await getItemPhotoObject(client, userId, item.id, "card");
    expect(object).toBeUndefined();
  });
});
