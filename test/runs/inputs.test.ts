import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  ImportUploadError,
  MAX_IMPORT_BYTES,
} from "../../src/modules/runs/imports";
import {
  conditionsBandInput,
  importIdInput,
  importUploadFrom,
  manualRunInput,
  retimeRunInput,
  runIdInput,
  stravaCallbackInput,
  stravaCallbackSearch,
} from "../../src/modules/runs/inputs";

/**
 * The trust boundaries `functions.ts` sits behind (D-41).
 *
 * They used to be declared inline in the server-function file, which
 * cannot be imported by a test — so the rules about what the outside world
 * may send were the one part of the module nothing could check.
 */

const draft = {
  startedAt: 1_755_000_000,
  durationS: 1800,
  distanceM: 5000,
  indoor: true,
  title: "Evening run",
};

describe("manualRunInput", () => {
  it("takes a run draft with an idempotency key, and without one", () => {
    const key = newUlid();
    expect(
      manualRunInput.parse({ ...draft, idempotencyKey: key }),
    ).toMatchObject({
      idempotencyKey: key,
    });
    expect(manualRunInput.parse(draft).idempotencyKey).toBeUndefined();
  });

  it("refuses a key that is not a ULID", () => {
    // Law 8b: the key is the UNIQUE index's other half, so a client that
    // invents its own format must not be able to widen it.
    expect(() =>
      manualRunInput.parse({ ...draft, idempotencyKey: "not-a-ulid" }),
    ).toThrow();
  });

  it("still enforces the run contract underneath", () => {
    expect(() => manualRunInput.parse({ ...draft, durationS: 0 })).toThrow();
  });
});

describe("the id inputs", () => {
  it("take a non-empty id and refuse an empty one", () => {
    expect(importIdInput.parse({ importId: "abc" })).toStrictEqual({
      importId: "abc",
    });
    expect(runIdInput.parse({ runId: "abc" })).toStrictEqual({ runId: "abc" });
    expect(() => importIdInput.parse({ importId: "" })).toThrow();
    expect(() => runIdInput.parse({ runId: "" })).toThrow();
    expect(() => runIdInput.parse({})).toThrow();
  });
});

describe("conditionsBandInput", () => {
  it("takes one of the bands R2b offers, at either end", () => {
    const runId = newUlid();
    expect(
      conditionsBandInput.parse({ runId, bandFloorC: -20, sky: "dry" }),
    ).toStrictEqual({
      runId,
      bandFloorC: -20,
      sky: "dry",
    });
    expect(
      conditionsBandInput.parse({ runId, bandFloorC: 35, sky: "snow" })
        .bandFloorC,
    ).toBe(35);
  });

  it("refuses a number R2b never offered — a typed one, or one off the list", () => {
    const runId = newUlid();
    for (const bandFloorC of [12, -25, 40, 12.5]) {
      const result = conditionsBandInput.safeParse({
        runId,
        bandFloorC,
        sky: "rain",
      });
      expect(result.success, String(bandFloorC)).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Pick one of the bands.");
    }
    expect(
      conditionsBandInput.safeParse({
        runId: "01RUN",
        bandFloorC: 10,
        sky: "rain",
      }).success,
    ).toBe(false);
  });

  it("requires one of the four skies (round 26, item 2)", () => {
    const runId = newUlid();
    expect(
      conditionsBandInput.safeParse({ runId, bandFloorC: 10 }).success,
    ).toBe(false);
    expect(
      conditionsBandInput.safeParse({ runId, bandFloorC: 10, sky: "fog" })
        .success,
    ).toBe(false);
  });
});

describe("retimeRunInput", () => {
  it("takes the new start itself, in whole seconds, never a shift", () => {
    const runId = newUlid();
    expect(
      retimeRunInput.parse({ runId, startedAt: 1_755_000_000 }).startedAt,
    ).toBe(1_755_000_000);
    expect(retimeRunInput.parse({ runId, startedAt: 0 }).startedAt).toBe(0);
    expect(retimeRunInput.safeParse({ runId, startedAt: -1 }).success).toBe(
      false,
    );
    expect(retimeRunInput.safeParse({ runId, startedAt: 1.5 }).success).toBe(
      false,
    );
    expect(retimeRunInput.safeParse({ runId, shiftS: 600 }).success).toBe(
      false,
    );
  });
});

