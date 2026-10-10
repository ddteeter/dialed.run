import type { JSX } from "react";

import { verdictLabel, type VerdictValue } from "../../../lib/contracts";
import { OG_PALETTE } from "./palette";

/**
 * The share cards (OPS-16; design round 26 #22; decision D-51), as element
 * trees for satori, which lays them out with flexbox and paints a PNG.
 * Satori reads inline styles only — no classes, no custom properties —
 * which is why these are style objects and the colours are literal.
 *
 * **Never the photo, the note, the route or a flag.** `EntryCardData` has
 * no field that could carry one, so the rule is the type's rather than a
 * check someone could forget: a card cannot render what it is not given.
 *
 * The entry card's sizes are the board's own: no contract covers an image
 * rendered at 1200×630 — `tokens.js` is a type scale for screens — so the
 * artboard is the only source, and that is recorded as a design delta. The
 * default card is round 31's, which names its contract steps and lays them
 * out at 600×315 for a 2× export.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * What a shared entry's card shows, already worded for display by the
 * feed's read (task 129), which also decides whether the entry may be
 * shown at all: an entry that is private, deleted, banned or unverified
 * never becomes one of these, and gets the default card instead.
 */
export interface EntryCardData {
  /**
  Without the "@".
  */
  readonly handle: string;
  /**
  Mono, US order: "SAT AUG 29".
  */
  readonly date: string;
  /**
  "41°F".
  */
  readonly temperature: string;
  /**
  "DAMP".
  */
  readonly precipitation: string;
  readonly verdict: VerdictValue;
  /**
  "6.2 MI · FEELS 36° · SE 9MPH".
  */
  readonly stats: string;
  /**
  Garment names in kit order.
  */
  readonly kit: readonly string[];
}

/**
A verdict's chip colour: its hue, as the app's `verdictHue` gives it.
*/
function chipColour(verdict: VerdictValue): string {
  if (verdict < 0) return OG_PALETTE.pink;
  if (verdict > 0) return OG_PALETTE.quiet;
  return OG_PALETTE.teal;
}

function Wordmark({ size = 44 }: Readonly<{ size?: number }>) {
  return (
    <span
      style={{
        display: "flex",
        fontFamily: "Archivo Black",
        fontSize: size,
        // TYPE.title's tracking, -0.03em, at whatever size it is drawn.
        letterSpacing: (size * -3) / 100,
      }}
    >
      <span style={{ color: OG_PALETTE.pink }}>[</span>
      <span>dialed</span>
      <span style={{ color: OG_PALETTE.muted }}>.run</span>
      <span style={{ color: OG_PALETTE.pink }}>]</span>
    </span>
  );
}

const CARD_STYLE = {
  width: OG_WIDTH,
  height: OG_HEIGHT,
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  background: OG_PALETTE.ink,
  color: OG_PALETTE.paper,
  fontFamily: "Archivo",
} as const;

/**
 * The default card's scale (round 31 #6, D-107): laid out at 600×315 and
 * exported at 2×, so every contract value below is doubled. Round 31 names
 * the contracts it uses, which is what makes these the card's numbers
 * rather than the board's drawing.
 */
const DEFAULT_SCALE = OG_WIDTH / 600;

/**
 * The default card (round 31 #6; D-107): home, profiles, and anything not
 * shareable, on both hosts. The wordmark at TYPE.title, "Wear what worked."
 * at TYPE.display — the hero's line, so the card and the hero say the same
 * thing — and the address at MONO.sm in `--muted`, inside SPACE[8].
 */
export function DefaultCard(): JSX.Element {
  return (
    <div style={{ ...CARD_STYLE, padding: 32 * DEFAULT_SCALE }}>
      <Wordmark size={24 * DEFAULT_SCALE} />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          // The board's 24px between the line and the URL (round 31 #6).
          gap: 24 * DEFAULT_SCALE,
        }}
      >
        <span
          style={{
            fontFamily: "Archivo Black",
            fontSize: 32 * DEFAULT_SCALE,
            lineHeight: 1.05,
            // TYPE.display's -0.035em.
            letterSpacing: (32 * DEFAULT_SCALE * -35) / 1000,
            textTransform: "uppercase",
          }}
        >
          Wear what worked.
        </span>
        <span
          style={{
            fontFamily: "IBM Plex Mono",
            fontSize: 11 * DEFAULT_SCALE,
            lineHeight: 1.4,
            // MONO.sm's 0.06em.
            letterSpacing: (11 * DEFAULT_SCALE * 6) / 100,
            textTransform: "uppercase",
            color: OG_PALETTE.muted,
          }}
        >
          dialed.run
        </span>
      </div>
    </div>
  );
}

const MONO = { fontFamily: "IBM Plex Mono", fontSize: 28 } as const;

export function EntryCard({
  entry,
}: Readonly<{ entry: EntryCardData }>): JSX.Element {
  return (
    <div style={{ ...CARD_STYLE, padding: "64px 72px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <Wordmark />
        <span
          style={{
            fontFamily: "IBM Plex Mono",
            fontSize: 26,
            letterSpacing: 2.08,
            color: OG_PALETTE.muted,
          }}
        >
          {entry.date}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div
          style={{
            display: "flex",
            gap: 36,
            fontFamily: "Archivo Black",
            fontSize: 150,
            lineHeight: 0.9,
            letterSpacing: -7.5,
          }}
        >
          <span>{entry.temperature}</span>
          <span style={{ color: OG_PALETTE.teal }}>{entry.precipitation}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <span
            style={{
              ...MONO,
              fontWeight: 600,
              letterSpacing: 1.68,
              padding: "10px 18px",
              textTransform: "uppercase",
              background: chipColour(entry.verdict),
              color: OG_PALETTE.ink,
            }}
          >
            {verdictLabel(entry.verdict)}
          </span>
          <span
            style={{ ...MONO, letterSpacing: 1.12, color: OG_PALETTE.soft }}
          >
            {entry.stats}
          </span>
        </div>
        <span style={{ fontSize: 34, lineHeight: 1.3, color: OG_PALETTE.soft }}>
          {entry.kit.join(" · ")}
        </span>
      </div>
      <span style={{ fontSize: 32, fontWeight: 600 }}>@{entry.handle}</span>
    </div>
  );
}

/**
 * The card for a share link: the entry's, when there is a shareable entry,
 * and the default otherwise — so a link reveals nothing about an entry
 * that is not public ("A link can't reveal that something exists").
 */
export function cardFor(entry: EntryCardData | undefined): JSX.Element {
  return entry === undefined ? <DefaultCard /> : <EntryCard entry={entry} />;
}
