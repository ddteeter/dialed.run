import type { JSX, ReactNode } from "react";

import { focusOnMount } from "./focus-on-mount";
import { PhoneBell } from "./PhoneBell";
import { useHydrated } from "./use-hydrated";

/**
 * The column an authenticated page's content sits in, and its heading.
 *
 * Seven routes had written this out by hand — the same `mx-auto flex
 * w-full max-w-* flex-col gap-6 px-6 py-8` column and, in six of them, the
 * same `m-0 font-display text-3xl uppercase leading-none` heading. They
 * differed in three things and nothing else: how wide the column is, what
 * the heading says, and whether something sits opposite the heading.
 * Those three are the props.
 *
 * `Layout` is still the caller's to supply, and deliberately: it takes the
 * notification bell, which lives in `modules/notifications`, and `ui/` is
 * foundation that may not import from `modules/` (CLAUDE.md architecture
 * rules; enforced by dependency-cruiser). So a route wears `Layout` on the
 * outside and this on the inside.
 */
/**
 * The runner app's one column at width (Round 54 · 168.1): MEASURE.column,
 * **centred** in the window from 720 up, and the phone's own full width
 * below it. The cap starts at 720, not at the measure: DS4 has a phone
 * screen fluid from 320 to 719 ("nothing pins a width"), so a 620–719
 * window fills, and a full-bleed header (the Call's, P3's band) reaches
 * both edges there as on a 390 phone (#703 R2-ONB-03). It replaces DS3's
 * "left-aligned inside the page measure", and the 390 panel that run
 * detail, edit garment, notifications and the Call wore at width.
 *
 * Exported because a screen that draws its own column (the feed's, a
 * garment's) is the same column, and a second copy of the class is how
 * the left-aligned one survived on half of them.
 */
export const COLUMN = "mx-auto w-full wide:max-w-column";

/**
 * **`column`** is every signed-in screen, and the root crash. **`page`**
 * is the closet list's MEASURE.page, for a system state that replaces it
 * (R55·185). There is no 390 panel: 168.1 withdrew it at width, and the
 * signed-out screens draw their own (`SignedOutPanel`).
 */
type PageWidth = "column" | "page" | "step" | "close" | "table";

/**
 * An onboarding step: the phone's own width below 720, fluid as DS4 has
 * every phone screen ("nothing pins a width"), and from 720 the centred
 * column every other screen is (168.1; R56·245 withdrew 138a's 390 panel).
 * So a step on a 430 phone starts on the wordmark's gutter, not 20 inside
 * it (#703 R2-ONB-03). P3's close is the same width, with its band held to
 * the column (`NowGoRun`); the two stay separate names because #654 may
 * part them again.
 */
const STEP = COLUMN;

/**
 * Gutters belong to the page, never to a column (R57·263, tokens.js
 * MEASURE_RULES): a 620 column is 620 of content, centred on the page's
 * axis (x=330 at 1280). So from 720 a column drops the phone's 24, and
 * the measure alone sets its edge. The page measure has its gutters
 * inside it, so it keeps them.
 */
const COLUMN_GUTTER_CLASS = "px-6 wide:px-0";

const WIDTH_CLASS: Readonly<Record<PageWidth, string>> = {
  column: `${COLUMN} ${COLUMN_GUTTER_CLASS}`,
  page: "mx-auto w-full max-w-page px-6",
  step: `${STEP} ${COLUMN_GUTTER_CLASS}`,
  close: `${STEP} ${COLUMN_GUTTER_CLASS}`,
  // The Desk's tables, Runners, Codes and Review (Round 54 · 168.3): the
  // whole width beside the rail, up to MEASURE.page, left-aligned.
  table: "max-w-page px-6",
};

export function Page({
  title,
  kicker,
  width = "column",
  headingAction,
  back,
  focusTitle = false,
  children,
}: Readonly<{
  /**
   * Omitted by a page whose own content owns the heading — run detail is
   * the one, where `RunDetail` renders it.
   */
  title?: string | undefined;
  /**
   * Sits above the heading in one group with it, as an onboarding step's
   * progress does (`OnboardingProgress`, round 47 #120).
   */
  kicker?: ReactNode;
  width?: PageWidth | undefined;
  /**
   * Sits opposite the heading, e.g. the "+ Add" link on Runs.
   *
   * Not named `action`: the typed-routing lint rule matches any `/…`
   * literal *descended from* a `href`/`action` JSX attribute, which is
   * `<form action="/url">` — the thing it exists to catch. A `<Link
   * to="/runs/new">` passed through a prop of that name trips it, and the
   * rule is right to be suspicious of the name rather than wrong about
   * this case.
   */
  headingAction?: ReactNode;
  /**
   * A sub-page's way back. It sits above the heading, where a back link
   * belongs, and the phone's bell shares its row (Design 169.1), so the
   * heading row then holds no bell.
   */
  back?: ReactNode;
  /**
   * Lands focus on the heading when the page mounts — for a screen arrived
   * at from somewhere that said to read it again, as T1 is from a refused
   * Strava receipt's Try again (round 39, #66). Off by default.
   */
  focusTitle?: boolean | undefined;
  children: ReactNode;
}>): JSX.Element {
  // Onboarding renders `Page` with no `Layout`, so this is where those
  // screens get their hydration signal. Harmless when both are present —
  // the attribute is set to the same value twice.
  useHydrated();

  return (
    <div
      // The phone's `px-6` is left alone: dropping it to SPACE[5] to
      // complete DS3's "SPACE[5] → SPACE[6]" would move every screen this
      // wraps on a device this lane is not here to touch. Each width says
      // its own gutter, since a column has none from 720.
      className={`flex w-full ${WIDTH_CLASS[width]} flex-col gap-6 py-8`}
    >
      {back === undefined ? undefined : (
        <div
          data-part="page-back"
          className="flex items-center justify-between"
        >
          {back}
          <PhoneBell />
        </div>
      )}
      {title === undefined ? undefined : (
        // The row is unconditional rather than appearing with `headingAction`,
        // so a heading does not shift when one is added: `justify-between`
        // with a single child puts it exactly where a block-level `h1`
        // sits. `m-0` because the column's `gap-6` owns the spacing.
        <PageHeading kicker={kicker}>
          <div className="flex items-center justify-between gap-3">
            <h1
              ref={focusTitle ? focusOnMount : undefined}
              tabIndex={focusTitle ? -1 : undefined}
              className="m-0 font-display text-display uppercase"
            >
              {title}
            </h1>
            {/* The title's action, then the phone's bell: the bell is the
                row's last thing (Design 169.1), unless a back row above
                already holds it. */}
            <div className="flex items-center gap-3">
              {headingAction}
              {back === undefined ? <PhoneBell /> : undefined}
            </div>
          </div>
        </PageHeading>
      )}
      {children}
    </div>
  );
}

/**
 * The heading row, and the kicker over it when there is one: one group,
 * so the two sit SPACE[2] apart (tokens.js: "Inside a row or chip:
 * SPACE[2]–SPACE[3]") rather than at the column's gap between groups.
 */
function PageHeading({
  kicker,
  children,
}: Readonly<{ kicker: ReactNode; children: ReactNode }>): JSX.Element {
  return kicker === undefined ? (
    <>{children}</>
  ) : (
    <div className="flex flex-col gap-2">
      {kicker}
      {children}
    </div>
  );
}
