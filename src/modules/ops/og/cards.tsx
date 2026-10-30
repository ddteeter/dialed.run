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
 * Both cards are laid out at 600×315 for a 2× export, in contract steps:
 * the default card is round 31's, which names them, and the kit's card is
 * round 41 #86e's, "on the default card's grid".
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/**
 * What a public kit's card shows (round 41 #86e, D-151), already worded
 * for display by the feed's read, which also decides whether the kit may
 * be shown at all: a kit that is not public never becomes one of these,
 * and gets the default card instead.
 */
export interface EntryCardData {
  /**
  Without the "@".
  */
  readonly handle: string;
  /**
  The run's day, never a time: "Sat Oct 18". The card sets it in capitals.
  */
  readonly day: string;
  /**
  Feels-like and sky, "38°" and "damp"; absent with no conditions.
  */
  readonly conditions?: { readonly feelsLike: string; readonly sky: string };
  readonly verdict?: VerdictValue;
  /**
  "6.2 mi · 52:10 · 8:25 /mi · 210 ft".
  */
  readonly stats: string;
  /**
  The pieces' models, without brands, in kit order.
  */
  readonly kit: readonly string[];
  /**
  Whether the conditions are Visual Crossing's, which carry its credit.
  */
  readonly isCredited: boolean;
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

/**
 * How many characters of models fit the kit's one line at TYPE.body, 2×,
 * across the card's 1072px: Archivo's average glyph is about 0.55em, so
 * 65, less a margin for wide names. Satori cannot measure, so the line is
 * cut by count.
 */
const KIT_LINE_CHARS = 60;

function lineOf(models: readonly string[], count: number): string {
  const rest = models.length - count;
  const more = rest === 0 ? [] : [`+${String(rest)}`];
  return [...models.slice(0, count), ...more].join(" · ");
}

/**
 * The kit as one line (round 41 #86e): the models in kit order, ending
 * "+N" past what fits. At least one model is always named.
 */
export function kitLine(models: readonly string[]): string {
  let count = models.length;
  while (count > 1 && lineOf(models, count).length > KIT_LINE_CHARS) {
    count -= 1;
  }
  return lineOf(models, count);
}

/**
A mono step at the card's 2×, in capitals, with its tracking.
*/
function mono(size: number, trackingEm: number) {
  return {
    fontFamily: "IBM Plex Mono",
    fontSize: size * DEFAULT_SCALE,
    letterSpacing: size * DEFAULT_SCALE * trackingEm,
    textTransform: "uppercase",
  } as const;
}

/**
 * A public kit's card (round 41 #86e): the default card's grid — 600×315
 * at 2×, ink ground, SPACE[8] in — with the handle and the day at the top
 * opposite the wordmark, the conditions in TYPE.display beside the
 * verdict's chip, the four stats in MONO.md, the kit as one line in
 * TYPE.body, and Visual Crossing's credit bottom right in TYPE.micro when
 * the conditions are theirs (round 39 #67, D-144). Never the photo or the
 * caption: `EntryCardData` has no field for either.
 */
export function EntryCard({
  entry,
}: Readonly<{ entry: EntryCardData }>): JSX.Element {
  return (
    <div style={{ ...CARD_STYLE, padding: 32 * DEFAULT_SCALE }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 24 * DEFAULT_SCALE,
        }}
      >
        <Wordmark size={24 * DEFAULT_SCALE} />
        <span style={{ ...mono(11, 0.06), color: OG_PALETTE.muted }}>
          {`@${entry.handle} · ${entry.day}`}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8 * DEFAULT_SCALE,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12 * DEFAULT_SCALE,
          }}
        >
          {entry.conditions === undefined ? undefined : (
            <span
              style={{
                display: "flex",
                gap: 8 * DEFAULT_SCALE,
                fontFamily: "Archivo Black",
                fontSize: 32 * DEFAULT_SCALE,
                lineHeight: 1.05,
                letterSpacing: (32 * DEFAULT_SCALE * -35) / 1000,
                textTransform: "uppercase",
              }}
            >
              <span>{entry.conditions.feelsLike}</span>
              <span style={{ color: OG_PALETTE.teal }}>
                {entry.conditions.sky}
              </span>
            </span>
          )}
          <VerdictChip verdict={entry.verdict} />
        </div>
        <span style={{ ...mono(13, 0.02), color: OG_PALETTE.soft }}>
          {entry.stats}
        </span>
        <span
          style={{
            fontSize: 15 * DEFAULT_SCALE,
            lineHeight: 1.5,
            color: OG_PALETTE.soft,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {kitLine(entry.kit)}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {entry.isCredited ? (
          <span
            style={{
              fontSize: 12 * DEFAULT_SCALE,
              lineHeight: 1.4,
              color: OG_PALETTE.muted,
            }}
          >
            Weather data provided by Visual Crossing
          </span>
        ) : undefined}
      </div>
    </div>
  );
}

/**
 * The verdict's chip, MONO.xs on its T2 hue, padded SPACE[1] by SPACE[2];
 * nothing for a kit with no verdict.
 */
function VerdictChip({
  verdict,
}: Readonly<{ verdict: VerdictValue | undefined }>): JSX.Element | undefined {
  if (verdict === undefined) return undefined;
  return (
    <span
      style={{
        ...mono(10, 0.1),
        fontWeight: 600,
        padding: `${String(4 * DEFAULT_SCALE)}px ${String(8 * DEFAULT_SCALE)}px`,
        background: chipColour(verdict),
        color: OG_PALETTE.ink,
      }}
    >
      {verdictLabel(verdict)}
    </span>
  );
}

/**
 * The card for a share link: the kit's, when there is a public kit, and
 * the default otherwise — so a link reveals nothing about an entry
 * that is not public ("A link can't reveal that something exists").
 */
export function cardFor(entry: EntryCardData | undefined): JSX.Element {
  return entry === undefined ? <DefaultCard /> : <EntryCard entry={entry} />;
}
