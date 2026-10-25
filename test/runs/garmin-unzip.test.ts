import { describe, expect, it } from "vitest";

import { MAX_IMPORT_BYTES } from "../../src/modules/runs/upload-limits";
import { UnzipError, onlyFileIn } from "../../src/modules/runs/garmin/unzip";
import { zipOf } from "./zip-file";

const CONTENT = new TextEncoder().encode(
  "a synthetic file, long enough that deflate shortens it. ".repeat(20),
).buffer;

function bytesOf(buffer: ArrayBuffer): number[] {
  return [...new Uint8Array(buffer)];
}

async function refusal(zip: ArrayBuffer): Promise<string> {
  try {
    await onlyFileIn(zip);
  } catch (error) {
    if (error instanceof UnzipError) return error.message;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("onlyFileIn", () => {
  it("inflates the one deflated entry Garmin sends", async () => {
    const zip = await zipOf(CONTENT);
    expect(zip.byteLength).toBeLessThan(CONTENT.byteLength);
    expect(bytesOf(await onlyFileIn(zip))).toEqual(bytesOf(CONTENT));
  });

  it("reads a stored entry as it is", async () => {
    const zip = await zipOf(CONTENT, { method: "stored" });
    expect(bytesOf(await onlyFileIn(zip))).toEqual(bytesOf(CONTENT));
  });

  it("finds the end record behind a comment", async () => {
    const zip = await zipOf(CONTENT, { comment: 300 });
    expect(bytesOf(await onlyFileIn(zip))).toEqual(bytesOf(CONTENT));
  });

  it("finds the end record at the very start of a tiny archive", async () => {
    const zip = await zipOf(new ArrayBuffer(0), { method: "stored" });
    const file = await onlyFileIn(zip);
    expect(file.byteLength).toBe(0);
  });

  it("finds a local header that does not start the file", async () => {
    const zip = await zipOf(CONTENT, { prefix: 5 });
    expect(bytesOf(await onlyFileIn(zip))).toEqual(bytesOf(CONTENT));
  });

  it("reads an end record that is the whole archive", async () => {
    // An empty archive is nothing but its 22-byte end record, at offset 0.
    const empty = new ArrayBuffer(22);
    new DataView(empty).setUint32(0, 0x06_05_4b_50, true);
    expect(await refusal(empty)).toBe("unzip: not exactly one entry");
  });

  it("reads an entry whose data runs to the archive's last byte", async () => {
    // Stated so the entry ends exactly at the end: not past it, so not
    // truncated, however unlikely the archive.
    const zip = await zipOf(CONTENT, { method: "stored" });
    const view = new DataView(zip);
    const directoryAt = view.getUint32(zip.byteLength - 22 + 16, true);
    const dataStart = 30 + view.getUint16(26, true);
    const toEnd = zip.byteLength - dataStart;
    view.setUint32(directoryAt + 20, toEnd, true);
    view.setUint32(directoryAt + 24, toEnd, true);
    const file = await onlyFileIn(zip);
    expect(file.byteLength).toBe(toEnd);
  });

  it("names its refusals as its own", async () => {
    const refused = onlyFileIn(new ArrayBuffer(64));
    await expect(refused).rejects.toBeInstanceOf(UnzipError);
    await expect(refused).rejects.toHaveProperty("name", "UnzipError");
  });

  it("refuses what is not a zip", async () => {
    expect(await refusal(new ArrayBuffer(64))).toBe(
      "unzip: no end-of-directory record",
    );
    expect(await refusal(new ArrayBuffer(4))).toBe(
      "unzip: no end-of-directory record",
    );
  });

  it("refuses more than one entry", async () => {
    expect(await refusal(await zipOf(CONTENT, { entries: 2 }))).toBe(
      "unzip: not exactly one entry",
    );
  });

  it("refuses an entry larger than an upload may be", async () => {
    expect(
      await refusal(await zipOf(CONTENT, { statedSize: MAX_IMPORT_BYTES + 1 })),
    ).toBe("unzip: entry too large");
  });

  it("takes an entry exactly at the upload limit's size check", async () => {
    // The limit itself is allowed; only the stated size differs, so the
    // refusal is the size check after inflating.
    expect(
      await refusal(await zipOf(CONTENT, { statedSize: MAX_IMPORT_BYTES })),
    ).toBe("unzip: wrong size");
  });

  it("refuses contents that inflate to a size other than stated", async () => {
    expect(
      await refusal(
        await zipOf(CONTENT, { statedSize: CONTENT.byteLength - 1 }),
      ),
    ).toBe("unzip: wrong size");
  });

  it("refuses contents that do not inflate", async () => {
    const garbage = new Uint8Array([0xff, 0xff, 0xff]);
    const zip = await zipOf(CONTENT, { data: garbage });
    expect(await refusal(zip)).toBe("unzip: does not inflate");
  });

  it("refuses a method it does not read", async () => {
    const zip = await zipOf(CONTENT);
    const view = new DataView(zip);
    const directoryAt = view.getUint32(zip.byteLength - 22 + 16, true);
    view.setUint16(directoryAt + 10, 12, true);
    expect(await refusal(zip)).toBe("unzip: unsupported method");
  });

  it("refuses an archive cut short", async () => {
    const zip = await zipOf(CONTENT);
    const view = new DataView(zip);
    const directoryAt = view.getUint32(zip.byteLength - 22 + 16, true);
    view.setUint32(directoryAt + 20, zip.byteLength, true);
    expect(await refusal(zip)).toBe("unzip: truncated");
  });

  it("refuses a directory that points past the end", async () => {
    const zip = await zipOf(CONTENT);
    new DataView(zip).setUint32(zip.byteLength - 22 + 16, zip.byteLength, true);
    expect(await refusal(zip)).toBe("unzip: truncated");
  });

  it("refuses a directory that points at nothing", async () => {
    const zip = await zipOf(CONTENT);
    const view = new DataView(zip);
    const end = zip.byteLength - 22;
    const directoryAt = view.getUint32(end + 16, true);
    view.setUint32(directoryAt, 0, true);
    expect(await refusal(zip)).toBe("unzip: no directory entry");
  });

  it("refuses a directory entry with no local header behind it", async () => {
    const zip = await zipOf(CONTENT);
    new DataView(zip).setUint32(0, 0, true);
    expect(await refusal(zip)).toBe("unzip: no local header");
  });

  it("skips the local header's own name and extra field", async () => {
    // A local extra field the directory does not have: the data starts
    // after it, so reading the directory's lengths would misplace it.
    const plain = await zipOf(CONTENT, { method: "stored" });
    const source = new Uint8Array(plain);
    const view = new DataView(plain);
    const nameLength = view.getUint16(26, true);
    const extra = 5;
    const shifted = new Uint8Array(plain.byteLength + extra);
    shifted.set(source.subarray(0, 30 + nameLength), 0);
    shifted.set(source.subarray(30 + nameLength), 30 + nameLength + extra);
    const out = new DataView(shifted.buffer);
    out.setUint16(28, extra, true);
    const end = shifted.byteLength - 22;
    const directoryAt = out.getUint32(end + 16, true) + extra;
    out.setUint32(end + 16, directoryAt, true);
    expect(bytesOf(await onlyFileIn(shifted.buffer))).toEqual(bytesOf(CONTENT));
  });
});
