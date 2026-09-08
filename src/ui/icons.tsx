import type { JSX } from "react";

/**
 * The brand icon system, ported from design/icons.js (the Icon Pack
 * handoff — design/ holds the source of truth; regenerate rather than
 * hand-edit paths). Every glyph is a 24x24 monoline single-path drawing.
 *
 * Contract (from the pack):
 * - stroke, never fill; color always from currentColor;
 * - square caps + miter joins — the squared, engineered Archivo feel;
 * - stroke-width 1.75 at 20-24px, 2 at 28px+, 1.5 at 16px; never below 16px;
 * - never scale non-uniformly, rotate, or add a second color;
 * - the verdict glyphs and `generic` draw the bracket motif on purpose —
 *   no other glyph may.
 *
 * A glyph that is not in this manifest is an undesigned surface: request it
 * via docs/design-deltas.md, never draw your own (see CLAUDE.md).
 */
export const ICONS = {
  feed: { group: "nav", d: "M3 5h18v5H3zM3 14h18v5H3z" },
  closet: { group: "nav", d: "M10 6a2 2 0 114 0c0 1.5-2 2-2 4M3 17l9-7 9 7v2H3z" },
  log: { group: "nav", d: "M6 3H3v18h3M18 3h3v18h-3M12 8v8M8 12h8" },
  profile: { group: "nav", d: "M12 4a4 4 0 100 8 4 4 0 000-8zM4 21c0-4 3.6-6 8-6s8 2 8 6" },
  singlet: { group: "garment", d: "M8 4h2a2 2 0 004 0h2c-1 2-1 4 1 6v10H7V10c2-2 2-4 1-6z" },
  tee: { group: "garment", d: "M9 4a3 3 0 006 0l5 3-1.5 3.5-2.5-1V20H8v-10.5l-2.5 1L4 7z" },
  longSleeve: { group: "garment", d: "M9 4a3 3 0 006 0l5 3 1.5 10.5-3 .5-2-7.5V20h-9v-9.5l-2 7.5-3-.5L4 7z" },
  halfZip: { group: "garment", d: "M9 4h6l5 3 1.5 10.5-3 .5-2-7.5V20h-9v-9.5l-2 7.5-3-.5L4 7zM9 4V2.5h6V4M12 4v6" },
  jacket: { group: "garment", d: "M8.5 7a3.5 3.5 0 017 0l4.5 2.5 1.5 9.5-3 .5-2-7V21h-9v-8.5l-2 7-3-.5L4 9.5zM12 7v14" },
  vest: { group: "garment", d: "M9 4h6l4 2.5V20H5V6.5zM9 4c0 3-1.5 5-4 6M15 4c0 3 1.5 5 4 6M12 4v16" },
  shorts: { group: "garment", d: "M5 5h14l1 5-1 8h-5.5L12 12l-1.5 6H5l-1-8zM5.5 8.5h13" },
  halfTights: { group: "garment", d: "M6 5h12l.5 3-1 11h-4L12 11l-1.5 8h-4L5.5 8zM6 8h12" },
  tights: { group: "garment", d: "M7 4h10l.5 4-.5 13h-4L12 10l-1 11H7L6.5 8zM7 7h10" },
  socks: { group: "garment", d: "M9 3h6v9l3.5 3a3 3 0 01-4 4.5L9 15.5zM9 6h6" },
  shoes: { group: "garment", d: "M21.5 19H4a1.5 1.5 0 01-1.5-1.5V16c0-1.4 1-2.4 2.4-2.7C9 12.5 11.5 10.5 14 8.3c1.5 1.1 3.1 1.3 4.7.3.9-.5 2 .1 2.1 1.1L21.5 16zM2.5 16h19M8.5 11.4l.9 1.6M11.5 9.7l.9 1.6" },
  gloves: { group: "garment", d: "M9 21V13.5L6.5 12a2 2 0 011.5-3.5L9 9.5V7a4 4 0 018 0v14zM9 17h8" },
  cap: { group: "garment", d: "M3 14v-1a7 7 0 0114 0v1M3 14h14c2.5 0 4 .5 5 2-1.5 1-3 1.5-5.5 1.5H3z" },
  beanie: { group: "garment", d: "M12 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5 16a7 7 0 0114 0M4 16h16v4H4z" },
  headband: { group: "garment", d: "M3 16a9 9 0 0118 0M6 16a6 6 0 0112 0M3 16h3M18 16h3" },
  sunglasses: { group: "garment", d: "M3 9h18l-1.5 6H14.5L12 12.5 9.5 15H4.5zM3 9L2 8M21 9l1-1" },
  neckGaiter: { group: "garment", d: "M9 8a3 3 0 016 0M8 9h8l1.5 3-1 8h-9l-1-8zM8.5 13.5h7M8.3 16.5h7.4" },
  // Provisional — drawn ahead of the taxonomy. Delete if these
  // categories do not ship.
  sportsBra: { group: "garment", d: "M9 4c0 4 6 4 6 0h2c0 3 1 5 2 6v6H5v-6c1-1 2-3 2-6zM5 13h14" },
  armSleeves: { group: "garment", d: "M6 4h5l.5 16h-4zM13 4h5l-.5 16h-4zM6.1 7h4.9M13.1 7h4.9" },
  clear: { group: "weather", d: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" },
  partlyCloudy: { group: "weather", d: "M12 7.25a3.5 3.5 0 10-3.4 3.75M8.5 2.5V4M3 7.5h1.5M4.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1M17 19a3.5 3.5 0 000-7A5 5 0 008.8 13.3A3 3 0 008 19z" },
  cloudy: { group: "weather", d: "M6.75 18a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 11.6A3.25 3.25 0 0117.75 18z" },
  rainLight: { group: "weather", d: "M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM9.75 18l-1 3M15.25 18l-1 3" },
  rainHeavy: { group: "weather", d: "M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM8 18l-1 3M12.5 18l-1 3M17 18l-1 3" },
  snow: { group: "weather", d: "M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM9 17.5v4M7.2 18.5l3.6 2M10.8 18.5l-3.6 2M15 17.5v4M13.2 18.5l3.6 2M16.8 18.5l-3.6 2" },
  wind: { group: "weather", d: "M2 9h12a3 3 0 10-3-4M2 15h14a3 3 0 11-3 4M2 12h8" },
  humidity: { group: "weather", d: "M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11zM12 17a3 3 0 003-3" },
  dawn: { group: "weather", d: "M8 15a4 4 0 018 0M2 15h3M19 15h3M12 3v4M6 8.5L7.5 10M18 8.5L16.5 10M3 19h18" },
  night: { group: "weather", d: "M20 15A9 9 0 0110 4a8 8 0 1010 11z" },
  thermometer: { group: "weather", d: "M10 4.5a2 2 0 014 0V14a3.5 3.5 0 11-4 0zM12 8v6" },
  verdictDialed: { group: "verdict", d: "M6 3H3v18h3M18 3h3v18h-3M8 12l3 3 5-6" },
  verdictCold: { group: "verdict", d: "M6 3H3v18h3M18 3h3v18h-3M12 8v8M8.5 12h7M9.7 9.7l4.6 4.6M14.3 9.7l-4.6 4.6" },
  verdictWarm: { group: "verdict", d: "M6 3H3v18h3M18 3h3v18h-3M7.5 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0M7.5 12.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0M7.5 16c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0" },
  verdictMixed: { group: "verdict", d: "M6 3H3v18h3M18 3h3v18h-3M8 13c1-1.6 2.7-1.6 4 0s3 1.6 4 0" },
  verdictPending: { group: "verdict", d: "M6 3H3v18h3M18 3h3v18h-3M7.5 12h1M11.5 12h1M15.5 12h1" },
  add: { group: "action", d: "M12 4v16M4 12h16" },
  camera: { group: "action", d: "M3 8h4l2-2h6l2 2h4v12H3zM12 10.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" },
  edit: { group: "action", d: "M4 20h4L20 8l-4-4L4 16zM14 6l4 4" },
  remove: { group: "action", d: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" },
  search: { group: "action", d: "M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5" },
  filter: { group: "action", d: "M3 5h18l-7 8v6l-4 2v-8z" },
  sort: { group: "action", d: "M4 6h16M6 12h12M9 18h6" },
  share: { group: "action", d: "M12 3v12M7 8l5-5 5 5M4 15v6h16v-6" },
  save: { group: "action", d: "M6 3h12v18l-6-5-6 5z" },
  duplicate: { group: "action", d: "M8 8h13v13H8zM16 8V3H3v13h5" },
  more: { group: "action", d: "M11 5h2v2h-2zM11 11h2v2h-2zM11 17h2v2h-2z" },
  close: { group: "action", d: "M5 5l14 14M19 5L5 19" },
  back: { group: "action", d: "M15 5l-7 7 7 7" },
  forward: { group: "action", d: "M9 5l7 7-7 7" },
  check: { group: "action", d: "M4 13l5 5L20 6" },
  drag: { group: "action", d: "M8 8h8M8 12h8M8 16h8" },
  undo: { group: "action", d: "M4 9h11a5 5 0 010 10h-6M4 9l4-4M4 9l4 4" },
  discover: { group: "social", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z" },
  follow: { group: "social", d: "M9 4a4 4 0 100 8 4 4 0 000-8zM2 20c0-3.6 3.2-5.5 7-5.5s7 1.9 7 5.5M19 6v6M16 9h6" },
  useful: { group: "social", d: "M6 3H3v18h3M18 3h3v18h-3M12 7.25l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4L7 10.95l3.4-.5z" },
  comment: { group: "social", d: "M4 4h16v12H9l-5 4z" },
  mention: { group: "social", d: "M12 8a4 4 0 100 8 4 4 0 000-8zM16 12v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.5 7.2" },
  bell: { group: "social", d: "M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4" },
  people: { group: "social", d: "M7 4.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17 4.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2 19c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5M12 19c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5" },
  settings: { group: "system", d: "M4 7h16M4 12h16M4 17h16M8 5v4M16 10v4M10 15v4" },
  link: { group: "system", d: "M9 15l6-6M8 8H6a4 4 0 000 8h2M16 8h2a4 4 0 010 8h-2" },
  sync: { group: "system", d: "M20 12a8 8 0 01-13.5 5.8M4 12A8 8 0 0117.5 6.2M17.5 3v3.5H14M6.5 21v-3.5H10" },
  offline: { group: "system", d: "M6 18a4.5 4.5 0 01-.5-9M9 6.5A5.5 5.5 0 0116 10a3.7 3.7 0 013.5 6M3 3l18 18" },
  warning: { group: "system", d: "M12 3l9 17H3zM12 9v5M11.5 16.5h1" },
  info: { group: "system", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M11.5 7.5h1" },
  lock: { group: "system", d: "M5 11h14v10H5zM8 11V8a4 4 0 018 0v3" },
  generic: { group: "system", d: "M6 5H3v14h3M18 5h3v14h-3M9 12h6" },
  laundry: { group: "system", d: "M4 3h16v18H4zM12 9a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM6.5 6h1M9.5 6h1" },
  calendar: { group: "system", d: "M4 6h16v15H4zM8 3v4M16 3v4M4 11h16" },
  stats: { group: "system", d: "M3 20h18M6 20v-6M11 20V8M16 20v-9" },
  location: { group: "system", d: "M12 3a6 6 0 016 6c0 5-6 12-6 12S6 14 6 9a6 6 0 016-6zM12 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" },
  clock: { group: "system", d: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l4 2" },
  bracket: { group: "system", d: "M8 3H3v18h5M16 3h5v18h-5" },
  bracketLeft: { group: "system", d: "M8 3H3v18h5" },
  bracketRight: { group: "system", d: "M16 3h5v18h-5" },
} as const;

export type IconName = keyof typeof ICONS;

/**
 * The tab bar, resolved by the Icon Pack revision imported 2026-09-07
 * (design/icons.js `TAB_BAR`). It existed because the pack's nav group is
 * four glyphs and product.md's tab bar is five tabs — lanes were guessing.
 *
 * Call borrows `verdictPending` on purpose rather than getting a glyph of
 * its own: brackets around three dots is already the pack's idiom for "no
 * verdict yet", which is what an unopened surface is. It renders in mute
 * ink with no active state and no badge. Drawing a glyph now would ship a
 * meaning we have not decided; one gets drawn when Call ships in Epic 200.
 *
 * `discover` moved nav -> social in the same revision: it is a browse
 * surface, not a v1 tab.
 */
export const TAB_BAR = [
  { tab: "Feed", icon: "feed" },
  { tab: "Closet", icon: "closet" },
  { tab: "+ Add", icon: "log" },
  { tab: "Call", icon: "verdictPending" },
  // Label is You; the glyph name stays `profile` — code name, not copy.
  { tab: "You", icon: "profile" },
] as const satisfies readonly { tab: string; icon: IconName }[];

function strokeWidthFor(size: number): number {
  if (size >= 28) return 2;
  if (size >= 20) return 1.75;
  return 1.5;
}

export function Icon({
  name,
  size = 20,
  label,
  className,
}: Readonly<{
  name: IconName;
  size?: number;
  /**
   * Accessible name; omit for purely decorative use (hidden from AT).
   */
  label?: string;
  className?: string;
}>): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidthFor(size)}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden={label === undefined ? true : undefined}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      className={className}
    >
      <path d={ICONS[name].d} />
    </svg>
  );
}
