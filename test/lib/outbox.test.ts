import { describe, expect, it } from "vitest";

import {
  dedupeKeyFor,
  operatorEmailMessage,
  outboxKinds,
  readOutboxRow,
  scheduledOutboxKinds,
} from "../../src/lib/sql/outbox";

describe("outboxKinds", () => {
  it("is read from the union, so a new kind is drained without a second list", () => {
    expect(outboxKinds).toStrictEqual([
      "photo_delete",
      "entry_media_delete",
      "import_file_delete",
      "import_file_expire",
      "operator_email",
      "email",
      "product_link",
      "manual_conditions_delete",
    ]);
  });
});

describe("scheduledOutboxKinds", () => {
  it("is the failed import's file, the product link and the operators' mail: every other kind is a fast path's debt", () => {
    // The link a confirmation owes (D-113 Q1) has no fast path at all, and
    // nor has an operator's email (design 232).
    expect(scheduledOutboxKinds).toStrictEqual([
      "import_file_expire",
      "product_link",
      "operator_email",
    ]);
  });
});

describe("operatorEmailMessage (design 232)", () => {
  it("owes an operator's email as its own kind, keyed by its writer", () => {
    const message = operatorEmailMessage(
      {
        to: { userId: "op-one" },
        template: { kind: "takedown_valve", perHour: 10 },
      },
      "takedown_valve:1:op-one",
    );

    expect(message).toStrictEqual({
      kind: "operator_email",
      payload: {
        dedupeKey: "takedown_valve:1:op-one",
        email: {
          to: { userId: "op-one" },
          template: { kind: "takedown_valve", perHour: 10 },
        },
      },
    });
    expect(dedupeKeyFor(message)).toBe("takedown_valve:1:op-one");
    expect(
      readOutboxRow("operator_email", JSON.stringify(message.payload)),
    ).toMatchObject({ ok: true });
  });
});

describe("dedupeKeyFor", () => {
  it("makes one product link per runner, since one run links them all", () => {
    expect(
      dedupeKeyFor({ kind: "product_link", payload: { userId: "u1" } }),
    ).toBe("u1");
  });

  it("makes one photo debt per runner and garment", () => {
    expect(
      dedupeKeyFor({
        kind: "photo_delete",
        payload: { userId: "u1", itemId: "i1" },
      }),
    ).toBe("u1:i1");
  });

  it("makes one photo debt for all of a runner's garments", () => {
    expect(
      dedupeKeyFor({ kind: "photo_delete", payload: { userId: "u1" } }),
    ).toBe("u1:*");
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
    expect(
      dedupeKeyFor({
        kind: "import_file_expire",
        payload: { userId: "u1", key: "imports/u1/i1.gpx" },
      }),
    ).toBe("u1:imports/u1/i1.gpx");
  });

  it("makes one band debt per runner and run (C1)", () => {
    expect(
      dedupeKeyFor({
        kind: "manual_conditions_delete",
        payload: { userId: "u1", runId: "r1" },
      }),
    ).toBe("u1:r1");
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

  it("reads a photo debt with and without its garment", () => {
    expect(
      readOutboxRow("photo_delete", JSON.stringify({ userId: "u1" })),
    ).toStrictEqual({
      ok: true,
      message: { kind: "photo_delete", payload: { userId: "u1" } },
    });
    expect(
      readOutboxRow(
        "photo_delete",
        JSON.stringify({ userId: "u1", itemId: "" }),
      ),
    ).toStrictEqual(UNKNOWN);
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

  it("reads a failed import's expiry under the same prefix rule", () => {
    expect(
      readOutboxRow(
        "import_file_expire",
        JSON.stringify({ userId: "u1", key: "imports/u1/a.fit" }),
      ),
    ).toStrictEqual({
      ok: true,
      message: {
        kind: "import_file_expire",
        payload: { userId: "u1", key: "imports/u1/a.fit" },
      },
    });
    expect(
      readOutboxRow(
        "import_file_expire",
        JSON.stringify({ userId: "u1", key: "imports/u2/a.fit" }),
      ),
    ).toStrictEqual(UNKNOWN);
  });

  it("reads a band debt only with both its ids (C1)", () => {
    expect(
      readOutboxRow(
        "manual_conditions_delete",
        JSON.stringify({ userId: "u1", runId: "r1" }),
      ),
    ).toStrictEqual({
      ok: true,
      message: {
        kind: "manual_conditions_delete",
        payload: { userId: "u1", runId: "r1" },
      },
    });
    // The run id is the whole of what it deletes, so an empty one is
    // refused rather than handed to a delete.
    for (const payload of [
      { userId: "u1", runId: "" },
      { userId: "", runId: "r1" },
      { userId: "u1" },
    ]) {
      expect(
        readOutboxRow("manual_conditions_delete", JSON.stringify(payload)),
      ).toStrictEqual(UNKNOWN);
    }
  });

  it("reads an email row through the email schema, stripping what it does not name (design 283)", () => {
    const email = {
      to: { userId: "u1" },
      template: { kind: "invite", code: "RUN-1" },
    };
    expect(
      readOutboxRow(
        "email",
        JSON.stringify({
          dedupeKey: "k1",
          email: {
            ...email,
            extra: true,
            template: { ...email.template, extra: 1 },
          },
        }),
      ),
    ).toStrictEqual({
      ok: true,
      message: { kind: "email", payload: { dedupeKey: "k1", email } },
    });
    for (const bad of [
      undefined,
      { ...email, template: { kind: "invite", code: "" } },
      { ...email, to: { address: "not an address" } },
      { to: email.to, template: { kind: "no_such_kind" } },
    ]) {
      expect(
        readOutboxRow("email", JSON.stringify({ dedupeKey: "k1", email: bad })),
      ).toStrictEqual(UNKNOWN);
    }
  });

  it("refuses a payload of the wrong shape, including empty ids", () => {
    expect(
      readOutboxRow("photo_delete", JSON.stringify({ itemId: "i1" })),
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
