/**
 * Just enough of a ZIP reader to open the export in a test: the central
 * directory's names, and each stored file's bytes, checked against the
 * CRC the archive claims. `client-zip` stores rather than deflates, so
 * method 0 is the only one read; anything else fails the test.
 */

const EOCD = 0x06_05_4b_50;
const CENTRAL = 0x02_01_4b_50;
const LOCAL = 0x04_03_4b_50;
const ZIP64_EXTRA = 0x00_01;
const ALL_ONES = 0xff_ff_ff_ff;

function crc32(bytes: Uint8Array): number {
  let crc = ALL_ONES;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
  }
  return (crc ^ ALL_ONES) >>> 0;
}

/**
A ZIP64 extra field's values, in the order the spec lists them.
*/
function zip64Values(view: DataView, start: number, length: number): bigint[] {
  let at = start;
  while (at < start + length) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === ZIP64_EXTRA) {
      const values: bigint[] = [];
      for (let offset = 0; offset < size; offset += 8) {
        values.push(view.getBigUint64(at + 4 + offset, true));
      }
      return values;
    }
    at += 4 + size;
  }
  return [];
}

/**
 * The size and offset one central entry names: its own 32-bit fields, or
 * — where one is all ones — the ZIP64 field's value in its place.
 */
function sizeAndOffset(
  view: DataView,
  at: number,
  wide: bigint[],
): { size: number; offset: number } {
  const values = [...wide];
  const narrowSize = view.getUint32(at + 24, true);
  const size = narrowSize === ALL_ONES ? Number(values.shift()) : narrowSize;
  if (view.getUint32(at + 20, true) === ALL_ONES) values.shift();
  const narrowOffset = view.getUint32(at + 42, true);
  const offset =
    narrowOffset === ALL_ONES ? Number(values.shift()) : narrowOffset;
  return { size, offset };
}

/**
 * The MS-DOS date/time a central-directory entry carries at `at+12`
 * (time) and `at+14` (date), decoded with the same local-calendar fields
 * `client-zip`'s own encoder writes them with (`getSeconds`, `getMinutes`,
 * `getHours`, `getDate`, `getMonth`, `getFullYear`) — so a round trip
 * through this reads back whatever `Date` the build actually stamped,
 * rather than assuming a timezone the encoder never asserted.
 */
function dosModified(view: DataView, at: number): Date {
  const time = view.getUint16(at + 12, true);
  const date = view.getUint16(at + 14, true);
  const seconds = (time & 0x1f) * 2;
  const minutes = (time >> 5) & 0x3f;
  const hours = (time >> 11) & 0x1f;
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = ((date >> 9) & 0x7f) + 1980;
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
One central-directory entry at `at`: its name, its bytes, when it says it
was modified, and where the next begins.
*/
function readEntry(bytes: Uint8Array, view: DataView, at: number) {
  if (view.getUint32(at, true) !== CENTRAL) {
    throw new Error("not a central directory entry");
  }
  const nameLength = view.getUint16(at + 28, true);
  const extraLength = view.getUint16(at + 30, true);
  const commentLength = view.getUint16(at + 32, true);
  const name = new TextDecoder().decode(
    bytes.subarray(at + 46, at + 46 + nameLength),
  );
  if (view.getUint16(at + 10, true) !== 0) {
    throw new Error(`${name} is not stored`);
  }
  const modified = dosModified(view, at);
  const wide = zip64Values(view, at + 46 + nameLength, extraLength);
  const { size, offset } = sizeAndOffset(view, at, wide);
  if (view.getUint32(offset, true) !== LOCAL) {
    throw new Error(`${name} has no local header`);
  }
  const start =
    offset +
    30 +
    view.getUint16(offset + 26, true) +
    view.getUint16(offset + 28, true);
  const data = bytes.slice(start, start + size);
  if (crc32(data) !== view.getUint32(at + 16, true)) {
    throw new Error(`${name} fails its CRC`);
  }
  return {
    name,
    data,
    modified,
    next: at + 46 + nameLength + extraLength + commentLength,
  };
}

export function readZip(buffer: ArrayBuffer): {
  names: string[];
  files: Map<string, Uint8Array>;
  modified: Map<string, Date>;
} {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== EOCD) end -= 1;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names: string[] = [];
  const files = new Map<string, Uint8Array>();
  const modified = new Map<string, Date>();
  for (let index = 0; index < count; index += 1) {
    const entry = readEntry(bytes, view, at);
    names.push(entry.name);
    files.set(entry.name, entry.data);
    modified.set(entry.name, entry.modified);
    at = entry.next;
  }
  return { names, files, modified };
}

export function textOf(files: Map<string, Uint8Array>, name: string): string {
  const data = files.get(name);
  if (data === undefined) throw new Error(`${name} is not in the ZIP`);
  return new TextDecoder().decode(data);
}
