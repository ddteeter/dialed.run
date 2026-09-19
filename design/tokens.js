/**
 * dialed.run — type, mono, spacing, radius and breakpoint tokens
 * (single source of truth; colour lives in Theme.dc.html T1 as CSS variables)
 *
 * THE POSITION
 * ------------
 * Three families, each with one job. Archivo Black says it. Archivo explains
 * it. Plex Mono measured it. A value's family tells you where it came from
 * before you read it, so the families never trade jobs and never share a size.
 *
 * THREE LAWS
 * 1. TRACKING IS A FUNCTION OF SIZE, NOT CONTEXT. Every step carries its own
 *    letter-spacing. There is no "tighter for this card". If a step's tracking
 *    looks wrong somewhere, the step is wrong, not the tracking.
 * 2. THE SCALE IS SEVEN STEPS AND A FOUR-STEP MONO RAMP. The boards drift to
 *    ~20 sizes; the system does not. COLLAPSE below says where each stray goes.
 * 3. TYPE DOES NOT SHRINK AT WIDTH. Desktop gets more room, not smaller text.
 *    Nothing below MONO.xs (10px) exists anywhere, on any ground, at any width.
 *
 * CONTRACT FOR AGENTS
 * Import TYPE, MONO, SPACE, RADIUS, BREAKPOINT, MEASURE. Never type a raw
 * font-size, letter-spacing, font-family, border-radius, gap/padding, or
 * media-query width into a screen. Colours come from T1 variables — a raw hex
 * is a review failure; a raw `0.08em` is the same failure.
 * If you need a value that isn't here, you need a different step, not a new one.
 */

export const FAMILY = {
  display: "'Archivo Black', Archivo, Helvetica, sans-serif", // says it
  text: "Archivo, Helvetica, sans-serif",                     // explains it
  mono: "'IBM Plex Mono', ui-monospace, monospace",           // measured it
};

/** Only these weights exist. Never light, never 500 in text. */
export const WEIGHT = { regular: 400, semibold: 600, bold: 700, black: 400 /* Archivo Black has one cut */ };

/**
 * THE TYPE SCALE — seven steps. px, unitless line-height, em tracking.
 * `for` is the whole job description. If your use isn't listed, pick the
 * step whose job is closest — do not invent a size between two steps.
 */
export const TYPE = {
  display: { family: 'display', size: 32, lineHeight: 1.05, tracking: -0.035, transform: 'uppercase',
    for: 'The payoff: temperature, verdict word, screen headline. Five words max. One per screen.' },
  title:   { family: 'display', size: 24, lineHeight: 1.1,  tracking: -0.03,  transform: 'none',
    for: 'Tab and sheet titles ("You", "Log a run"), the wordmark in the top bar.' },
  heading: { family: 'display', size: 19, lineHeight: 1.2,  tracking: -0.025, transform: 'none',
    for: 'Garment names on cards, section heads inside a screen, runner display names on profiles.' },
  lead:    { family: 'text',    size: 17, lineHeight: 1.5,  tracking: 0,      transform: 'none',
    for: 'The one explanatory paragraph a screen gets: onboarding prose, empty-state copy, notice body.' },
  body:    { family: 'text',    size: 15, lineHeight: 1.5,  tracking: 0,      transform: 'none',
    for: 'Everything you read: rows, feed text, buttons, inputs, tab labels, comments. Semibold for names.' },
  small:   { family: 'text',    size: 13, lineHeight: 1.45, tracking: 0,      transform: 'none',
    for: 'Secondary prose under a row or field: helper text, the theme-source line, error explanations.' },
  micro:   { family: 'text',    size: 12, lineHeight: 1.4,  tracking: 0,      transform: 'none',
    for: 'Text-family floor. Legal lines, attribution ("Weather by Visual Crossing"). Never for a control.' },
};

/**
 * THE MONO RAMP — four steps, tracking paired and fixed. Mono is the tell
 * that a value came from a sensor or a clock; it is never used for prose.
 * Uppercase is allowed at xs and sm only. Weight 400 unless `weight` says.
 */
