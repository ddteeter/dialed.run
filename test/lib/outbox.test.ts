import { describe, expect, it } from "vitest";

import { dedupeKeyFor, outboxKinds, readOutboxRow } from "../../src/lib/outbox";

describe("outboxKinds", () => {
  it("is read from the union, so a new kind is drained without a second list", () => {
    expect(outboxKinds).toStrictEqual([
      "photo_delete",
      "entry_media_delete",
      "import_file_delete",
      "email",
    ]);
  });
});

describe("dedupeKeyFor", () => {
  it("makes one photo debt per runner and garment", () => {
    expect(
      dedupeKeyFor({
        kind: "photo_delete",
        payload: { userId: "u1", itemId: "i1" },
      }),
    ).toBe("u1:i1");
  });

  it("makes one entry debt per entry, and one for all of a runner's", () => {
    expect(
      dedupeKeyFor({
        kind: "entry_media_delete",
        payload: { userId: "u1", entryId: "e1" },
      }),
    ).toBe("u1:e1");
    expect(
      dedupeKeyFor({ kind: "entry_media_delete", payload: { userId: "u1" } }),
    ).toBe("u1:*");
  });

  it("makes one import debt per object", () => {
    expect(
      dedupeKeyFor({
        kind: "import_file_delete",
        payload: { userId: "u1", key: "imports/u1/i1.gpx" },
      }),
    ).toBe("u1:imports/u1/i1.gpx");
  });
});

const UNKNOWN = {
  ok: false,
  problem: "not a kind and payload this build knows",
};

describe("readOutboxRow", () => {
  it("reads a row this build wrote", () => {
    expect(
      readOutboxRow(
        "photo_delete",
        JSON.stringify({ userId: "u1", itemId: "i1" }),
      ),
    ).toStrictEqual({
      ok: true,
      message: {
        kind: "photo_delete",
        payload: { userId: "u1", itemId: "i1" },
      },
    });
  });

  it("names a payload that is not JSON, without throwing", () => {
    expect(readOutboxRow("photo_delete", "{not json")).toStrictEqual({
      ok: false,
      problem: "payload is not JSON",
    });
  });

  it("refuses a kind this build does not know", () => {
    expect(
      readOutboxRow(
        "strava_revoke",
        JSON.stringify({ userId: "u1", itemId: "i1" }),
      ),
    ).toStrictEqual(UNKNOWN);
  });

  it("reads an entry debt with and without its entry", () => {
    expect(
      readOutboxRow("entry_media_delete", JSON.stringify({ userId: "u1" })),
    ).toStrictEqual({
      ok: true,
      message: { kind: "entry_media_delete", payload: { userId: "u1" } },
    });
    expect(
      readOutboxRow(
        "entry_media_delete",
        JSON.stringify({ userId: "u1", entryId: "" }),
      ),
    ).toStrictEqual(UNKNOWN);
  });

  it("reads an import debt only under the runner's own prefix", () => {
    expect(
      readOutboxRow(
        "import_file_delete",
        JSON.stringify({ userId: "u1", key: "imports/u1/a.gpx" }),
      ),
    ).toStrictEqual({
      ok: true,
      message: {
        kind: "import_file_delete",
        payload: { userId: "u1", key: "imports/u1/a.gpx" },
      },
    });
    // Another runner's object, or one outside the imports prefix, is a
    // payload this build refuses to act on.
    for (const key of ["imports/u2/a.gpx", "entries/u1/a", "imports/u1"]) {
      expect(
        readOutboxRow(
          "import_file_delete",
          JSON.stringify({ userId: "u1", key }),
        ),
      ).toStrictEqual(UNKNOWN);
    }
    expect(
      readOutboxRow(
        "import_file_delete",
        JSON.stringify({ userId: "", key: "imports//a" }),
      ),
    ).toStrictEqual(UNKNOWN);
  });

  it("refuses a payload of the wrong shape, including empty ids", () => {
    expect(
      readOutboxRow("photo_delete", JSON.stringify({ userId: "u1" })),
    ).toStrictEqual(UNKNOWN);
    expect(
      readOutboxRow(
        "photo_delete",
        JSON.stringify({ userId: "", itemId: "i1" }),
      ),
    ).toStrictEqual(UNKNOWN);
    expect(
      readOutboxRow(
        "photo_delete",
        JSON.stringify({ userId: "u1", itemId: "" }),
      ),
    ).toStrictEqual(UNKNOWN);
  });
});
