/**
 * Zips built to order for the Garmin download's reader: synthetic, never a
 * real download (plan 160). Only the fields the reader looks at are
 * filled; the CRCs are zero, because it checks none.
 */

interface ZipOptions {
  method?: "stored" | "deflated";
  /**
  Entries in the archive: the reader takes exactly one.
  */
  entries?: number;
  /**
  What the directory says the file inflates to.
  */
  statedSize?: number;
  /**
  Bytes of comment after the end record.
  */
  comment?: number;
  /**
  Replace the compressed data with these bytes.
  */
  data?: Uint8Array;
  /**
  Bytes before the local header, as a self-extracting archive has.
  */
  prefix?: number;
  /**
  Where the sizes are written. `"descriptor"`, the default, is Garmin's
  own layout (measured against real downloads, 2026-10-27): flags 0x808,
  the local header's sizes zero, and the sizes in a data descriptor after
  the data, so only the directory says how big the entry is.
  `"local-header"` writes them in the local header instead.
  */
  sizes?: "descriptor" | "local-header";
}

/**
Bit 3 (sizes in a data descriptor) and bit 11 (UTF-8 names), as Garmin sets.
*/
const DESCRIPTOR_FLAGS = 0x08_08;
const DESCRIPTOR_SIZE = 16;

async function deflate(bytes: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function zipOf(
  content: ArrayBuffer,
  options: ZipOptions = {},
): Promise<ArrayBuffer> {
  const plain = new Uint8Array(content);
  const isDeflated = (options.method ?? "deflated") === "deflated";
  const data = options.data ?? (isDeflated ? await deflate(content) : plain);
  const name = new TextEncoder().encode("1_ACTIVITY.fit");
  const method = isDeflated ? 8 : 0;
  const size = options.statedSize ?? plain.byteLength;
  const entries = options.entries ?? 1;
  const comment = options.comment ?? 0;
  const local = options.prefix ?? 0;
  const hasDescriptor = (options.sizes ?? "descriptor") === "descriptor";
  const flags = hasDescriptor ? DESCRIPTOR_FLAGS : 0;

  const localSize = 30 + name.length;
  const directorySize = 46 + name.length;
  const descriptorAt = local + localSize + data.length;
  const directoryAt = descriptorAt + (hasDescriptor ? DESCRIPTOR_SIZE : 0);
  const total = directoryAt + directorySize + 22 + comment;
  const zip = new Uint8Array(total);
  const view = new DataView(zip.buffer);

  // [offset from the record's start, byte width, value], little-endian.
  const write = (at: number, fields: [number, 2 | 4, number][]) => {
    for (const [offset, width, value] of fields) {
      if (width === 2) view.setUint16(at + offset, value, true);
      else view.setUint32(at + offset, value, true);
    }
  };

  write(local, [
    [0, 4, 0x04_03_4b_50],
    [6, 2, flags],
    [8, 2, method],
    [18, 4, hasDescriptor ? 0 : data.length],
    [22, 4, hasDescriptor ? 0 : size],
    [26, 2, name.length],
  ]);
  zip.set(name, local + 30);
  zip.set(data, local + localSize);
  if (hasDescriptor) {
    write(descriptorAt, [
      [0, 4, 0x08_07_4b_50],
      [8, 4, data.length],
      [12, 4, size],
    ]);
  }

  write(directoryAt, [
    [0, 4, 0x02_01_4b_50],
    [8, 2, flags],
    [10, 2, method],
    [20, 4, data.length],
    [24, 4, size],
    [28, 2, name.length],
    [42, 4, local],
  ]);
  zip.set(name, directoryAt + 46);

  write(directoryAt + directorySize, [
    [0, 4, 0x06_05_4b_50],
    [8, 2, entries],
    [10, 2, entries],
    [12, 4, directorySize],
    [16, 4, directoryAt],
    [20, 2, comment],
  ]);
  return zip.buffer;
}

/**
 * How an archive is laid out, by the fields the reader depends on: what
 * `npm run garmin:check` compares between a real download and `zipOf`'s,
 * so these synthetic zips cannot drift from Garmin's.
 */
export interface ZipLayout {
  entries: number;
  method: number;
  flags: number;
  localSizesZero: boolean;
}

export function zipLayoutOf(zip: ArrayBuffer): ZipLayout {
  const view = new DataView(zip);
  let end = zip.byteLength - 22;
  while (end > 0 && view.getUint32(end, true) !== 0x06_05_4b_50) end -= 1;
  const directoryAt = view.getUint32(end + 16, true);
  const localAt = view.getUint32(directoryAt + 42, true);
  return {
    entries: view.getUint16(end + 10, true),
    method: view.getUint16(directoryAt + 10, true),
    flags: view.getUint16(directoryAt + 8, true),
    localSizesZero:
      view.getUint32(localAt + 18, true) === 0 &&
      view.getUint32(localAt + 22, true) === 0,
  };
}
