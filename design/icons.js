/**
 * dialed.run — icon manifest (single source of truth)
 *
 * CONTRACT FOR AGENTS
 * -------------------
 * Every icon is a 24×24 monoline glyph expressed as ONE SVG path `d` string.
 * Render with:
 *
 *   <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
 *        stroke="currentColor" stroke-width="1.75"
 *        stroke-linecap="square" stroke-linejoin="miter">
 *     <path d={ICONS[name].d} />
 *   </svg>
 *
 * RULES
 * - Stroke, never fill. `fill="none"` always.
 * - Square caps + miter joins. No rounded ends — the type is Archivo Black;
 *   the icons match that squared, engineered feel.
 * - stroke-width 1.75 at 20–24px. Use 2 at 28px+, 1.5 at 16px. Never below 16px.
 * - Color comes from `currentColor`. Never hardcode a hex in an icon.
 * - Do not scale a glyph non-uniformly, rotate it, or add a second color.
 * - Verdict + [GENERIC] icons are drawn inside the brand brackets on purpose.
 *   Those five are the only glyphs allowed to carry the bracket motif.
 *
 * ADDING AN ICON
 * Draw on the 24 grid, keep the live area within 3–21, snap to whole or half
 * units, add it to the right group below with searchable keywords, and it shows
 * up in "Icon Pack.dc.html" automatically. Don't fork this file.
 */

export const GROUPS = [
  { id: 'nav', label: 'Navigation', note: 'Tab bar and top-level surfaces. Five, and only five.' },
  { id: 'garment', label: 'Garments', note: 'Closet categories. One glyph per category the taxonomy allows.' },
  { id: 'weather', label: 'Weather', note: 'Conditions shown on run cards and recommendations.' },
  { id: 'verdict', label: 'Verdicts', note: 'How the outfit actually felt. Bracketed — these are the brand moment.' },
  { id: 'action', label: 'Actions', note: 'Buttons, toolbars, row affordances.' },
  { id: 'social', label: 'Social', note: 'Feed, follows, and the "found useful" signal.' },
  { id: 'system', label: 'System', note: 'Settings, connections, states, and failure modes.' },
];

