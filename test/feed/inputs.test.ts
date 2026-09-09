import { describe, expect, it } from "vitest";

import { entryTagSchema } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { allowedPhotoTypes } from "../../src/lib/photo-constraints";
import {
  attachKitInput,
  bandCountsInput,
  coordinatesInput,
  entryIdInput,
  feedInput,
  itemBandStatInput,
  pickerGroupsInput,
  searchInput,
  submitVerdictInput,
  uploadPhotoFields,
  userIdInput,
} from "../../src/modules/feed/inputs";

/**
 * The feed's input contracts. They lived in `functions.ts`, which no test
 * can import (D-41), so every bound in them — the kit cap, the caption
 * length, the coordinate range — was unasserted.
 */

describe("attachKitInput", () => {
  it("takes a run and the kit worn on it", () => {
    expect(
      attachKitInput.safeParse({ runId: newUlid(), itemIds: [newUlid()] })
        .success,
    ).toBe(true);
    expect(attachKitInput.safeParse({ runId: newUlid(), itemIds: [] }).success).toBe(
      true,
    );
  });

  it("caps the kit at forty pieces", () => {
    // The list reaches an ownership read and an insert. A kit is a handful
    // of pieces; anything near this is a bug or an attack.
    const ids = Array.from({ length: 40 }, () => newUlid());
    expect(
      attachKitInput.safeParse({ runId: newUlid(), itemIds: ids }).success,
    ).toBe(true);
    expect(
      attachKitInput.safeParse({ runId: newUlid(), itemIds: [...ids, newUlid()] })
        .success,
    ).toBe(false);
  });

  it("refuses ids that are not ULIDs", () => {
    expect(attachKitInput.safeParse({ runId: "12", itemIds: [] }).success).toBe(
      false,
    );
    expect(
      attachKitInput.safeParse({ runId: newUlid(), itemIds: ["nope"] }).success,
    ).toBe(false);
  });
});