export const MONO = {
  xs: { family: 'mono', size: 10, lineHeight: 1.3, tracking: 0.10, transform: 'uppercase',
    for: 'Eyebrows and status captions: "TOMORROW · 6:10 AM", "NEEDS A VERDICT", segment labels, chip text. Colour is muted unless it carries state.' },
  sm: { family: 'mono', size: 11, lineHeight: 1.4, tracking: 0.06, transform: 'uppercase',
    for: 'Metadata rows and inline data: "8.1 MI | 7:52 /MI | 41°F", timestamps, counts next to a filter, garment type + range.' },
  md: { family: 'mono', size: 13, lineHeight: 1.45, tracking: 0.02, transform: 'none',
    for: 'Values inside prose or a table cell: a temperature in a sentence, a token name, a table of runs. Mixed case allowed.' },
  lg: { family: 'mono', size: 22, lineHeight: 1.2, tracking: 0.02, transform: 'none',
    for: 'The data strip: the conditions line on a log or the Call. One per screen. Digits roll (see motion.js).' },
};

/**
 * COLLAPSE — where the board values go. Read as "if you find X on a board or
 * in code, it means Y". Every entry is a design correction we are asking for,
 * not a value we are keeping.
 */
export const COLLAPSE = {
  type: {
    '30px display': 'TYPE.display', '34px+ display': 'TYPE.display (clamp only on brand/marketing pages, never in-app)',
    '21px text': 'TYPE.lead',  '16px text': 'TYPE.body',  '14px text': 'TYPE.body for controls and rows, TYPE.small for helper prose',
    '12px mono': 'MONO.sm',    '9px mono': 'MONO.xs (the T3 theme segment was drawn at 9px; that is a board error)',
    '22px+ mono heroes': 'MONO.lg',
  },
  tracking: {
    'mono 10px @ 0.06 / 0.04 / 0.08 / 0.03em': 'MONO.xs → 0.10em. Tracking follows size; the context never adjusts it.',
    'mono 11px @ 0.04 / 0.08 / 0.10em': 'MONO.sm → 0.06em',
    'mono 12–13px @ 0.04–0.06em': 'MONO.md → 0.02em',
    'display @ -0.02em': 'the step\'s own tracking (title -0.03, heading -0.025)',
    '"0.12em" board eyebrows': 'MONO.xs → 0.10em (0.12 was the document-board eyebrow, not the product)',
  },
};

/** SPACING — a 4px step. Nothing else. 1px and 2px exist only as border widths. */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 };
export const SPACE_RULES = [
  'Inside a row or chip: SPACE[2]–SPACE[3]. Between rows: SPACE[2]. Between groups: SPACE[6]. Screen edge: SPACE[5] on phone, SPACE[6] at width.',
  'Odd board values (5, 6, 7, 9, 10, 11, 14, 18, 22, 28) collapse to the nearest step. 14 → 16. 18 → 16. 22 → 24. 28 → 32.',
  'Hit targets are ≥ 44px tall regardless of the type step inside them. Padding grows; type does not.',
];

/**
 * RADII — five, plus none. The brand's square notice blocks (hi-viz band,
 * explanation tints, the "Add the brand too" note) are RADIUS.none on purpose:
 * square is the tell for "this is a statement, not a control".
 */
export const RADIUS = {
  none: 0,    // notices, tints, the failure band, coverage cells, verdict slots
  tight: 4,   // meter bars, small data cells
  field: 8,   // inputs, textareas, the search field at width (boards: 9 → 8)
  card: 12,   // cards, rows that stand alone, photo wells (boards: 14 → 12)
  sheet: 20,  // sheets, drawers, the centred panel at width (boards: 18/22 → 20)
  pill: 999,  // buttons, chips, segments, avatars, the bell badge
};
export const RADIUS_RULES = [
  'The 26px phone-artboard corner is the drawing\'s device frame, not a token. Nothing in-app uses it.',
  'A card inside a sheet steps down one radius (sheet → card). Never nest the same radius twice.',
  'Filled action buttons are always pill. Text in a pill never wraps — shorten the copy.',
];

/**
 * BREAKPOINTS — two thresholds, three layouts. Widths are min-width, px.
 * See Desktop Contract.dc.html for what changes and what is forbidden.
 */