export const ICONS = {
  // ── NAVIGATION ────────────────────────────────────────────────
  feed: { group: 'nav', keywords: 'home timeline cards runs', d: 'M3 5h18v5H3zM3 14h18v5H3z' },
  closet: { group: 'nav', keywords: 'wardrobe gear collection hanger', d: 'M10 6a2 2 0 114 0c0 1.5-2 2-2 4M3 17l9-7 9 7v2H3z' },
  log: { group: 'nav', keywords: 'add run attach outfit center action', d: 'M6 3H3v18h3M18 3h3v18h-3M12 8v8M8 12h8' },
  discover: { group: 'nav', keywords: 'explore browse compass find runners', d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5z' },
  profile: { group: 'nav', keywords: 'me account you person', d: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 21c0-4 3.6-6 8-6s8 2 8 6' },

  // ── GARMENTS ──────────────────────────────────────────────────
  singlet: { group: 'garment', keywords: 'tank top sleeveless racing', d: 'M8 4h2a2 2 0 004 0h2c-1 2-1 4 1 6v10H7V10c2-2 2-4 1-6z' },
  tee: { group: 'garment', keywords: 'short sleeve shirt top t-shirt', d: 'M9 4a3 3 0 006 0l5 3-1.5 3.5-2.5-1V20H8v-10.5l-2.5 1L4 7z' },
  longSleeve: { group: 'garment', keywords: 'long sleeve top shirt base layer', d: 'M9 4a3 3 0 006 0l5 3 1.5 10.5-3 .5-2-7.5V20h-9v-9.5l-2 7.5-3-.5L4 7z' },
  halfZip: { group: 'garment', keywords: 'quarter zip pullover midlayer', d: 'M9 4h6l5 3 1.5 10.5-3 .5-2-7.5V20h-9v-9.5l-2 7.5-3-.5L4 7zM9 4V2.5h6V4M12 4v6' },
  jacket: { group: 'garment', keywords: 'shell windbreaker rain coat outer hood', d: 'M8.5 7a3.5 3.5 0 017 0l4.5 2.5 1.5 9.5-3 .5-2-7V21h-9v-8.5l-2 7-3-.5L4 9.5zM12 7v14' },
  vest: { group: 'garment', keywords: 'sleeveless jacket gilet puffer', d: 'M9 4h6l4 2.5V20H5V6.5zM9 4c0 3-1.5 5-4 6M15 4c0 3 1.5 5 4 6M12 4v16' },
  shorts: { group: 'garment', keywords: 'split shorts 5 inch 7 inch bottoms', d: 'M5 5h14l1 5-1 8h-5.5L12 12l-1.5 6H5l-1-8zM5.5 8.5h13' },
  halfTights: { group: 'garment', keywords: 'half tight compression shorts lycra spandex', d: 'M6 5h12l.5 3-1 11h-4L12 11l-1.5 8h-4L5.5 8zM6 8h12' },
  tights: { group: 'garment', keywords: 'leggings pants long bottoms', d: 'M7 4h10l.5 4-.5 13h-4L12 10l-1 11H7L6.5 8zM7 7h10' },
  socks: { group: 'garment', keywords: 'sock crew ankle', d: 'M9 3h6v9l3.5 3a3 3 0 01-4 4.5L9 15.5zM9 6h6' },
  shoes: { group: 'garment', keywords: 'shoe sneakers footwear road trail', d: 'M2.5 17.5c2-1 4.5-2 6.5-4.5L12 9l2 1 3-1.5c1.5 0 2.5 1.5 3 2.5l1.5 6.5H2.5zM2.5 17.5v2h19v-2M10 12.5l1.5-1.5M11.5 14.5l1.5-1.5' },
  gloves: { group: 'garment', keywords: 'mitten hands warm extremities', d: 'M9 21V13.5L6.5 12a2 2 0 011.5-3.5L9 9.5V7a4 4 0 018 0v14zM9 17h8' },
  cap: { group: 'garment', keywords: 'hat ball cap trucker brim visor sun', d: 'M3 14v-1a7 7 0 0114 0v1M3 14h14c2.5 0 4 .5 5 2-1.5 1-3 1.5-5.5 1.5H3z' },
  beanie: { group: 'garment', keywords: 'hat winter warm head', d: 'M12 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM5 16a7 7 0 0114 0M4 16h16v4H4z' },
  headband: { group: 'garment', keywords: 'ear warmer band head', d: 'M3 16a9 9 0 0118 0M6 16a6 6 0 0112 0M3 16h3M18 16h3' },
  sunglasses: { group: 'garment', keywords: 'shades eyewear glasses sun wraparound', d: 'M3 9h18l-1.5 6H14.5L12 12.5 9.5 15H4.5zM3 9L2 8M21 9l1-1' },
  neckGaiter: { group: 'garment', keywords: 'neck gaiter buff warmer tube', d: 'M9 8a3 3 0 016 0M8 9h8l1.5 3-1 8h-9l-1-8zM8.5 13.5h7M8.3 16.5h7.4' },

  // ── WEATHER ───────────────────────────────────────────────────
  clear: { group: 'weather', keywords: 'sun sunny bright fine', d: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' },
  partlyCloudy: { group: 'weather', keywords: 'sun cloud broken mixed', d: 'M12 7.25a3.5 3.5 0 10-3.4 3.75M8.5 2.5V4M3 7.5h1.5M4.6 3.6l1.1 1.1M12.4 3.6l-1.1 1.1M17 19a3.5 3.5 0 000-7A5 5 0 008.8 13.3A3 3 0 008 19z' },
  cloudy: { group: 'weather', keywords: 'overcast grey cloud', d: 'M6.75 18a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 11.6A3.25 3.25 0 0117.75 18z' },
  rainLight: { group: 'weather', keywords: 'drizzle shower wet damp', d: 'M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM9.75 18l-1 3M15.25 18l-1 3' },
  rainHeavy: { group: 'weather', keywords: 'downpour soaked storm wet', d: 'M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM8 18l-1 3M12.5 18l-1 3M17 18l-1 3' },
  snow: { group: 'weather', keywords: 'snowing flake ice winter', d: 'M6.75 15a3.75 3.75 0 010-7.5A5.5 5.5 0 0117 8.6A3.25 3.25 0 0117.75 15zM9 17.5v4M7.2 18.5l3.6 2M10.8 18.5l-3.6 2M15 17.5v4M13.2 18.5l3.6 2M16.8 18.5l-3.6 2' },
  wind: { group: 'weather', keywords: 'windy gust breeze chill', d: 'M2 9h12a3 3 0 10-3-4M2 15h14a3 3 0 11-3 4M2 12h8' },
  humidity: { group: 'weather', keywords: 'humid dewpoint moisture sticky', d: 'M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11zM12 17a3 3 0 003-3' },
  dawn: { group: 'weather', keywords: 'sunrise early morning dusk golden', d: 'M8 15a4 4 0 018 0M2 15h3M19 15h3M12 3v4M6 8.5L7.5 10M18 8.5L16.5 10M3 19h18' },
  night: { group: 'weather', keywords: 'dark moon evening late', d: 'M20 15A9 9 0 0110 4a8 8 0 1010 11z' },
  thermometer: { group: 'weather', keywords: 'temperature degrees feels like temp', d: 'M10 4.5a2 2 0 014 0V14a3.5 3.5 0 11-4 0zM12 8v6' },

  // ── VERDICTS (bracketed) ──────────────────────────────────────
  verdictDialed: { group: 'verdict', keywords: 'perfect nailed it worked right correct', d: 'M6 3H3v18h3M18 3h3v18h-3M8 12l3 3 5-6' },
  verdictCold: { group: 'verdict', keywords: 'too cold freezing underdressed', d: 'M6 3H3v18h3M18 3h3v18h-3M12 8v8M8.5 12h7M9.7 9.7l4.6 4.6M14.3 9.7l-4.6 4.6' },
  verdictWarm: { group: 'verdict', keywords: 'too hot overdressed sweaty', d: 'M6 3H3v18h3M18 3h3v18h-3M7.5 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0M7.5 12.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0M7.5 16c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0' },
  verdictMixed: { group: 'verdict', keywords: 'ok fine close borderline half right', d: 'M6 3H3v18h3M18 3h3v18h-3M8 13c1-1.6 2.7-1.6 4 0s3 1.6 4 0' },
  verdictPending: { group: 'verdict', keywords: 'no verdict unlogged awaiting missing', d: 'M6 3H3v18h3M18 3h3v18h-3M7.5 12h1M11.5 12h1M15.5 12h1' },

  // ── ACTIONS ───────────────────────────────────────────────────
  add: { group: 'action', keywords: 'plus new create garment', d: 'M12 4v16M4 12h16' },
  camera: { group: 'action', keywords: 'photo shoot capture garment picture', d: 'M3 8h4l2-2h6l2 2h4v12H3zM12 10.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z' },
  edit: { group: 'action', keywords: 'rename pencil change name piece', d: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4' },
  remove: { group: 'action', keywords: 'delete trash bin discard retire', d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6' },
  search: { group: 'action', keywords: 'find lookup query filter closet', d: 'M11 4a7 7 0 100 14 7 7 0 000-14zM16 16l5 5' },
  filter: { group: 'action', keywords: 'refine narrow conditions facets', d: 'M3 5h18l-7 8v6l-4 2v-8z' },
  sort: { group: 'action', keywords: 'order arrange rank list', d: 'M4 6h16M6 12h12M9 18h6' },
  share: { group: 'action', keywords: 'send export post outfit', d: 'M12 3v12M7 8l5-5 5 5M4 15v6h16v-6' },
  save: { group: 'action', keywords: 'bookmark keep saved outfit', d: 'M6 3h12v18l-6-5-6 5z' },
  duplicate: { group: 'action', keywords: 'copy outfit reuse wear again', d: 'M8 8h13v13H8zM16 8V3H3v13h5' },
  more: { group: 'action', keywords: 'kebab overflow menu options', d: 'M11 5h2v2h-2zM11 11h2v2h-2zM11 17h2v2h-2z' },
  close: { group: 'action', keywords: 'dismiss cancel x exit', d: 'M5 5l14 14M19 5L5 19' },
  back: { group: 'action', keywords: 'previous chevron left return', d: 'M15 5l-7 7 7 7' },
  forward: { group: 'action', keywords: 'next chevron right continue', d: 'M9 5l7 7-7 7' },
  check: { group: 'action', keywords: 'done confirm selected tick', d: 'M4 13l5 5L20 6' },
  drag: { group: 'action', keywords: 'reorder handle move grip', d: 'M8 8h8M8 12h8M8 16h8' },
  undo: { group: 'action', keywords: 'revert back out mistake', d: 'M4 9h11a5 5 0 010 10h-6M4 9l4-4M4 9l4 4' },

  // ── SOCIAL ────────────────────────────────────────────────────
  follow: { group: 'social', keywords: 'add runner friend subscribe', d: 'M9 4a4 4 0 100 8 4 4 0 000-8zM2 20c0-3.6 3.2-5.5 7-5.5s7 1.9 7 5.5M19 6v6M16 9h6' },
  useful: { group: 'social', keywords: 'found useful helpful upvote signal star', d: 'M6 3H3v18h3M18 3h3v18h-3M12 7.25l1.6 3.2 3.4.5-2.5 2.4.6 3.4-3.1-1.6-3.1 1.6.6-3.4L7 10.95l3.4-.5z' },
  comment: { group: 'social', keywords: 'reply discuss note thread', d: 'M4 4h16v12H9l-5 4z' },
  mention: { group: 'social', keywords: 'at tag handle username', d: 'M12 8a4 4 0 100 8 4 4 0 000-8zM16 12v1.5a2.5 2.5 0 005 0V12a9 9 0 10-3.5 7.2' },
  bell: { group: 'social', keywords: 'notification alert reminder nudge', d: 'M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4' },
  people: { group: 'social', keywords: 'community runners group followers', d: 'M7 4.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM17 4.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2 19c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5M12 19c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5' },

  // ── SYSTEM ────────────────────────────────────────────────────
  settings: { group: 'system', keywords: 'preferences gear options config', d: 'M4 7h16M4 12h16M4 17h16M8 5v4M16 10v4M10 15v4' },
  link: { group: 'system', keywords: 'connect strava integration chain', d: 'M9 15l6-6M8 8H6a4 4 0 000 8h2M16 8h2a4 4 0 010 8h-2' },
  sync: { group: 'system', keywords: 'refresh reload retry update', d: 'M20 12a8 8 0 01-13.5 5.8M4 12A8 8 0 0117.5 6.2M17.5 3v3.5H14M6.5 21v-3.5H10' },
  offline: { group: 'system', keywords: 'no connection cloud off disconnected', d: 'M6 18a4.5 4.5 0 01-.5-9M9 6.5A5.5 5.5 0 0116 10a3.7 3.7 0 013.5 6M3 3l18 18' },
  warning: { group: 'system', keywords: 'error problem broken attention alert', d: 'M12 3l9 17H3zM12 9v5M11.5 16.5h1' },
  info: { group: 'system', keywords: 'help explain why detail', d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M11.5 7.5h1' },
  lock: { group: 'system', keywords: 'private privacy closet hidden secure', d: 'M5 11h14v10H5zM8 11V8a4 4 0 018 0v3' },
  generic: { group: 'system', keywords: 'unnamed placeholder GENERIC badge nudge', d: 'M6 5H3v14h3M18 5h3v14h-3M9 12h6' },
  laundry: { group: 'system', keywords: 'wash dirty clean cycle deferred', d: 'M4 3h16v18H4zM12 9a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM6.5 6h1M9.5 6h1' },
  calendar: { group: 'system', keywords: 'date week history schedule', d: 'M4 6h16v15H4zM8 3v4M16 3v4M4 11h16' },
  stats: { group: 'system', keywords: 'chart data insights trends bars', d: 'M3 20h18M6 20v-6M11 20V8M16 20v-9' },
  location: { group: 'system', keywords: 'place pin climate where route', d: 'M12 3a6 6 0 016 6c0 5-6 12-6 12S6 14 6 9a6 6 0 016-6zM12 7a2.5 2.5 0 100 5 2.5 2.5 0 000-5z' },
  clock: { group: 'system', keywords: 'time duration when pace', d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l4 2' },
  bracket: { group: 'system', keywords: 'logo brand mark wordmark app icon', d: 'M8 3H3v18h5M16 3h5v18h-5' },
  bracketLeft: { group: 'system', keywords: 'bracket half left frame motion reveal', d: 'M8 3H3v18h5' },
  bracketRight: { group: 'system', keywords: 'bracket half right frame motion reveal', d: 'M16 3h5v18h-5' },
};

export const ICON_NAMES = Object.keys(ICONS);
export const COUNT = ICON_NAMES.length;

/** Returns the full SVG markup string for an icon — used by the copy button. */
export function iconMarkup(name, size = 24, stroke = 1.75) {
  const icon = ICONS[name];
  if (!icon) return '';
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="${icon.d}" /></svg>`;
}
