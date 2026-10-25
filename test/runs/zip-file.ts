/**
 * Zips built to order for the Garmin download's reader: synthetic, never a
 * real download (plan 157). Only the fields the reader looks at are
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
}

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

  const localSize = 30 + name.length;
  const directorySize = 46 + name.length;
  const directoryAt = local + localSize + data.length;
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
    [8, 2, method],
    [18, 4, data.length],
    [22, 4, size],
    [26, 2, name.length],
  ]);
  zip.set(name, local + 30);
  zip.set(data, local + localSize);

  write(directoryAt, [
    [0, 4, 0x02_01_4b_50],
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
