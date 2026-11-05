import { describe, expect, it } from "vitest";

import { refreshTarget } from "../../src/modules/enrichment/meta-refresh";

/**
 * A meta refresh is a redirect a status code does not announce (R-176,
 * design 171). These pin what counts as one and where it points.
 */
const PAGE = new URL("https://short.example/abc");

function refresh(content: string): string {
  return `<meta http-equiv="refresh" content="${content}">`;
}

/**
Where a page made of these head tags sends a browser from `PAGE`.
*/
function targetOf(...metas: string[]): string | undefined {
  const html = `<html><head>${metas.join("")}</head><body>moving</body></html>`;
  return refreshTarget(html, PAGE)?.href;
}

/**
Where a page with one refresh of this `content` sends a browser.
*/
function targetFor(content: string): string | undefined {
  return targetOf(refresh(content));
}

describe("refreshTarget", () => {
  it("reads the target of a refresh in the common shapes", () => {
    const shapes: [string, string][] = [
      ["0; url=https://shop.example/p", "https://shop.example/p"],
      ["0;url=https://shop.example/p", "https://shop.example/p"],
      ["0, URL=https://shop.example/p", "https://shop.example/p"],
      ["  3 ;  url =  https://shop.example/p  ", "https://shop.example/p"],
      ["0.5; url=https://shop.example/p", "https://shop.example/p"],
      ["1.; url=https://shop.example/p", "https://shop.example/p"],
      ["10; https://shop.example/p", "https://shop.example/p"],
      ["0; url='https://shop.example/p'", "https://shop.example/p"],
      ["0; url=&quot;https://shop.example/p&quot;", "https://shop.example/p"],
      ["0;\nurl=https://shop.example/p", "https://shop.example/p"],
      [
        "0; url=https://shop.example/p?a=1;b=2",
        "https://shop.example/p?a=1;b=2",
      ],
      ["0; url=https://shop.example/p,q", "https://shop.example/p,q"],
    ];
    for (const [content, expected] of shapes) {
      expect(targetFor(content), content).toBe(expected);
    }
  });

  it("matches http-equiv in any case, as a browser does", () => {
    expect(
      targetOf(
        '<META HTTP-EQUIV="Refresh" CONTENT="0; url=https://a.example/">',
      ),
    ).toBe("https://a.example/");
  });

  it("resolves a relative target against the page", () => {
    expect(targetFor("0; url=/p/1")).toBe("https://short.example/p/1");
    expect(targetFor("0; url=next")).toBe("https://short.example/next");
    expect(targetFor("0; url=?next=1")).toBe(
      "https://short.example/abc?next=1",
    );
  });

  it("keeps a quote that is not a matched pair as part of the target", () => {
    expect(targetFor("0; url='https://a.example/x")).toBe(
      "https://short.example/'https://a.example/x",
    );
    expect(targetFor(`0; url='https://a.example/x&quot;`)).toBe(
      `https://short.example/'https://a.example/x%22`,
    );
    expect(targetFor("0; url='")).toBe("https://short.example/'");
  });

  it("is nothing on a page with no refresh", () => {
    expect(
      targetOf('<meta name="description" content="0; url=/x">'),
    ).toBeUndefined();
    expect(
      targetOf('<meta http-equiv="content-type" content="0; url=/x">'),
    ).toBeUndefined();
    expect(targetOf()).toBeUndefined();
  });

  it("is nothing for a refresh that only reloads", () => {
    for (const content of ["5", "0;", "0; url=", "0; url=  ", "0; url=''"]) {
      expect(targetFor(content), content).toBeUndefined();
    }
  });

  it("is nothing for content that does not start with a delay", () => {
    for (const content of [
      "url=https://a.example/",
      "x; url=https://a.example/",
      "; url=https://a.example/",
      "0 url=https://a.example/",
      "a0; url=https://a.example/",
      ".5; url=https://a.example/",
    ]) {
      expect(targetFor(content), content).toBeUndefined();
    }
  });

  it("is nothing for a refresh with no content", () => {
    expect(targetOf('<meta http-equiv="refresh">')).toBeUndefined();
  });

  it("is nothing for a refresh back to the same page, a fragment aside", () => {
    expect(targetFor("0; url=https://short.example/abc")).toBeUndefined();
    expect(targetFor("0; url=#top")).toBeUndefined();
    const fromFragment = refreshTarget(
      refresh("0; url=https://short.example/abc"),
      new URL("https://short.example/abc#here"),
    );
    expect(fromFragment).toBeUndefined();
  });

  it("is nothing for a target that does not resolve", () => {
    expect(targetFor("0; url=https://[nope")).toBeUndefined();
  });

  it("takes the first refresh with a target, skipping ones without", () => {
    const first = targetOf(
      refresh("5"),
      refresh("0; url=https://first.example/"),
      refresh("0; url=https://second.example/"),
    );
    expect(first).toBe("https://first.example/");
  });

  it("stops at the first target even when it is the page itself", () => {
    const first = targetOf(
      refresh("0; url=https://short.example/abc"),
      refresh("0; url=https://second.example/"),
    );
    expect(first).toBeUndefined();
  });

  it("reads a refresh in the body as well as the head", () => {
    const html = `<html><body><p>moving</p>${refresh("0; url=https://a.example/")}</body></html>`;
    expect(refreshTarget(html, PAGE)?.href).toBe("https://a.example/");
  });
});
