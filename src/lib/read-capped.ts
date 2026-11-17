/**
 * Read a body, at most `limit` bytes of it, and stop reading when it
 * passes them.
 *
 * A cap applied to an already-buffered body is not a cap: by the time you
 * can measure it you have already held it in a 128 MB isolate.
 * Content-Length is a claim, not a measurement, so it is used only as an
 * early reject.
 *
 * Shared by the enrichment fetch, which reads a shop's page, the speed
 * beacon, which reads a stranger's POST, the Garmin download (SA-L17) and
 * every request body (SA-L05). Each names its own failure, so `tooLarge` builds the
 * error from what went over: `declares N bytes` or `exceeded N bytes`. A
 * message with no body reads as empty.
 */
export async function readCappedText(
  message: Request | Response,
  limit: number,
  tooLarge: (detail: string) => Error,
): Promise<string> {
  return new TextDecoder().decode(
    await readCappedBytes(message, limit, tooLarge),
  );
}

/**
 * `readCappedText`'s bytes, undecoded.
 */
export async function readCappedBytes(
  message: Request | Response,
  limit: number,
  tooLarge: (detail: string) => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  // `Number(null)` is 0, so a missing header needs no branch of its own.
  const claimed = Number(message.headers.get("content-length"));
  if (claimed > limit) throw tooLarge(`declares ${String(claimed)} bytes`);
  return readCappedStream(message.body, limit, tooLarge);
}

/**
 * A stream's bytes, refused as soon as they pass `limit`: what is read
 * past it is never held.
 */
async function readCappedStream(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  tooLarge: (detail: string) => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (body !== null) {
    const reader = body.getReader();
    try {
      let isDone = false;
      while (!isDone) {
        const chunk = await reader.read();
        isDone = chunk.done;
        if (chunk.value === undefined) continue;
        total += chunk.value.byteLength;
        if (total > limit) throw tooLarge(`exceeded ${String(limit)} bytes`);
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
