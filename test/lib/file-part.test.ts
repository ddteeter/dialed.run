import { describe, expect, it } from "vitest";

import { filePartFrom } from "../../src/lib/file-part";

/**
 * The three refusals every multipart upload makes. Each is asserted by the
 * *problem* it reports, not by a boolean: the caller maps the problem to
 * its own sentence, so a helper that confused two of them would hand a
 * screen the wrong copy and no `toBe(false)` would notice.
 */
function form(parts: Readonly<Record<string, FormDataEntryValue>>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(parts)) data.append(name, value);
  return data;
}

describe("filePartFrom", () => {
  it("hands back the file and the form it came out of", () => {
    const file = new File(["hi"], "run.gpx");
    const body = form({ file, other: "kept" });

    const part = filePartFrom(body, "file", 100);

    expect(part.ok).toBe(true);
    if (!part.ok) throw new Error("expected ok");
    expect(part.file).toBe(file);
    // The form comes back so a caller needing the *other* parts does not
    // have to re-narrow `unknown` with a branch nothing can reach.
    expect(part.form.get("other")).toBe("kept");
  });

  it("refuses a body that is not a form at all", () => {
    expect(filePartFrom("not a form", "file", 100)).toStrictEqual({
      ok: false,
      problem: "not-form-data",
    });
  });

  it("refuses a form whose named part is absent", () => {
    expect(filePartFrom(form({}), "file", 100)).toStrictEqual({
      ok: false,
      problem: "missing",
    });
  });

  it("refuses a part that is a field rather than a file", () => {
    // A text field under the right name is the near-miss worth pinning:
    // `get` returns it happily, and only the `instanceof File` check
    // separates it from an upload.
    expect(filePartFrom(form({ file: "just text" }), "file", 100)).toStrictEqual(
      { ok: false, problem: "missing" },
    );
  });

  it("refuses a file over the cap, by its declared size", () => {
    const file = new File(["0123456789"], "big.gpx");

    expect(filePartFrom(form({ file }), "file", 9)).toStrictEqual({
      ok: false,
      problem: "too-large",
    });
  });

  it("accepts a file exactly at the cap", () => {
    // `>` not `>=`: the cap is the largest allowed size, not the first
    // refused one.
    const file = new File(["0123456789"], "exact.gpx");

    expect(filePartFrom(form({ file }), "file", 10).ok).toBe(true);
  });

  it("looks only at the part it was asked for", () => {
    const wanted = new File(["a"], "wanted.gpx");
    const body = form({ photo: new File(["b"], "other.jpg"), file: wanted });

    const part = filePartFrom(body, "file", 100);

    if (!part.ok) throw new Error("expected ok");
    expect(part.file).toBe(wanted);
  });
});
