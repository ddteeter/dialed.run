import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DefaultCard,
  EntryCard,
  cardFor,
  kitLine,
  type EntryCardData,
} from "../../src/modules/ops/og/cards";
import { OG_PALETTE } from "../../src/modules/ops/og/palette";
import {
  defaultCardResponse,
  kitCardResponse,
} from "../../src/modules/ops/og/respond";
import {
  cachedCard,
  cardCacheKey,
  renderCard,
  renderCardSvg,
} from "../../src/modules/ops/og/render";

/**
 * The share cards (OPS-16; round 26 #22; decision D-51).
 */

const ENTRY: EntryCardData = {
  handle: "maya_runs",
  day: "Sat Oct 18",
  conditions: { feelsLike: "38°", sky: "damp" },
  verdict: -1,
  stats: "6.2 mi · 52:10 · 8:25 /mi · 210 ft",
  kit: ["Brighton Base Layer", "AFO Middle Tight", "Pegasus 41"],
  isCredited: true,
};

async function sha256(response: Response): Promise<string> {
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function freshUrl(): string {
  return `https://dialed.test/og/${crypto.randomUUID()}`;
}

/**
 * The card as markup: what satori is handed, readable. The image itself is
 * pinned below; this is where the words and the absence of an image are
 * asserted.
 */
function markupOf(entry: EntryCardData): string {
  return renderToStaticMarkup(<EntryCard entry={entry} />);
}

describe("cardFor", () => {
  it("gives anything that is not a shareable entry the default card", () => {
    // A private, deleted, banned or unverified entry reaches here as
    // `undefined` — the feed's read decides — and so does an entry that
    // never existed: a link cannot reveal which.
    expect(cardFor(undefined).type).toBe(DefaultCard);
  });

  it("gives a public kit its own card", () => {
    const card = cardFor(ENTRY);

    expect(card.type).toBe(EntryCard);
    expect(card.props).toStrictEqual({ entry: ENTRY });
  });
});

describe("EntryCard", () => {
  it.each([
    ["the handle and the day, in one line", "@maya_runs · Sat Oct 18"],
    ["the feels-like", ">38°<"],
    ["the sky", ">damp<"],
    ["the stats", "6.2 mi · 52:10 · 8:25 /mi · 210 ft"],
    [
      "the models, in kit order",
      "Brighton Base Layer · AFO Middle Tight · Pegasus 41",
    ],
    ["Visual Crossing's credit", "Weather data provided by Visual Crossing"],
  ])("carries %s", (_label, text) => {
    expect(markupOf(ENTRY)).toContain(text);
  });

  it("sets the handle, the day and the stats in capitals, the conditions too", () => {
    const markup = markupOf(ENTRY);

    expect(markup).toMatch(
      /<span style="[^"]*text-transform:uppercase[^"]*">@maya_runs · Sat Oct 18<\/span>/u,
    );
    expect(markup).toMatch(
      /<span style="[^"]*text-transform:uppercase[^"]*">6\.2 mi/u,
    );
    expect(markup).toMatch(
      /text-transform:uppercase[^"]*"><span>38°<\/span><span style="color:#00e0c6">damp<\/span>/u,
    );
  });

  it("keeps SPACE[6] between the wordmark and the handle, and the kit to one line", () => {
    // Invisible in the digest: neither meets its limit at the board's
    // length.
    const markup = markupOf(ENTRY);

    expect(markup).toContain("gap:48px");
    expect(markup).toMatch(/white-space:nowrap;overflow:hidden">Brighton/u);
  });

  it("never carries an image — the photo cannot reach it", () => {
    const markup = markupOf(ENTRY);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<svg");
  });

  it("drops the credit when the conditions are not Visual Crossing's", () => {
    expect(markupOf({ ...ENTRY, isCredited: false })).not.toContain(
      "Visual Crossing",
    );
  });

  it("draws no conditions and no chip for a kit with neither", () => {
    const markup = markupOf({
      handle: ENTRY.handle,
      day: ENTRY.day,
      stats: ENTRY.stats,
      kit: ENTRY.kit,
      isCredited: false,
    });

    expect(markup).not.toContain("38°");
    expect(markup).not.toContain("cold");
    // No empty chip either.
    expect(markup).not.toContain("padding:8px 16px");
  });

  it.each([
    [-2, "Way cold", OG_PALETTE.pink],
    [-1, "A bit cold", OG_PALETTE.pink],
    [0, "Dialed", OG_PALETTE.teal],
    [1, "A bit warm", OG_PALETTE.quiet],
    [2, "Way warm", OG_PALETTE.quiet],
  ] as const)(
    "chips a %d verdict with its word and its hue",
    (verdict, word, hue) => {
      const chip = new RegExp(
        `<span style="[^"]*text-transform:uppercase;font-weight:600;padding:8px 16px;background:${hue};color:${OG_PALETTE.ink}">${word}</span>`,
        "u",
      );

      expect(markupOf({ ...ENTRY, verdict })).toMatch(chip);
    },
  );
});

describe("kitLine", () => {
  it("names every model when they fit one line", () => {
    expect(kitLine(["Brighton Base Layer", "AFO Middle Tight"])).toBe(
      "Brighton Base Layer · AFO Middle Tight",
    );
  });

  it("ends +N past what fits, counting the +N itself", () => {
    // Round 41's own line: four pieces, the fourth past the edge.
    const models = [
      "Brighton Base Layer",
      "AFO Middle Tight",
      "Pegasus 41",
      "Old black beanie",
    ];
    expect(kitLine(models)).toBe(
      "Brighton Base Layer · AFO Middle Tight · Pegasus 41 · +1",
    );
  });

  it("keeps a line of exactly sixty characters whole", () => {
    // 29 + 3 + 28 = 60.
    const models = ["a".repeat(29), "b".repeat(28)];
    expect(kitLine(models)).toBe(`${"a".repeat(29)} · ${"b".repeat(28)}`);
    const over = ["a".repeat(29), "b".repeat(29)];
    expect(kitLine(over)).toBe(`${"a".repeat(29)} · +1`);
  });

  it("always names the first model, however long", () => {
    const long = "x".repeat(80);
    expect(kitLine([long, "Pegasus 41"])).toBe(`${long} · +1`);
    expect(kitLine([long])).toBe(long);
  });

  it("is empty for no pieces", () => {
    expect(kitLine([])).toBe("");
  });
});

describe("the rendered cards", () => {
  // The image itself, pinned. A card is layout and paint: every size,
  // weight, colour and gap is in the SVG satori writes, so a digest of it
  // is what notices a style that changed — and the text is outlined into
  // paths, so there is no smaller thing to assert on. A deliberate change
  // to a card updates these, and the reviewer looks at the new image.
  it("draws the default card as it was drawn", async () => {
    const svg = await renderCardSvg(<DefaultCard />);

    expect(await sha256(svg)).toBe(
      "3175a8b27d563f4d16204242d3d329617da8636c796f2efad2106d152595433a",
    );
  });

  it("keeps the board's 24px between the line and the URL, at 2×", () => {
    // Invisible in the digest above: the line is short enough that the
    // two never meet, so the gap only shows when a longer line would.
    expect(renderToStaticMarkup(<DefaultCard />)).toContain("gap:48px");
  });

  it("draws a kit's card as it was drawn", async () => {
    const svg = await renderCardSvg(<EntryCard entry={ENTRY} />);

    expect(await sha256(svg)).toBe(
      "2434d5aeedf089fbe47582ec339f369f82013c8d357beaa25e2eeba5daad159e",
    );
  });

  it("serves a 1200×630 PNG by default, which every social preview accepts", async () => {
    const response = await renderCard(<DefaultCard />);

    expect(response.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(1, 4))).toBe("PNG");
    // Width and height live in the IHDR chunk, big-endian at 16 and 20.
    const view = new DataView(bytes.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toStrictEqual([1200, 630]);
  });
});

describe("caching", () => {
  it("renders a card once and serves the second request from cache", async () => {
    const request = new Request(freshUrl());
    const render = vi.fn(() =>
      Promise.resolve(
        new Response("card", { headers: { "Content-Type": "image/png" } }),
      ),
    );

    const first = await cachedCard(request, 120, render);
    const second = await cachedCard(request, 120, render);

    expect(render).toHaveBeenCalledTimes(1);
    // In the cards' own named cache, apart from anything else cached.
    const cards = await caches.open("og-cards");
    const stored = await cards.match(cardCacheKey(request));
    expect(await stored?.text()).toBe("card");
    expect(await first.text()).toBe("card");
    expect(await second.text()).toBe("card");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(second.headers.get("Content-Type")).toBe("image/png");
  });

  it("renders once for any query string, and for any header", async () => {
    // Keyed on the raw URL, `?1`, `?2`, … were each a fresh render: an
    // unbounded supply of CPU for anyone who can type a digit.
    const path = freshUrl();
    const render = vi.fn(() => Promise.resolve(new Response("card")));

    await cachedCard(new Request(`${path}?1`), 120, render);
    await cachedCard(
      new Request(`${path}?2`, { headers: { "Accept-Language": "fr" } }),
      120,
      render,
    );
    const third = await cachedCard(new Request(path), 120, render);

    expect(render).toHaveBeenCalledTimes(1);
    expect(await third.text()).toBe("card");
  });

  it("keys a card on its origin and path alone", () => {
    const key = cardCacheKey(
      new Request("https://dialed.test/og/default?x=1#frag", {
        headers: { Cookie: "a=b" },
      }),
    );

    expect(key.url).toBe("https://dialed.test/og/default");
    expect(key.headers.has("Cookie")).toBe(false);
  });

  it("serves the default card for an hour", async () => {
    const response = await defaultCardResponse(new Request(freshUrl()));

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });
});

describe("kitCardResponse", () => {
  const ENTRY_ID = "01J00000000000000000000000";

  it("serves a public kit's card for the page's minute at the edge, tagged", async () => {
    const response = await kitCardResponse(
      new Request(`https://dialed.test/og/k/${ENTRY_ID}?v=abc`),
      ENTRY_ID,
      {
        found: { card: ENTRY, version: crypto.randomUUID() },
        tags: [`entry:${ENTRY_ID}`, "runner:u1"],
      },
    );

    expect(response.headers.get("Content-Type")).toBe("image/png");
    // A minute, not the day it is rendered for: the edge keeps what this
    // says, in front of the check that the kit is still public.
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Cache-Tag")).toBe(
      `entry:${ENTRY_ID},runner:u1`,
    );
  });

  it("renders a new card for a new version, and finds the old one by its own", async () => {
    const version = crypto.randomUUID();
    const url = `https://dialed.test/og/k/${ENTRY_ID}`;
    await kitCardResponse(new Request(url), ENTRY_ID, {
      found: { card: ENTRY, version },
      tags: [],
    });

    const cards = await caches.open("og-cards");
    const stored = await cards.match(
      new Request(`https://dialed.test/og/k/${ENTRY_ID}/${version}`),
    );
    expect(stored?.headers.get("Content-Type")).toBe("image/png");
    expect(
      await cards.match(new Request(`https://dialed.test/og/k/${ENTRY_ID}`)),
    ).toBeUndefined();
  });

  it("finds the default card where the default card route keeps it", async () => {
    const origin = `https://${crypto.randomUUID()}.test`;
    await kitCardResponse(
      new Request(`${origin}/og/k/${ENTRY_ID}?v=old`),
      ENTRY_ID,
      { tags: [] },
    );

    const cards = await caches.open("og-cards");
    expect(
      await cards.match(new Request(`${origin}/og/default`)),
    ).toBeDefined();
    expect(
      await cards.match(new Request(`${origin}/og/k/${ENTRY_ID}`)),
    ).toBeUndefined();
  });

  it("serves the default card, kept a minute and tagged, for a kit that is not public", async () => {
    const response = await kitCardResponse(
      new Request(`https://dialed.test/og/k/${ENTRY_ID}?v=old`),
      ENTRY_ID,
      { tags: [`entry:${ENTRY_ID}`] },
    );
    const fallback = await defaultCardResponse(
      new Request("https://dialed.test/og/default"),
    );

    expect(await sha256(response)).toBe(await sha256(fallback));
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(response.headers.get("Cache-Tag")).toBe(`entry:${ENTRY_ID}`);
  });
});
