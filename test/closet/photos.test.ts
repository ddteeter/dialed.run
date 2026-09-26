import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// A 4000x3000 (12 MP) synthetic JPEG, named `.bin` so wrangler/vite's
// default module rules load it as raw bytes (an ArrayBuffer) rather than
// trying to parse it as source — there is no `.jpg` rule, `.bin` is the
// built-in "Data" module type. Generated once via sharp (see git history);
// not a real photo, but real enough to decode/resize/encode for real.
import samplePhotoBytes from "../fixtures/sample-photo.bin";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  createItem,
  deleteItem,
  getOwnedItem,
  NotFoundError,
} from "../../src/modules/closet/service";
import { outbox, wardrobeItems } from "../../src/db/schema-core";
import { maxPhotoBytes } from "../../src/lib/photo-constraints";
import {
  extensionFor,
  getItemPhotoObject,
  isPhotoSize,
  photoSizes,
  PhotoValidationError,
  reasonFrom,
  removeItemPhoto,
  unquoteEtag,
  uploadItemPhoto,
  uploadPhotoFromForm,
  validatePhoto,
} from "../../src/modules/closet/photos";
import { photoKeyFor } from "../../src/lib/garment-photo-key";
import { nowSeconds } from "../../src/lib/now";
import {
  drainOutbox,
  OUTBOX_FAST_PATH_GRACE_S,
} from "../../src/modules/ops/outbox";
import { fitWithin, withReleased } from "../../src/lib/photo-pipeline";

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

    // A new version under the item's own prefix, per upload.
    expect(result.photoKey).toMatch(
      new RegExp(`^items/${userId}/${item.id}/[0-9A-Z]{26}$`, "u"),
    );

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

/**
 * The pure parts of the pipeline, which the end-to-end test above cannot
 * reach: it uploads one 4000x3000 JPEG and asserts three objects exist, so
 * every boundary and every message inside was free.
 */

describe("validatePhoto says which rule was broken", () => {
  it("names the allowed types", () => {
    expect(() => {
      validatePhoto("image/gif", 1000);
    }).toThrow(/JPEG, PNG, or WEBP/);
  });

  it("distinguishes an empty file from an oversized one", () => {
    // Two different fixes for the user: pick another file, versus this
    // file is too big. One message for both is no message.
    expect(() => {
      validatePhoto("image/jpeg", 0);
    }).toThrow(/empty/);
    expect(() => {
      validatePhoto("image/jpeg", maxPhotoBytes + 1);
    }).toThrow(/10 MB or smaller/);
  });

  it("accepts a file of exactly the cap", () => {
    // `>` rather than `>=`: 10 MB is allowed, 10 MB and one byte is not.
    expect(() => {
      validatePhoto("image/jpeg", maxPhotoBytes);
    }).not.toThrow();
  });
});

describe("extensionFor", () => {
  it("gives each allowed type its own extension", () => {
    // The original is stored under this extension and served back with the
    // content type it was uploaded with; two types sharing an extension
    // means the second upload overwrites the first.
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/webp")).toBe("webp");
  });

  it("refuses a type the pipeline cannot store, saying which are allowed", () => {
    expect(() => extensionFor("image/gif")).toThrow(PhotoValidationError);
    expect(() => extensionFor("image/gif")).toThrow(/JPEG, PNG, or WEBP/);
  });
});

describe("fitWithin", () => {
  it("leaves an image already inside the box alone", () => {
    expect(fitWithin(100, 80, 200)).toStrictEqual({ width: 100, height: 80 });
  });

  it("leaves an image exactly the size of the box alone", () => {
    // `<=`, not `<`: resizing 200x200 into 200 is work that changes nothing
    // and re-encodes the image for no reason.
    expect(fitWithin(200, 200, 200)).toStrictEqual({ width: 200, height: 200 });
  });

  it("scales by the longer side, so neither side escapes the box", () => {
    // The `&&` matters in both directions: an image inside the box on one
    // axis and outside on the other still has to be scaled, whichever axis
    // that is.
    expect(fitWithin(4000, 3000, 200)).toStrictEqual({
      width: 200,
      height: 150,
    });
    expect(fitWithin(3000, 4000, 200)).toStrictEqual({
      width: 150,
      height: 200,
    });
    expect(fitWithin(100, 400, 200)).toStrictEqual({ width: 50, height: 200 });
    expect(fitWithin(400, 100, 200)).toStrictEqual({ width: 200, height: 50 });
  });

  it("never scales a side to nothing", () => {
    // A panorama scaled to a thumbnail rounds its short side to 0, and a
    // zero-width resize is a decode error rather than a small image.
    expect(fitWithin(10_000, 20, 200)).toStrictEqual({ width: 200, height: 1 });
  });
});

