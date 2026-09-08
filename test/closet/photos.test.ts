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

    // Compile the photon wasm before the clock starts. `uploadItemPhoto`
    // reaches it through a dynamic import, so the first call in an isolate
    // pays a one-time compile that has nothing to do with image work — and
    // that cost grows with the worker bundle, so it crept up as lanes
    // landed and pushed this assertion over its budget on a merge that
    // touched no image code. Workers compiles wasm once per deployment
    // too; timing it here measured the harness, not the pipeline.
    await import("@cf-wasm/photon/workerd");

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
    // JPEG. This is a smoke bound against a catastrophic regression — say,
    // resizing from the original at every size instead of chaining down —
    // not an SLA. It has to be loose, because vitest runs 26 test files in
    // parallel and this is the only CPU-bound one in the suite: the same
    // work measured 6s alone and 11s while the rest of the suite competed
    // for cores. 10s was under 2x the solo number and failed two runs in
    // three on a loaded laptop. Anything that trips 30s is a real bug.
    expect(elapsedMs).toBeLessThan(30_000);

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

    const original = await env.MEDIA.get(`${result.photoKey}/original.jpg`);
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
