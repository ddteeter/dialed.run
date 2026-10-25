/**
 * The one file inside the zip Garmin's download hands back (plan 157:
 * `<activityId>_ACTIVITY.fit`, one deflated entry).
 *
 * A small reader rather than a dependency: the repo's zip library
 * (`client-zip`) only writes, and Workers inflate natively with
 * `DecompressionStream("deflate-raw")`. It reads the central directory, not
 * the local header, because a local header written with a data descriptor
 * carries no sizes. It checks no CRC: the FIT file has its own, and the
 * parser refuses a file that fails it.
 */
import { MAX_IMPORT_BYTES } from "../upload-limits";

export class UnzipError extends Error {
  constructor(reason: string) {
    super(`unzip: ${reason}`);
    this.name = "UnzipError";
  }
}

const END_OF_DIRECTORY = 0x06_05_4b_50;
const DIRECTORY_ENTRY = 0x02_01_4b_50;
const LOCAL_HEADER = 0x04_03_4b_50;
const END_OF_DIRECTORY_SIZE = 22;
// The end record ends with a comment of up to 65,535 bytes, so it is found
// by searching back from the end at most that far.
const MAX_COMMENT = 0xff_ff;
const STORED = 0;
const DEFLATED = 8;

function endOfDirectoryAt(view: DataView): number {
  const last = view.byteLength - END_OF_DIRECTORY_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let offset = last; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  throw new UnzipError("no end-of-directory record");
}

interface Entry {
  method: number;
  compressedSize: number;
  size: number;
  dataStart: number;
}

function onlyEntry(view: DataView): Entry {
  const end = endOfDirectoryAt(view);
  if (view.getUint16(end + 10, true) !== 1) {
    throw new UnzipError("not exactly one entry");
  }
  const directory = view.getUint32(end + 16, true);
  if (view.getUint32(directory, true) !== DIRECTORY_ENTRY) {
    throw new UnzipError("no directory entry");
  }
  const local = view.getUint32(directory + 42, true);
  if (view.getUint32(local, true) !== LOCAL_HEADER) {
    throw new UnzipError("no local header");
  }
  return {
    method: view.getUint16(directory + 10, true),
    compressedSize: view.getUint32(directory + 20, true),
    size: view.getUint32(directory + 24, true),
    // The local header's own name and extra lengths, which need not match
    // the directory's.
    dataStart:
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true),
  };
}

async function inflated(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).arrayBuffer();
}

/**
The bytes of the zip's only file. Refuses anything else: more than one
entry, a method other than stored or deflated, an entry past the upload
limit, or contents that do not inflate to the size the directory states.
*/
export async function onlyFileIn(zip: ArrayBuffer): Promise<ArrayBuffer> {
  let entry: Entry;
  try {
    entry = onlyEntry(new DataView(zip));
  } catch (error) {
    if (error instanceof UnzipError) throw error;
    // A DataView read past the end: a truncated archive.
    throw new UnzipError("truncated");
  }
  if (entry.size > MAX_IMPORT_BYTES) throw new UnzipError("entry too large");
  const end = entry.dataStart + entry.compressedSize;
  if (end > zip.byteLength) throw new UnzipError("truncated");
  const data = zip.slice(entry.dataStart, end);

  let bytes: ArrayBuffer;
  if (entry.method === STORED) {
    bytes = data;
  } else if (entry.method === DEFLATED) {
    try {
      bytes = await inflated(data);
    } catch {
      throw new UnzipError("does not inflate");
    }
  } else {
    throw new UnzipError("unsupported method");
  }
  if (bytes.byteLength !== entry.size) throw new UnzipError("wrong size");
  return bytes;
}