/**
`Headers#get` answers null when the header is absent; parsed, not written.
*/
function noHeader(): string | null {
  return z.null().parse(JSON.parse("null"));
}

describe("unquoteEtag", () => {
  it("passes nothing through when there is no header", () => {
    // Both absences: the parameter is optional and the route hands
    // `request.headers.get(...)`, which answers null.
    expect(unquoteEtag(undefined)).toBeUndefined();
    expect(unquoteEtag(noHeader())).toBeUndefined();
  });

  it("strips the quotes R2 refuses", () => {
    // `httpEtag` is quoted and so is every browser's If-None-Match, and
    // R2's `onlyIf` rejects a quoted value outright — so this runs on
    // exactly the requests the conditional GET exists for.
    expect(unquoteEtag('"abc123"')).toBe("abc123");
    expect(unquoteEtag('  "abc123"  ')).toBe("abc123");
  });

  it("strips the weak-comparison prefix, and only from the front", () => {
    expect(unquoteEtag('W/"abc123"')).toBe("abc123");
    // An etag is opaque: "W/" inside one is part of the value.
    expect(unquoteEtag('"aW/b"')).toBe("aW/b");
  });

  it("strips only the outer quotes", () => {
    // An unanchored strip would rewrite the value itself.
    expect(unquoteEtag('"a"b"')).toBe('a"b');
  });

  it("gives up rather than guessing at a list or a wildcard", () => {
    // R2 takes one value. Picking one out of `a, b` would answer a
    // question the client did not ask.
    expect(unquoteEtag('"a", "b"')).toBeUndefined();
    expect(unquoteEtag("*")).toBeUndefined();
    expect(unquoteEtag("")).toBeUndefined();
    expect(unquoteEtag('""')).toBeUndefined();
  });
});

describe("isPhotoSize", () => {
  it("admits the three stored sizes and nothing else", () => {
    for (const size of photoSizes) expect(isPhotoSize(size)).toBe(true);
    expect(isPhotoSize("original")).toBe(false);
    expect(isPhotoSize("")).toBe(false);
  });
});

async function itemWithPhoto(): Promise<{
  client: ReturnType<typeof db>;
  userId: string;
  itemId: string;
  photoKey: string;
}> {
  const client = db();
  const userId = newUlid();
  const item = await createItem(client, userId, {
    category: "top",
    name: "Metadata test shirt",
  });
  await import("@cf-wasm/photon/workerd");
  const { photoKey } = await uploadItemPhoto(
    client,
    userId,
    item.id,
    new Uint8Array(samplePhotoBytes),
    "image/jpeg",
  );
  return { client, userId, itemId: item.id, photoKey };
}

describe("what the pipeline stores and refuses", () => {
  it("labels the original with the type it was uploaded as", async () => {
    // Served straight back on the download path. Without the metadata R2
    // answers `application/octet-stream` and the browser offers to save a
    // file instead of showing a photo.
    const { photoKey } = await itemWithPhoto();
    const original = await env.MEDIA.get(`${photoKey}/original.jpg`);
    expect(original?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("labels every derived size as webp, whatever went in", async () => {
    const { photoKey } = await itemWithPhoto();
    for (const size of photoSizes) {
      const object = await env.MEDIA.get(`${photoKey}/${size}.webp`);
      expect(object?.httpMetadata?.contentType, size).toBe("image/webp");
    }
  });

  it("refuses an empty file before it reaches the decoder", async () => {
    // The one case only `validatePhoto` catches: an empty JPEG has a type
    // `extensionFor` accepts, so without the validation call the failure
    // comes from photon as a decode error rather than as a sentence the
    // form can show.
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Empty upload",
    });

    await expect(
      uploadItemPhoto(client, userId, item.id, new Uint8Array(0), "image/jpeg"),
    ).rejects.toThrow(/empty/);
  });

  it("refuses a file it cannot store before writing anything", async () => {
    // The validation is the first line of the function on purpose: an
    // unsupported type must not leave an original in R2 that no derived
    // size will ever accompany.
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Rejected upload",
    });

    await expect(
      uploadItemPhoto(
        client,
        userId,
        item.id,
        new Uint8Array(samplePhotoBytes),
        "image/gif",
      ),
    ).rejects.toThrow(PhotoValidationError);

    const stored = await env.MEDIA.list({
      prefix: `items/${userId}/${item.id}/`,
    });
    expect(stored.objects).toHaveLength(0);
    const unchanged = await getOwnedItem(client, userId, item.id);
    expect(unchanged.photoKey).toBeNull();
  });

  it("answers nothing for a size it never stored", async () => {
    // `original` exists in R2 but is not a servable size; a route that
    // handed it out would stream a 12 MP JPEG to a grid thumbnail.
    const { client, userId, itemId } = await itemWithPhoto();
    expect(
      await getItemPhotoObject(client, userId, itemId, "original"),
    ).toBeUndefined();
  });

  it("ignores a malformed If-None-Match rather than failing the request", async () => {
    // R2 rejects a quoted etag, and a list of them has no single answer —
    // either way the right outcome is a normal, unconditional hit.
    const { client, userId, itemId } = await itemWithPhoto();
    const object = await getItemPhotoObject(
      client,
      userId,
      itemId,
      "thumb",
      '"a", "b"',
    );
    expect(object !== undefined && "body" in object).toBe(true);
  });
});