describe("the coordinate inputs", () => {
  it("takes a real WGS84 pair, and refuses one outside the globe", () => {
    expect(coordinatesInput.safeParse({ lat: 44.98, lng: -93.27 }).success).toBe(
      true,
    );
    expect(coordinatesInput.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
    expect(coordinatesInput.safeParse({ lat: 0, lng: -181 }).success).toBe(false);
  });

  it("requires both coordinates where a conditions lookup needs them", () => {
    expect(coordinatesInput.safeParse({ lat: 44.98 }).success).toBe(false);
  });

  it("lets the picker ask without a location at all", () => {
    // A browser can refuse geolocation, and the picker still has to show
    // the closet.
    expect(pickerGroupsInput.safeParse({}).success).toBe(true);
    expect(
      pickerGroupsInput.safeParse({ lat: 44.98, lng: -93.27 }).success,
    ).toBe(true);
    expect(pickerGroupsInput.safeParse({ lat: 91, lng: 0 }).success).toBe(false);
  });
});

describe("submitVerdictInput", () => {
  const valid = {
    entryId: newUlid(),
    verdict: 0,
    isPublic: true,
    tags: [],
    itemFlags: [],
  };

  it("takes the whole submission", () => {
    expect(submitVerdictInput.safeParse(valid).success).toBe(true);
  });

  it("holds the verdict to the −2..+2 scale", () => {
    expect(submitVerdictInput.safeParse({ ...valid, verdict: -2 }).success).toBe(
      true,
    );
    expect(submitVerdictInput.safeParse({ ...valid, verdict: 3 }).success).toBe(
      false,
    );
  });

  it("caps the caption at 280 characters", () => {
    expect(
      submitVerdictInput.safeParse({ ...valid, caption: "a".repeat(280) })
        .success,
    ).toBe(true);
    expect(
      submitVerdictInput.safeParse({ ...valid, caption: "a".repeat(281) })
        .success,
    ).toBe(false);
  });

  it("caps the tags at the number of tags there are", () => {
    // Derived from the enum rather than a number written here: a request
    // naming more tags than exist is a repeat or a bug either way.
    const every = [...entryTagSchema.options];
    expect(submitVerdictInput.safeParse({ ...valid, tags: every }).success).toBe(
      true,
    );
    expect(
      submitVerdictInput.safeParse({ ...valid, tags: [...every, every[0]] })
        .success,
    ).toBe(false);
  });

  it("refuses a tag it has never heard of", () => {
    expect(
      submitVerdictInput.safeParse({ ...valid, tags: ["too_cold"] }).success,
    ).toBe(false);
  });

  it("takes a per-item flag with a note, and caps the note", () => {
    expect(
      submitVerdictInput.safeParse({
        ...valid,
        itemFlags: [{ itemId: newUlid(), flag: "too_much", note: "Hands" }],
      }).success,
    ).toBe(true);
    expect(
      submitVerdictInput.safeParse({
        ...valid,
        itemFlags: [{ itemId: newUlid(), note: "a".repeat(281) }],
      }).success,
    ).toBe(false);
  });

  it("refuses a flag that is not one of the two", () => {
    expect(
      submitVerdictInput.safeParse({
        ...valid,
        itemFlags: [{ itemId: newUlid(), flag: "meh" }],
      }).success,
    ).toBe(false);
  });
});

describe("the id inputs", () => {
  it("each need a ULID", () => {
    expect(entryIdInput.safeParse({ entryId: newUlid() }).success).toBe(true);
    expect(entryIdInput.safeParse({ entryId: "12" }).success).toBe(false);
    expect(userIdInput.safeParse({ userId: newUlid() }).success).toBe(true);
    expect(userIdInput.safeParse({ userId: "12" }).success).toBe(false);
  });
});

describe("the band inputs", () => {
  it("take a floor, and an entry to leave out of its own comparison", () => {
    expect(bandCountsInput.safeParse({ bandFloorC: -5 }).success).toBe(true);
    expect(
      bandCountsInput.safeParse({ bandFloorC: 0, excludeEntryId: newUlid() })
        .success,
    ).toBe(true);
    expect(bandCountsInput.safeParse({}).success).toBe(false);
  });

  it("need the item the stat is about", () => {
    expect(
      itemBandStatInput.safeParse({ itemId: newUlid(), bandFloorC: 0 }).success,
    ).toBe(true);
    expect(itemBandStatInput.safeParse({ bandFloorC: 0 }).success).toBe(false);
  });
});

describe("feedInput", () => {
  it("takes a first page with no cursor", () => {
    expect(feedInput.safeParse({}).success).toBe(true);
  });

  it("takes a cursor of a whole-second timestamp and an id", () => {
    expect(
      feedInput.safeParse({ cursor: { createdAt: 1_768_485_600, id: "abc" } })
        .success,
    ).toBe(true);
    // Fractional seconds are not a timestamp this app writes.
    expect(
      feedInput.safeParse({ cursor: { createdAt: 1.5, id: "abc" } }).success,
    ).toBe(false);
    expect(feedInput.safeParse({ cursor: { createdAt: 1 } }).success).toBe(
      false,
    );
  });
});

describe("searchInput", () => {
  it("takes a prefix and bounds it", () => {
    expect(searchInput.safeParse({ prefix: "" }).success).toBe(true);
    expect(searchInput.safeParse({ prefix: "a".repeat(60) }).success).toBe(true);
    expect(searchInput.safeParse({ prefix: "a".repeat(61) }).success).toBe(
      false,
    );
  });
});

describe("uploadPhotoFields", () => {
  it("takes each photo type the app accepts, and nothing else", () => {
    // Derived from `lib/photo-constraints` rather than listed again — the
    // feed had its own copy of this list before.
    for (const contentType of allowedPhotoTypes) {
      expect(
        uploadPhotoFields.safeParse({ entryId: newUlid(), contentType }).success,
        contentType,
      ).toBe(true);
    }
    expect(
      uploadPhotoFields.safeParse({
        entryId: newUlid(),
        contentType: "image/gif",
      }).success,
    ).toBe(false);
  });

  it("takes an idempotency key, and needs it to be a ULID", () => {
    expect(
      uploadPhotoFields.safeParse({
        entryId: newUlid(),
        contentType: "image/jpeg",
        idempotencyKey: newUlid(),
      }).success,
    ).toBe(true);
    expect(
      uploadPhotoFields.safeParse({
        entryId: newUlid(),
        contentType: "image/jpeg",
        idempotencyKey: "retry-1",
      }).success,
    ).toBe(false);
  });
});
