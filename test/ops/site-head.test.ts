import { describe, expect, it } from "vitest";

import {
  PUBLIC_ORIGIN,
  SITE_LINKS,
  SITE_META,
} from "../../src/modules/ops/og/site-head";

/**
 * The head every page starts from (OPS-9).
 */

/**
The content of the tag with this `name` or `property`.
*/
function content(key: string): string | undefined {
  return SITE_META.find(
    (meta) => ("name" in meta ? meta.name : meta.property) === key,
  )?.content;
}

describe("SITE_META", () => {
  it("previews as the default card, absolute against the production origin", () => {
    expect(content("og:image")).toBe("https://dialed.run/og/default");
    expect(content("og:image:width")).toBe("1200");
    expect(content("og:image:height")).toBe("630");
    expect(content("twitter:card")).toBe("summary_large_image");
  });

  it("titles and describes the site in the default card's words", () => {
    const line = "Wear what worked.";

    expect(content("og:title")).toBe("dialed.run");
    expect(content("og:site_name")).toBe("dialed.run");
    expect(content("og:type")).toBe("website");
    expect(content("description")).toBe(line);
    expect(content("og:description")).toBe(line);
  });

  it("asks not to be indexed until the owner decides", () => {
    expect(content("robots")).toBe("noindex");
  });

  it("colours the browser chrome with the icon tile's ink", () => {
    expect(content("theme-color")).toBe("#0B0B0E");
  });
});

describe("SITE_LINKS", () => {
  it("links every icon public/ serves, and the manifest", () => {
    expect(SITE_LINKS).toStrictEqual([
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ]);
  });
});

describe("PUBLIC_ORIGIN", () => {
  it("is an https origin with no path", () => {
    expect(new URL(PUBLIC_ORIGIN).origin).toBe(PUBLIC_ORIGIN);
    expect(PUBLIC_ORIGIN.startsWith("https://")).toBe(true);
  });
});