/**
 * The one thing in this file that nothing can observe from outside: a WASM
 * image whose memory is never handed back. It is written down once so it
 * can be asserted once.
 */
function fakeImage() {
  let freed = 0;
  return {
    free: () => {
      freed += 1;
    },
    timesFreed: () => freed,
  };
}

describe("withReleased", () => {
  it("releases after the work succeeds, and returns its result", async () => {
    const image = fakeImage();
    const result = await withReleased(image, () => Promise.resolve("done"));
    expect(result).toBe("done");
    expect(image.timesFreed()).toBe(1);
  });

  it("releases when the work throws, and lets the failure through", async () => {
    // An upload that fails halfway must not also leak the decoded source.
    const image = fakeImage();
    await expect(
      withReleased(image, () => Promise.reject(new Error("resize failed"))),
    ).rejects.toThrow("resize failed");
    expect(image.timesFreed()).toBe(1);
  });
});

describe("keys are built from real values, never from a null", () => {
  it("does not serve an object parked where a null photo key would point", async () => {
    // `${null}` is the string "null", so skipping the guard does not throw
    // — it looks somewhere real. Planting an object there is what turns a
    // silent wrong answer into a failing test.
    await env.MEDIA.put("null/thumb.webp", new Uint8Array([1, 2, 3]));
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "No photo yet",
    });

    expect(
      await getItemPhotoObject(client, userId, item.id, "thumb"),
    ).toBeUndefined();
  });

  it("does not serve a size it never derived, even if bytes sit at that key", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Original guard",
    });
    await import("@cf-wasm/photon/workerd");
    const { photoKey } = await uploadItemPhoto(
      client,
      userId,
      item.id,
      new Uint8Array(samplePhotoBytes),
      "image/jpeg",
    );
    await env.MEDIA.put(`${photoKey}/original.webp`, new Uint8Array([1, 2, 3]));

    expect(
      await getItemPhotoObject(client, userId, item.id, "original"),
    ).toBeUndefined();
  });
});

/**
 * Every object an upload leaves under a version: the three derived sizes,
 * and an original under each extension a runner could have sent — so a
 * cleanup that named only one extension would leave the others behind.
 */
function everyObjectUnder(photoKey: string): string[] {
  return [
    ...photoSizes.map((size) => `${photoKey}/${size}.webp`),
    ...["jpg", "png", "webp"].map((ext) => `${photoKey}/original.${ext}`),
  ];
}

/**
 * A garment with a stored photo, without running photon: the row carries
 * the key and the objects sit where an upload would have put them. The
 * pipeline is tested above; what is under test here is the undoing of it.
 */
async function garmentWithPhoto(userId: string) {
  const client = db();
  const item = await createItem(client, userId, {
    category: "top",
    name: "Photographed",
  });
  // A versioned key, as every upload now writes one.
  const photoKey = `${photoKeyFor(userId, item.id)}/01V1`;
  await client
    .update(wardrobeItems)
    .set({ photoKey, visibility: "hidden_pending_review" })
    .where(eq(wardrobeItems.id, item.id));
  for (const key of everyObjectUnder(photoKey)) {
    await env.MEDIA.put(key, new Uint8Array([1, 2, 3]));
  }
  return { item, photoKey };
}

