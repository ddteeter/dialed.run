/**
 * Read a body's text, at most `limit` bytes of it, and stop reading when
 * it passes them.
 *
 * A cap applied to an already-buffered body is not a cap: by the time you
 * can measure it you have already held it in a 128 MB isolate.
 * Content-Length is a claim, not a measurement, so it is used only as an
 * early reject.
 *
 * Shared by the enrichment fetch, which reads a shop's page, and the speed
 * beacon, which reads a stranger's POST. Each names its own failure, so
 * `tooLarge` builds the error from what went over: `declares N bytes` or
 * `exceeded N bytes`. A message with no body reads as "".
 */
export async function readCappedText(
  message: Request | Response,
  limit: number,
  tooLarge: (detail: string) => Error,
): Promise<string> {
  // `Number(null)` is 0, so a missing header needs no branch of its own.
  const claimed = Number(message.headers.get("content-length"));
  if (claimed > limit) throw tooLarge(`declares ${String(claimed)} bytes`);
  const body = message.body;
  if (body === null) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    let isDone = false;
    while (!isDone) {
      const chunk = await reader.read();
      isDone = chunk.done;
      if (chunk.value === undefined) continue;
      total += chunk.value.byteLength;
      if (total > limit) throw tooLarge(`exceeded ${String(limit)} bytes`);
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return text + decoder.decode();
}
