import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// A 4000x3000 (12 MP) synthetic JPEG, named `.bin` so wrangler/vite's
// default module rules load it as raw bytes (an ArrayBuffer) rather than
// trying to parse it as source — there is no `.jpg` rule, `.bin` is the
// built-in "Data" module type. Generated once via sharp (see git history);
// not a real photo, but real enough to decode/resize/encode for real.
import samplePhotoBytes from "../fixtures/sample-photo.bin";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { createItem, getOwnedItem } from "../../src/modules/closet/service";
import { maxPhotoBytes } from "../../src/lib/photo-constraints";
import {
  extensionFor,
  fitWithin,
  getItemPhotoObject,
  isPhotoSize,
  photoSizes,
  PhotoValidationError,
  reasonFrom,
  unquoteEtag,
  uploadItemPhoto,
  uploadPhotoFromForm,
  validatePhoto,
  withReleased,
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
    expect(fitWithin(4000, 3000, 200)).toStrictEqual({ width: 200, height: 150 });
    expect(fitWithin(3000, 4000, 200)).toStrictEqual({ width: 150, height: 200 });
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
    expect(unquoteEtag("  \"abc123\"  ")).toBe("abc123");
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

    expect(result).toStrictEqual({
      ok: true,
      result: { photoKey: `items/${userId}/${item.id}` },
    });
  });

  it("says so when no file was attached", async () => {
    const client = db();
    const userId = newUlid();
    const item = await createItem(client, userId, {
      category: "top",
      name: "No file shirt",
    });

    const result = await uploadPhotoFromForm(
      client,
      userId,
      formFor(item.id),
    );
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
    await expect(
      uploadPhotoFromForm(db(), newUlid(), form),
    ).rejects.toThrow();
  });
});
