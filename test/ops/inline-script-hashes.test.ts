import { describe, expect, it } from "vitest";

import { withInlineScriptHashes } from "../../src/modules/ops/inline-script-hashes";

/**
 * The hashes a stored page's policy admits its inline scripts by (design
 * 163). The expected digests are fixed vectors, computed outside the app
 * (`base64(sha256(text))`), so the test does not restate the code.
 */

const HASH = {
  alert: "bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI=",
  x: "D6IGS8VMvCoyaR/l0h9tERrBTATY01CoPS7l6xDv0kI=",
  empty: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  // "a();\nb();\nc();" — what the browser hashes once the parser has
  // turned the CRLF and the lone CR into LF.
  lines: "VdchsQXMF4B+6HyWonTG3jDVuro98k0jCZ1GcYTVXu4=",
  split: "ziZc3HscjswFgnu8vjK9v44EL2luhD/qztOd9J7pR6I=",
};

const HTML = { "Content-Type": "text/html; charset=utf-8" };

/**
A page whose body arrives in `parts`, one stream chunk each.
*/
function streamed(parts: readonly string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Response(body, { headers: HTML, ...init });
}

const PAGE = [
  "<!doctype html><html><head>",
  "<script>alert(1)</script>",
  '<script type="module" src="/assets/app.js"></script>',
  '<script src="/assets/b.js">never()</script>',
  "<!-- <script>commented()</script> -->",
  "</head><body>",
  '<p title="<script>attribute()</script>">hi</p>',
  "<script>x()</script>",
  "<script>alert(1)</script>",
  "<script></script>",
  "<script>a();\r\nb();\rc();</script>",
  "</body></html>",
].join("");

describe("withInlineScriptHashes", () => {
  it("hashes each distinct inline script, in document order, and nothing else", async () => {
    const { hashes } = await withInlineScriptHashes(
      new Response(PAGE, { headers: HTML }),
    );

    // Not the two files, nor the text inside one; not the script in a
    // comment or an attribute; the repeated alert once.
    expect(hashes).toStrictEqual([HASH.alert, HASH.x, HASH.empty, HASH.lines]);
  });

  it("hashes a script that arrives across chunks as one script", async () => {
    const { hashes } = await withInlineScriptHashes(
      streamed(["<html><body><script>firsthalf();", "secondhalf();</script>"]),
    );

    expect(hashes).toStrictEqual([HASH.split]);
  });

  it("hands back the page byte for byte, with its status and headers", async () => {
    const original = new Response(PAGE, {
      status: 404,
      headers: { ...HTML, "Cache-Control": "public, max-age=60" },
    });

    const { page } = await withInlineScriptHashes(original);

    expect(await page.text()).toBe(PAGE);
    expect(page.status).toBe(404);
    expect(page.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(page.headers.get("Content-Type")).toBe(HTML["Content-Type"]);
  });

  it("leaves a response that is not HTML as it came", async () => {
    const card = new Response("<script>alert(1)</script>", {
      headers: { "Content-Type": "image/png" },
    });

    const { page, hashes } = await withInlineScriptHashes(card);

    expect(page).toBe(card);
    expect(hashes).toStrictEqual([]);
  });

  it("leaves a response with no type as it came", async () => {
    const untyped = new Response("<script>alert(1)</script>");
    untyped.headers.delete("Content-Type");

    const { page, hashes } = await withInlineScriptHashes(untyped);

    expect(page).toBe(untyped);
    expect(hashes).toStrictEqual([]);
  });

  it("leaves an HTML response with no body as it came", async () => {
    const empty = new Response(undefined, { status: 304, headers: HTML });

    const { page, hashes } = await withInlineScriptHashes(empty);

    expect(page).toBe(empty);
    expect(hashes).toStrictEqual([]);
  });
});
