/**
 * Every object under an R2 prefix, a page at a time. A listing returns at
 * most `pageSize` objects (R2's own cap is a thousand) and a cursor for
 * the rest; this follows the cursor so a caller cannot stop at the first
 * page by forgetting to.
 *
 * `pageSize` is a parameter so a test can exercise the cursor without
 * writing a thousand objects.
 */
export async function* listedPages(
  bucket: Pick<R2Bucket, "list">,
  prefix: string,
  pageSize = 1000,
): AsyncGenerator<R2Object[]> {
  const options: R2ListOptions = { prefix, limit: pageSize };
  for (;;) {
    const page = await bucket.list(options);
    yield page.objects;
    if (!page.truncated) return;
    options.cursor = page.cursor;
  }
}
