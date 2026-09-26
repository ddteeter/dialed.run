import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DefaultCard,
  EntryCard,
  cardFor,
  type EntryCardData,
} from "../../src/modules/ops/og/cards";
import { OG_PALETTE } from "../../src/modules/ops/og/palette";
import {
  defaultCardResponse,
  entryCardResponse,
} from "../../src/modules/ops/og/respond";
import {
  cachedCard,
  renderCard,
  renderCardSvg,
} from "../../src/modules/ops/og/render";

/**
 * The share cards (OPS-16; round 26 #22; decision D-51).
 */

const ENTRY: EntryCardData = {
  handle: "maya_runs",
  date: "SAT AUG 29",
  temperature: "41°F",
  precipitation: "DAMP",
  verdict: 0,
  stats: "6.2 MI · FEELS 36° · SE 9MPH",
  kit: ["Tracksmith Harrier", 'Bandit 5" Split', "thin gloves"],
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

  it("gives a shareable entry its own card", () => {
    const card = cardFor(ENTRY);

    expect(card.type).toBe(EntryCard);
    expect(card.props).toStrictEqual({ entry: ENTRY });
  });
});

describe("EntryCard", () => {
  it.each([
    ["the handle", "@maya_runs"],
    ["the date", "SAT AUG 29"],
    ["the temperature", "41°F"],
    ["the precipitation", "DAMP"],
    ["the stats", "6.2 MI · FEELS 36° · SE 9MPH"],
    [
      "the kit, in kit order",
      "Tracksmith Harrier · Bandit 5&quot; Split · thin gloves",
    ],
  ])("carries %s", (_label, text) => {
    expect(markupOf(ENTRY)).toContain(text);
  });

  it("never carries an image — the photo cannot reach it", () => {
    const markup = markupOf(ENTRY);

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<svg");
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
        `<span style="[^"]*background:${hue};color:${OG_PALETTE.ink}[^"]*">${word}</span>`,
        "u",
      );

      expect(markupOf({ ...ENTRY, verdict })).toMatch(chip);
    },
  );
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
      "6dd8d1f8a3022ddfcb8c46ab2ac0c1cee6fed713d5a099ee963a602f7c32403f",
    );
  });

  it("draws an entry card as it was drawn", async () => {
    const svg = await renderCardSvg(<EntryCard entry={ENTRY} />);

    expect(await sha256(svg)).toBe(
      "b4459118ff75a6af9d0ab06b3b9a0bf0d2a6a794ab56b09c3726e31f1c74d82e",
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
    const stored = await cards.match(request);
    expect(await stored?.text()).toBe("card");
    expect(await first.text()).toBe("card");
    expect(await second.text()).toBe("card");
    expect(first.headers.get("Cache-Control")).toBe("public, max-age=120");
    expect(second.headers.get("Content-Type")).toBe("image/png");
  });

  it("serves the default card for an hour", async () => {
    const response = await defaultCardResponse(new Request(freshUrl()));

    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("serves an entry's card for ten minutes, and the default for no entry", async () => {
    const entry = await entryCardResponse(new Request(freshUrl()), ENTRY);
    const none = await entryCardResponse(new Request(freshUrl()), undefined);
    const fallback = await defaultCardResponse(new Request(freshUrl()));
    const defaultDigest = await sha256(fallback);

    expect(entry.headers.get("Cache-Control")).toBe("public, max-age=600");
    expect(await sha256(none)).toBe(defaultDigest);
    expect(await sha256(entry)).not.toBe(defaultDigest);
  });
});