async function storedKeys(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects.map((object) => object.key);
}

/**
The outbox rows owed for one garment, whatever their state.
*/
async function owedFor(userId: string, itemId: string) {
  return db()
    .select()
    .from(outbox)
    .where(eq(outbox.dedupeKey, `${userId}:${itemId}`));
}

/**
 * The daily drain, run as if the fast path's grace has passed — which is
 * what makes a row the fast path left behind due.
 */
async function drainLater(): Promise<string[]> {
  const anomalies: string[] = [];
  await drainOutbox(db(), anomalies, {
    now: nowSeconds() + OUTBOX_FAST_PATH_GRACE_S,
  });
  return anomalies;
}

function r2DeleteFailsOnce() {
  return vi
    .spyOn(env.MEDIA, "delete")
    .mockRejectedValueOnce(new Error("R2 down"));
}

describe("removeItemPhoto (round 22, the well's Remove)", () => {
  it("clears the key, puts the no-photo visibility back, and empties storage", async () => {
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);

    await removeItemPhoto(db(), userId, item.id);

    const row = await getOwnedItem(db(), userId, item.id);
    expect(row.photoKey).toBeNull();
    // A garment with no photo wears `ok`; a photo that is gone cannot be
    // pending a screen or hidden from anyone.
    expect(row.visibility).toBe("ok");
    expect(await storedKeys(photoKey)).toStrictEqual([]);
    // The fast path settled, so nothing is left owed.
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });

  it("leaves a no-photo row alone, but still clears anything stored under the item", async () => {
    // A second Remove, or one after an earlier cleanup failed: the row was
    // already cleared, and bytes may still be there.
    const userId = newUlid();
    const client = db();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Row already cleared",
    });
    await client
      .update(wardrobeItems)
      .set({ visibility: "pass" })
      .where(eq(wardrobeItems.id, item.id));
    const prefix = photoKeyFor(userId, item.id);
    await env.MEDIA.put(`${prefix}/01OLD/card.webp`, new Uint8Array([1]));

    await removeItemPhoto(client, userId, item.id);

    const row = await getOwnedItem(client, userId, item.id);
    expect(row.visibility).toBe("pass");
    expect(await storedKeys(prefix)).toStrictEqual([]);
  });

  it("succeeds when R2 fails, owes the bytes, and the drainer deletes them", async () => {
    // Law 8c: the D1 write and the debt commit together; R2 is the fast
    // path. A failed delete is not the runner's failure (law 5), and the
    // bytes (possibly a face) must not depend on them pressing anything.
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const failing = r2DeleteFailsOnce();
    const report = vi.fn();

    await removeItemPhoto(db(), userId, item.id, report);
    failing.mockRestore();

    const cleared = await getOwnedItem(db(), userId, item.id);
    expect(cleared.photoKey).toBeNull();
    expect(await storedKeys(photoKey)).toHaveLength(6);
    const [owed] = await owedFor(userId, item.id);
    expect(owed?.kind).toBe("photo_delete");
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      surface: "outbox-fast-path",
      kind: "photo_delete",
      outboxId: owed?.id,
      userId,
      itemId: item.id,
    });

    expect(await drainLater()).toStrictEqual([
      "1 photo_delete outbox row(s) were owed; 1 settled",
    ]);

    expect(await storedKeys(photoKeyFor(userId, item.id))).toStrictEqual([]);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });

  it("owes nothing and touches nothing when the D1 batch fails", async () => {
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const client = db();
    vi.spyOn(client, "batch").mockRejectedValueOnce(new Error("D1 down"));

    await expect(removeItemPhoto(client, userId, item.id)).rejects.toThrow(
      "D1 down",
    );

    const untouched = await getOwnedItem(db(), userId, item.id);
    expect(untouched.photoKey).toBe(photoKey);
    expect(await storedKeys(photoKey)).toHaveLength(6);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });

  it("keeps a photo uploaded after the Remove the drainer is still owed", async () => {
    // The debt is "the prefix holds more than the row names", not "delete
    // the prefix": a runner who removed, then chose a new photo before the
    // drain, keeps the new one.
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const failing = r2DeleteFailsOnce();
    await removeItemPhoto(db(), userId, item.id, vi.fn());
    failing.mockRestore();
    const fresh = `${photoKeyFor(userId, item.id)}/01V2`;
    await env.MEDIA.put(`${fresh}/card.webp`, new Uint8Array([1]));
    await db()
      .update(wardrobeItems)
      .set({ photoKey: fresh })
      .where(eq(wardrobeItems.id, item.id));

    await drainLater();

    expect(await storedKeys(`${photoKey}/`)).toStrictEqual([]);
    expect(await storedKeys(`${fresh}/`)).toStrictEqual([`${fresh}/card.webp`]);
  });

  it("refuses another runner's garment and touches none of it", async () => {
    const owner = newUlid();
    const { item, photoKey } = await garmentWithPhoto(owner);

    await expect(
      removeItemPhoto(db(), newUlid(), item.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    const row = await getOwnedItem(db(), owner, item.id);
    expect(row.photoKey).toBe(photoKey);
    expect(await storedKeys(photoKey)).toHaveLength(6);
  });
});

