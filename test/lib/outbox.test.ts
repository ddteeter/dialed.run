import { describe, expect, it } from "vitest";

import { dedupeKeyFor, outboxKinds, readOutboxRow } from "../../src/lib/outbox";

describe("outboxKinds", () => {
  it("is read from the union, so a new kind is drained without a second list", () => {
    expect(outboxKinds).toStrictEqual(["photo_delete"]);
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
