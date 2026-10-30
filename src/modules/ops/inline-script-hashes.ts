/**
 * The hashes a stored page's policy admits its inline scripts by (design
 * 161).
 *
 * A page the edge keeps is served to every visitor, so it cannot carry a
 * per-request nonce: the stored copy would hand the same nonce to all of
 * them. Its policy names the SHA-256 of each inline script instead, read
 * from the page itself. That means waiting for the whole body before the
 * headers can leave, which is fine for the open web's pages: they are
 * small, and the edge serves the stored copy after the first.
 *
 * The platform's own `HTMLRewriter` reads the page, so a `<script` inside
 * an attribute or a comment is never mistaken for a script, and a
 * script's text is exactly the raw text the browser hashes.
 */

/**
 * The page, buffered, and the base64 SHA-256 of each distinct inline
 * script in it, in document order. A response that is not HTML, or has no
 * body, has no scripts and comes back as it was.
 */
export async function withInlineScriptHashes(
  response: Response,
): Promise<{ page: Response; hashes: string[] }> {
  const type = String(response.headers.get("Content-Type"));
  if (response.body === null || !type.includes("text/html")) {
    return { page: response, hashes: [] };
  }
  // Each inline script's text, as the chunks the rewriter hands over.
  const scripts: string[][] = [];
  let current: string[] | undefined;
  const html = await new HTMLRewriter()
    .on("script", {
      element(element) {
        // A script with a `src` is a file, admitted by `'self'`; any text
        // inside it never runs.
        current = element.hasAttribute("src") ? undefined : [];
        if (current !== undefined) scripts.push(current);
      },
      text(chunk) {
        current?.push(chunk.text);
      },
    })
    .transform(response)
    .text();
  const hashes = await Promise.all(
    scripts.map((chunks) => sha256(chunks.join(""))),
  );
  return { page: new Response(html, response), hashes: [...new Set(hashes)] };
}

/**
 * The base64 SHA-256 of a script's text as the browser hashes it: after
 * the HTML parser has turned every CRLF and lone CR into LF.
 */
async function sha256(script: string): Promise<string> {
  const text = script.replaceAll(/\r\n?/gu, "\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return btoa(String.fromCodePoint(...new Uint8Array(digest)));
}