describe("hard-deleting a garment takes its photo with it", () => {
  it("clears storage when the garment is deleted, and owes nothing", async () => {
    const userId = newUlid();
    const deleted = await garmentWithPhoto(userId);

    await deleteItem(db(), userId, deleted.item.id);

    expect(
      await storedKeys(photoKeyFor(userId, deleted.item.id)),
    ).toStrictEqual([]);
    expect(await owedFor(userId, deleted.item.id)).toStrictEqual([]);
  });

  it("deletes the garment even when R2 fails, and the drainer finishes the photo", async () => {
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const failing = r2DeleteFailsOnce();

    await deleteItem(db(), userId, item.id);
    failing.mockRestore();

    // The garment and its debt landed together; the bytes are still there.
    await expect(getOwnedItem(db(), userId, item.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await owedFor(userId, item.id)).toHaveLength(1);
    expect(await storedKeys(photoKey)).toHaveLength(6);

    await drainLater();

    expect(await storedKeys(photoKeyFor(userId, item.id))).toStrictEqual([]);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });

  it("never leaves a garment with its photo gone: a failed batch touches no bytes", async () => {
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const client = db();
    vi.spyOn(client, "batch").mockRejectedValueOnce(new Error("D1 down"));

    await expect(deleteItem(client, userId, item.id)).rejects.toThrow(
      "D1 down",
    );

    const untouched = await getOwnedItem(db(), userId, item.id);
    expect(untouched.photoKey).toBe(photoKey);
    expect(await storedKeys(photoKey)).toHaveLength(6);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });
});

/**
A decodable 1x1 PNG, so a replace test pays for photon on one pixel.
*/
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (char) => char.codePointAt(0) ?? 0,
);

describe("replacing a photo", () => {
  it("writes a new version, and the replaced one leaves storage", async () => {
    const userId = newUlid();
    const client = db();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Replaced",
    });
    // A first photo has nothing to replace, and nothing outside the
    // garment's own prefix is ever touched — not even at a key a null
    // photo key would have spelled.
    await env.MEDIA.put("null/full.webp", new Uint8Array([1]));

    const first = await uploadItemPhoto(
      client,
      userId,
      item.id,
      PNG_1X1,
      "image/png",
    );
    const second = await uploadItemPhoto(
      client,
      userId,
      item.id,
      PNG_1X1,
      "image/png",
    );

    expect(await storedKeys("null/full.webp")).toStrictEqual([
      "null/full.webp",
    ]);
    expect(second.photoKey).not.toBe(first.photoKey);
    expect(second.photoKey.startsWith(`${photoKeyFor(userId, item.id)}/`)).toBe(
      true,
    );
    expect(await storedKeys(`${first.photoKey}/`)).toStrictEqual([]);
    expect(await storedKeys(`${second.photoKey}/`)).toHaveLength(4);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });

  it("clears the replaced original whatever type it arrived as", async () => {
    // The old version holds a JPEG original (and, planted, every other
    // extension); the new upload is a PNG. Nothing of the old one stays.
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);

    const replaced = await uploadItemPhoto(
      db(),
      userId,
      item.id,
      PNG_1X1,
      "image/png",
    );

    expect(await storedKeys(`${photoKey}/`)).toStrictEqual([]);
    expect(await storedKeys(`${replaced.photoKey}/`)).toContain(
      `${replaced.photoKey}/original.png`,
    );
  });

  it("keeps the new photo when clearing the old one fails, and the drainer clears it", async () => {
    // Law 5: the photo the runner asked for is saved; the leftover is
    // owed, reported, and drained later.
    const userId = newUlid();
    const { item, photoKey } = await garmentWithPhoto(userId);
    const failing = r2DeleteFailsOnce();

    const report = vi.fn();
    const second = await uploadItemPhoto(
      db(),
      userId,
      item.id,
      PNG_1X1,
      "image/png",
      undefined,
      report,
    );
    failing.mockRestore();

    const [owed] = await owedFor(userId, item.id);
    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      surface: "outbox-fast-path",
      kind: "photo_delete",
      outboxId: owed?.id,
      userId,
      itemId: item.id,
    });
    const row = await getOwnedItem(db(), userId, item.id);
    expect(row.photoKey).toBe(second.photoKey);
    expect(await storedKeys(`${photoKey}/`)).toHaveLength(6);

    await drainLater();

    expect(await storedKeys(`${photoKey}/`)).toStrictEqual([]);
    expect(await storedKeys(`${second.photoKey}/`)).toHaveLength(4);
    expect(await owedFor(userId, item.id)).toStrictEqual([]);
  });
});

