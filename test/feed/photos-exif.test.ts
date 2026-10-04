import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { entryPhotoPrefix } from "../../src/lib/entry-photo-key";
import {
  imageDimensions,
  pixelBudgetRefusal,
} from "../../src/lib/photo-pipeline";
import { createItem } from "../../src/modules/closet";
import {
  PhotoValidationError,
  uploadItemPhoto,
} from "../../src/modules/closet/photos";
import { photoResponse, uploadPhoto } from "../../src/modules/feed/photos";
import {
  imageCategories,
  type CategoryScores,
  type Classify,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetTables } from "./helpers";
import {
  hasMetadata,
  jpegWithGps,
  oversizedJpegHeader,
  tinyJpeg,
} from "./photos-fixture";

/**
 * SAF-1 and SAF-2 on the server: what a phone photo carries does not
 * survive into storage, and what is too big to decode is never decoded.
 * Observed through the photo route and R2, the two places a stranger or an
 * operator would find it.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

const CLEAN: Classify = () =>
  Promise.resolve({
    flagged: false,
    scores: Object.fromEntries(
      imageCategories.map((category) => [category, 0]),
    ) as CategoryScores,
  });

async function publicEntry() {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience: "runners" });
  return { userId, entryId };
}

beforeEach(resetTables);

describe("an entry photo (SAF-1)", () => {
  it("comes back from the photo route with no EXIF and no location, as a JPEG of the same size", async () => {
    const uploaded = await jpegWithGps();
    expect(hasMetadata(uploaded)).toBe(true);
    const { userId, entryId } = await publicEntry();

    // What a blur-off upload from an old client, or a script, sends: the
    // original bytes, exactly as the phone wrote them.
    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/jpeg",
        bytes: new Uint8Array(uploaded).buffer,
      },
      { classify: CLEAN },
    );
    const response = await photoResponse(key, await makeUser());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    const served = new Uint8Array(await response.arrayBuffer());
    expect(hasMetadata(served)).toBe(false);
    expect(imageDimensions(served)).toStrictEqual({ width: 64, height: 48 });
  });

  it("re-encodes a PNG as a JPEG too, so nothing is stored as sent", async () => {
    const { PhotonImage } = await import("@cf-wasm/photon/workerd");
    const image = new PhotonImage(new Uint8Array(8 * 8 * 4).fill(90), 8, 8);
    const png = image.get_bytes();
    image.free();
    const { userId, entryId } = await publicEntry();

    const key = await uploadPhoto(
      {
        userId,
        entryId,
        contentType: "image/png",
        bytes: new Uint8Array(png).buffer,
      },
      { classify: CLEAN },
    );

    const stored = await env.MEDIA.get(key);
    expect(stored?.httpMetadata?.contentType).toBe("image/jpeg");
    const bytes = new Uint8Array(
      (await stored?.arrayBuffer()) ?? new ArrayBuffer(0),
    );
    expect([bytes[0], bytes[1]]).toStrictEqual([0xff, 0xd8]);
  });
});

describe("a garment photo (SAF-1)", () => {
  it("stores its original and every size with no EXIF and no location", async () => {
    const userId = await makeUser();
    const item = await createItem(db(), userId, {
      category: "top",
      name: "Stripped",
    });

    const result = await uploadItemPhoto(
      db(),
      userId,
      item.id,
      await jpegWithGps(),
      "image/jpeg",
      CLEAN,
    );

    const listed = await env.MEDIA.list({ prefix: `${result.photoKey}/` });
    expect(
      listed.objects
        .map((object) => object.key)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(
      ["card.webp", "full.webp", "original.jpg", "thumb.webp"].map(
        (name) => `${result.photoKey}/${name}`,
      ),
    );
    for (const object of listed.objects) {
      const body = await env.MEDIA.get(object.key);
      const bytes = new Uint8Array(
        (await body?.arrayBuffer()) ?? new ArrayBuffer(0),
      );
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(hasMetadata(bytes)).toBe(false);
    }
  });
});

describe("the pixel budget (SAF-2)", () => {
  it("refuses an oversized entry photo with its own sentence, before decoding, and stores nothing", async () => {
    const { userId, entryId } = await publicEntry();
    // A 12 MP phone frame the browser should have shrunk, sent anyway.
    const header = oversizedJpegHeader(6000, 4000);

    await expect(
      uploadPhoto(
        {
          userId,
          entryId,
          contentType: "image/jpeg",
          bytes: new Uint8Array(header).buffer,
        },
        { classify: CLEAN },
      ),
    ).rejects.toThrow(pixelBudgetRefusal);
    const listed = await env.MEDIA.list({
      prefix: entryPhotoPrefix(userId, entryId),
    });
    expect(listed.objects).toStrictEqual([]);
  });

  it("refuses an oversized garment photo the same way", async () => {
    const userId = await makeUser();
    const item = await createItem(db(), userId, {
      category: "top",
      name: "Too big",
    });
    const refused = uploadItemPhoto(
      db(),
      userId,
      item.id,
      oversizedJpegHeader(6000, 4000),
      "image/jpeg",
      CLEAN,
    );
    await expect(refused).rejects.toThrow(PhotoValidationError);
    await expect(refused).rejects.toThrow(pixelBudgetRefusal);
  });

  it("says it in megapixels", () => {
    expect(pixelBudgetRefusal).toBe("Photo must be 16 megapixels or smaller.");
  });

  it("takes a photo inside the budget", async () => {
    const { userId, entryId } = await publicEntry();
    const bytes = await tinyJpeg(4096, 1);
    await expect(
      uploadPhoto(
        {
          userId,
          entryId,
          contentType: "image/jpeg",
          bytes: new Uint8Array(bytes).buffer,
        },
        { classify: CLEAN },
      ),
    ).resolves.toMatch(/^entries\//);
  });
});
