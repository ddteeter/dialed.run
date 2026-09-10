import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import { ImportUploadError, MAX_IMPORT_BYTES } from "../../src/modules/runs/imports";
import {
  importIdInput,
  importUploadFrom,
  manualRunInput,
  manualTempInput,
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
    expect(manualRunInput.parse({ ...draft, idempotencyKey: key })).toMatchObject({
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

describe("manualTempInput", () => {
  it("takes the ends of the habitable range", () => {
    expect(manualTempInput.parse({ runId: "01RUN", tempC: -60 }).tempC).toBe(-60);
    expect(manualTempInput.parse({ runId: "01RUN", tempC: 60 }).tempC).toBe(60);
  });

  it("refuses a temperature nobody ran in", () => {
    // Outside this range is a typo or a unit mix-up (°F typed into a °C
    // field), and it would poison the fallback it exists to feed.
    expect(() => manualTempInput.parse({ runId: "01RUN", tempC: -61 })).toThrow();
    expect(() => manualTempInput.parse({ runId: "01RUN", tempC: 61 })).toThrow();
    expect(() => manualTempInput.parse({ runId: "01RUN", tempC: "10" })).toThrow();
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
    expect(stravaCallbackSearch.parse({ code: "" })).toStrictEqual({ code: "" });
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
    expect(
      stravaCallbackInput.parse({ code: "c", state: "s" }),
    ).toStrictEqual({ code: "c", state: "s" });
    // Strava sends `error=access_denied` with no code or state when the
    // user declines, so every field has to be optional.
    expect(stravaCallbackInput.parse({ error: "access_denied" })).toStrictEqual({
      error: "access_denied",
    });
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
});