function formFor(itemId: string, photo?: File): FormData {
  const form = new FormData();
  form.set("itemId", itemId);
  if (photo !== undefined) form.set("photo", photo);
  return form;
}

function photoFile(type = "image/jpeg"): File {
  return new File([samplePhotoBytes], "photo.jpg", { type });
}

describe("uploadPhotoFromForm", () => {
  /**
   * The multipart path, which used to live in `functions.ts` where nothing
   * could reach it. Every line of it is a decision about what a runner is
   * told when their photo does not go up — and requirement 8 says the item
   * they just saved stays saved either way.
   */
  it("uploads a real photo and reports the key it stored it under", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Form upload shirt",
    });
    await import("@cf-wasm/photon/workerd");

    const form = formFor(item.id, photoFile());
    const result = await uploadPhotoFromForm(client, userId, form);

    expect(result.ok).toBe(true);
    expect(result.ok && result.result.photoKey).toMatch(
      new RegExp(`^items/${userId}/${item.id}/[0-9A-Z]{26}$`, "u"),
    );
  });

  it("says so when no file was attached", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "No file shirt",
    });

    const result = await uploadPhotoFromForm(client, userId, formFor(item.id));
    expect(result).toStrictEqual({
      ok: false,
      error: "No photo file provided.",
    });
  });

  it("reports a rejected file with the reason the runner can act on", async () => {
    // Not a thrown error: the item is already saved, so this is a
    // photo-specific retry rather than a failed save.
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Bad type shirt",
    });

    const form = formFor(item.id, photoFile("image/gif"));
    const result = await uploadPhotoFromForm(client, userId, form);

    expect(result).toStrictEqual({
      ok: false,
      error: "Photo must be JPEG, PNG, or WEBP.",
    });
  });

  it("names the empty-file rule, not whatever the decoder says", async () => {
    // The one case only `validatePhoto` catches: an empty file has a type
    // the pipeline accepts, so without that call the runner is shown a
    // photon decode error instead of "Photo file is empty."
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "Empty form upload",
    });
    const form = formFor(
      item.id,
      new File([], "photo.jpg", { type: "image/jpeg" }),
    );

    const result = await uploadPhotoFromForm(client, userId, form);

    expect(result).toStrictEqual({ ok: false, error: "Photo file is empty." });
  });
});

describe("reasonFrom", () => {
  it("shows the runner what the rule was", () => {
    // Everything this file throws is a PhotoValidationError, and every one
    // of those says what to do about it.
    expect(reasonFrom(new PhotoValidationError("Photo file is empty."))).toBe(
      "Photo file is empty.",
    );
  });

  it("has something to say when the failure is not an Error", () => {
    // A `catch` catches anything. An upload that failed with no reason at
    // all is the one message a runner cannot act on.
    expect(reasonFrom("decoder exploded")).toBe("Photo upload failed.");
    expect(reasonFrom(undefined)).toBe("Photo upload failed.");
  });

  it("refuses an item id that is not one", async () => {
    // The id comes off the wire as a string; parsing it is what stops a
    // crafted form reaching another runner's item.
    const form = formFor("not-a-ulid");
    await expect(uploadPhotoFromForm(db(), newUlid(), form)).rejects.toThrow();
  });
});