export const BREAKPOINT = {
  wide: 720,  // tab bar → top bar; content becomes one centred column at MEASURE.column; sheets become the centred panel
  desk: 1040, // two columns permitted (Feed X, Closet C, Verdict backlog DS1). Never three.
};

/** MEASURES — the only widths a layout may pin. */
export const MEASURE = {
  panel: 390,   // the phone width. Every "centred at phone width" surface is exactly this wide.
  column: 620,  // one column of reading or a list at width. Also the Operator document measure.
  page: 1180,   // the shell's content max-width at desk. Boards drawn at 1440 use this inside 24px gutters.
};
export const MEASURE_RULES = [
  'The Operator boards\' 980px measure is a one-off: collapse to MEASURE.page for tables, MEASURE.column for documents.',
  'Between wide and desk the content column is min(100% − 2×SPACE[6], MEASURE.column). Never a fluid two-column.',
  'Nothing pins a width that isn\'t in MEASURE. Sidebars and rails inherit from the grid, not from a px.',
];

/** Paste-ready custom properties. Keep in sync with the objects above. */
const step = (t) => `${t.size}px/${t.lineHeight} ${FAMILY[t.family]}`;
export const CSS_VARS = `:root {
  --font-display: ${FAMILY.display};
  --font-text: ${FAMILY.text};
  --font-mono: ${FAMILY.mono};
${Object.entries(TYPE).map(([k, t]) => `  --type-${k}: ${step(t)};\n  --track-${k}: ${t.tracking}em;`).join('\n')}
${Object.entries(MONO).map(([k, t]) => `  --mono-${k}: ${step(t)};\n  --track-mono-${k}: ${t.tracking}em;`).join('\n')}
${Object.entries(SPACE).map(([k, v]) => `  --space-${k}: ${v}px;`).join('\n')}
${Object.entries(RADIUS).map(([k, v]) => `  --radius-${k}: ${v}px;`).join('\n')}
  --measure-panel: ${MEASURE.panel}px;
  --measure-column: ${MEASURE.column}px;
  --measure-page: ${MEASURE.page}px;
}
/* Media queries: write them with these exact values, nothing else. */
/* @media (min-width: ${BREAKPOINT.wide}px)  → wide */
/* @media (min-width: ${BREAKPOINT.desk}px)  → desk */`;

/**
 * LINT — each entry is one rule a stylelint/ESLint plugin can enforce.
 * `reject` is what a raw match looks like; `allow` is the only legal form.
 */
export const LINT = [
  { id: 'no-raw-font-size',     reject: /font-size:\s*\d/,                allow: 'font: var(--type-*) | var(--mono-*)' },
  { id: 'no-raw-tracking',      reject: /letter-spacing:\s*-?[\d.]+(em|px)/, allow: 'letter-spacing: var(--track-*)' },
  { id: 'no-raw-font-family',   reject: /font-family:\s*['"A-Za-z]/,      allow: 'var(--font-display|text|mono) — or omit; --type-*/--mono-* already carry the family' },
  { id: 'no-raw-radius',        reject: /border-radius:\s*[1-9]/,          allow: 'var(--radius-*)  (0 is allowed literally)' },
  { id: 'no-raw-spacing',       reject: /(padding|margin|gap|inset|top|left|right|bottom):\s*[^v0;]*\d{1,2}px/, allow: 'var(--space-*). 1px/2px permitted on border-width only.' },
  { id: 'no-raw-breakpoint',    reject: /min-width:\s*\d+px/,             allow: `${BREAKPOINT.wide}px or ${BREAKPOINT.desk}px only — export from here, don't retype` },
  { id: 'no-raw-measure',       reject: /(max-)?width:\s*(390|620|1180|980|1440)px/, allow: 'var(--measure-*)' },
  { id: 'mono-is-not-prose',    reject: 'a --mono-* step on an element with > 40 characters of non-numeric text', allow: 'TYPE.small or TYPE.body' },
  { id: 'uppercase-floor',      reject: 'text-transform: uppercase on any --type-* step except display', allow: 'MONO.xs / MONO.sm / TYPE.display only' },
];