describe("stravaCallbackSearch", () => {
  it("takes the three params Strava can send back", () => {
    expect(
      stravaCallbackSearch.parse({ code: "c", state: "s", error: "e" }),
    ).toStrictEqual({ code: "c", state: "s", error: "e" });
  });

  it("is looser than the POST input on purpose", () => {
    // `validateSearch` runs before anything else and throws if it refuses,
    // so a redirect carrying `?code=` with nothing after it would blow up
    // the route rather than reach `stravaCallbackOutcome`, whose whole job
    // is to answer "no" politely.
    expect(stravaCallbackSearch.parse({ code: "" })).toStrictEqual({
      code: "",
    });
    expect(() => stravaCallbackInput.parse({ code: "" })).toThrow();
  });

  it("takes a callback with nothing on it at all", () => {
    expect(stravaCallbackSearch.parse({})).toStrictEqual({});
  });

  it("still refuses a param of the wrong type", () => {
    expect(() => stravaCallbackSearch.parse({ code: 7 })).toThrow();
  });
});

describe("stravaCallbackInput", () => {
  it("takes a callback with everything, and one with nothing", () => {
    expect(stravaCallbackInput.parse({ code: "c", state: "s" })).toStrictEqual({
      code: "c",
      state: "s",
    });
    // Strava sends `error=access_denied` with no code or state when the
    // user declines, so every field has to be optional.
    expect(stravaCallbackInput.parse({ error: "access_denied" })).toStrictEqual(
      {
        error: "access_denied",
      },
    );
    expect(stravaCallbackInput.parse({})).toStrictEqual({});
  });

  it("treats an empty code or state as absent rather than as a value", () => {
    expect(() => stravaCallbackInput.parse({ code: "" })).toThrow();
    expect(() => stravaCallbackInput.parse({ state: "" })).toThrow();
  });
});

function upload(file?: File | string, field = "file"): FormData {
  const form = new FormData();
  if (file !== undefined) form.append(field, file);
  return form;
}

function fileOfSize(bytes: number): File {
  return new File([new Uint8Array(bytes)], "run.gpx");
}

describe("importUploadFrom", () => {
  it("pulls the file out of a multipart body", () => {
    const file = fileOfSize(10);
    expect(importUploadFrom(upload(file)).file).toBe(file);
  });

  it("refuses a body that is not multipart at all", () => {
    expect(() => importUploadFrom({ file: "run.gpx" })).toThrow(
      ImportUploadError,
    );
    expect(() => importUploadFrom(undefined)).toThrow(
      /Expected multipart form data/,
    );
  });

  it("refuses a form with no file on it", () => {
    expect(() => importUploadFrom(upload())).toThrow(/No file was attached/);
    // A text field named `file` is not a file.
    expect(() => importUploadFrom(upload("run.gpx"))).toThrow(
      /No file was attached/,
    );
    // Neither is a file under some other name.
    const underAnotherName = upload(fileOfSize(10), "run");
    expect(() => importUploadFrom(underAnotherName)).toThrow(
      /No file was attached/,
    );
  });

  it("takes a file of exactly the cap and refuses one byte more", () => {
    // `>`, not `>=`, and checked before the bytes are read — an oversized
    // upload is refused without being allocated.
    const atTheCap = upload(fileOfSize(MAX_IMPORT_BYTES));
    const overIt = upload(fileOfSize(MAX_IMPORT_BYTES + 1));

    expect(importUploadFrom(atTheCap).file.size).toBe(MAX_IMPORT_BYTES);
    expect(() => importUploadFrom(overIt)).toThrow(/larger than 25 MB/);
  });

  it("carries the key a retry of the same upload is sent under", () => {
    const key = newUlid();
    const form = upload(fileOfSize(10));
    form.append("idempotencyKey", key);

    expect(importUploadFrom(form).idempotencyKey).toBe(key);
  });

  it("takes an upload with no key at all, and refuses one that is not a ULID", () => {
    const keyless = upload(fileOfSize(10));
    expect(importUploadFrom(keyless).idempotencyKey).toBeUndefined();
    const form = upload(fileOfSize(10));
    form.append("idempotencyKey", "not-a-key");
    expect(() => importUploadFrom(form)).toThrow();
  });
});
