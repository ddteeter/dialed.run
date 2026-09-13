import { describe, expect, it } from "vitest";

import { openGraphExtractor } from "../../src/modules/enrichment/rungs/og";

const PAGE = new URL("https://shop.example.com/p");

function meta(property: string, content: string): string {
  return `<meta property="${property}" content="${content}">`;
}

describe("the Open Graph rung", () => {
  it("reads title, image and site name", () => {
    const html = `<html><head>
      ${meta("og:title", "Rover Half-Zip")}
      ${meta("og:image", "https://cdn.example.com/rover.jpg")}
      ${meta("og:site_name", "Janji")}
    </head></html>`;

    expect(openGraphExtractor.extract(PAGE, html)).toStrictEqual({
      name: "Rover Half-Zip",
      brand: "Janji",
      imageUrl: "https://cdn.example.com/rover.jpg",
    });
  });

  it("reads a tag with the attributes the other way round", () => {
    // Plenty of themes emit content before property. One pattern allowing
    // either order needs backtracking, so there are two patterns — and this
    // is the case that proves the second one runs.
    const html = `<meta content="Rover Half-Zip" property="og:title">`;
    expect(openGraphExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("reads single-quoted attributes", () => {
    const html = `<meta property='og:title' content='Rover Half-Zip'>`;
    expect(openGraphExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("keeps the first of a repeated tag", () => {
    // A page that says og:title twice meant the first; taking the last would
    // pick up whatever a plugin appended.
    const html = `${meta("og:title", "Rover Half-Zip")}${meta("og:title", "Buy now")}`;
    expect(openGraphExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("treats an empty content attribute as no value", () => {
    // An empty tag is not a name, and storing "" would satisfy the
    // fill-only-what-is-blank rule and block a better rung later.
    const html = `${meta("og:title", "")}${meta("og:image", "https://cdn.example.com/a.jpg")}`;
    const extracted = openGraphExtractor.extract(PAGE, html);
    expect(extracted?.name).toBeUndefined();
    expect(extracted?.imageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("ignores a property that is not an og one, even when it collides", () => {
    // `property="title"` lands on the same key `og:title` would, and first
    // occurrence wins — so a rung that skipped the prefix check would take
    // this one and never see the real tag behind it.
    const html = `<meta property="title" content="Wrong">${meta(
      "og:title",
      "Rover Half-Zip",
    )}`;
    expect(openGraphExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("lets a later tag win when the first has no content", () => {
    // `<meta property="og:title">` with no content must not claim the key —
    // storing an empty value would block the real one behind it.
    const html = `<meta property="og:title">${meta("og:title", "Rover Half-Zip")}`;
    expect(openGraphExtractor.extract(PAGE, html)?.name).toBe("Rover Half-Zip");
  });

  it("never reads og:description, however tempting it looks", () => {
    // The rung's one rule. A description asks only for a percentage beside
    // words to fool parseComposition — "20% off" becomes a fibre called
    // "off". Prose is the model's job.
    const html = `${meta("og:title", "Rover Half-Zip")}${meta(
      "og:description",
      "88% polyester. 20% off today!",
    )}`;
    const extracted = openGraphExtractor.extract(PAGE, html);
    expect(extracted?.fabricComposition).toBeUndefined();
    expect(extracted?.name).toBe("Rover Half-Zip");
  });

  it("says nothing for a page with no og tags at all", () => {
    expect(
      openGraphExtractor.extract(PAGE, "<html><body>a page</body></html>"),
    ).toBeUndefined();
  });

  it("is the og rung", () => {
    expect(openGraphExtractor.rung).toBe("og");
  });

  it("steps over meta tags that carry neither attribute", () => {
    // `<meta charset>` and `<meta name=viewport>` are on every page and have
    // no property or content. Skipping them is the behaviour that makes the
    // guards real rather than decorative.
    const html = `<html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width">
      ${meta("og:title", "Rover Half-Zip")}
    </head></html>`;
    expect(openGraphExtractor.extract(PAGE, html)).toStrictEqual({
      name: "Rover Half-Zip",
    });
  });
});
