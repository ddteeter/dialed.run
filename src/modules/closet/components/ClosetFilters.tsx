import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { useId, useState } from "react";

import {
  uiGroupLabels,
  uiGroups,
  verdictCoverages,
  type TempUnit,
  type UiGroup,
  type VerdictCoverage,
} from "../../../lib/contracts";
import { CoverageMark, Mono } from "../../../ui";
import type { RailCounts } from "../filters";
import type { ClosetSearch } from "../inputs";
import { useIsHydrated } from "./use-is-hydrated";
import { WorksAt, worksAtLabel } from "./WorksAt";

/**
 * Closet C's three filter groups (R-94, design 174): GROUP with counts,
 * WORKS AT, COVERAGE — the desk's rail, or below 1040 the phone's chip
 * row (round 46 #109b).
 *
 * **Every filter works before hydration.** GROUP and COVERAGE are links
 * to the closet with the search changed, and WORKS AT is a GET form that
 * names its unit. Hydrated, COVERAGE's levels are toggle buttons and
 * WORKS AT is its bar (#109f, #109h).
 *
 * **Monochrome** (§AB; round 16: *"nothing in the rail carries a hue"*):
 * ink swatches and an ink span (owner, 2026-11-05; #109c).
 */

/**
The screen's word for each level. The ladder's "unknown" is a garment's "untested".
*/
export const coverageWords: Readonly<Record<VerdictCoverage, string>> = {
  covered: "Covered",
  partial: "Partial",
  unknown: "Untested",
};

export type FiltersVariant = "rail" | "chips";

export interface ClosetFiltersProps {
  variant: FiltersVariant;
  search: ClosetSearch;
  counts: RailCounts;
  /**
  WORKS AT's bounds, from the closet's own pieces; none when no piece states a range.
  */
  span: { lowC: number; highC: number } | undefined;
  tempUnit: TempUnit;
  /**
  The hydrated controls' navigation: the whole next search. Without one
  every control works as it does before hydration.
  */
  onSearch?: ((next: ClosetSearch) => void) | undefined;
}

/**
 * The look of one choice. A rail row is text, bold when chosen (board C);
 * a chip is a pill, ink when chosen, as every chosen chip in the app is.
 * The chosen state is `aria-current` on a link and `aria-pressed` on a
 * toggle, so both are styled — by the attribute's presence, because a
 * link to exactly this page is `aria-current="page"` (the router's) and
 * the chosen COVERAGE link, which leads away to clear it, is `"true"`.
 * What the two share is its own constant, `target` in it, so a reader —
 * and the 44px check, which resolves string constants only — sees it.
 */
const CHOICE_BASE = "target flex items-center gap-2 text-ink no-underline";

const CHOICE_CLASS: Readonly<Record<FiltersVariant, string>> = {
  rail: "text-body [&[aria-current]]:font-bold aria-pressed:font-bold",
  chips:
    "rounded-pill border border-hairline px-3 py-1 text-small [&[aria-current]]:border-ink [&[aria-current]]:bg-ink [&[aria-current]]:text-ground aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ground",
};

const GROUP_CLASS: Readonly<Record<FiltersVariant, string>> = {
  rail: "m-0 flex list-none flex-col gap-2 p-0",
  chips: "m-0 flex list-none flex-wrap gap-2 p-0",
};

/**
One choice in a group: what it reads, its count, and where it leads.
*/
interface FilterOption {
  label: ReactNode;
  count: number;
  isCurrent: boolean;
  search: ClosetSearch;
}

function GroupHeading({ children }: Readonly<{ children: string }>) {
  return (
    <h2 className="m-0">
      <Mono step="xs" className="text-label">
        {children}
      </Mono>
    </h2>
  );
}

function OptionBody({ option }: Readonly<{ option: FilterOption }>) {
  return (
    <>
      {option.label}{" "}
      <Mono step="xs" className="text-label">
        {option.count}
      </Mono>
    </>
  );
}

/**
 * A group of choices. As links — the closet with the search changed — each
 * works before hydration, the chosen one `aria-current`. Given `onPick`,
 * as toggle buttons instead: `aria-pressed`, at most one pressed, because
 * pressing the pressed one lets it go (#109f: *"a radio can't be unset"*).
 */
function FilterGroup({
  title,
  variant,
  options,
  onPick,
}: Readonly<{
  title: string;
  variant: FiltersVariant;
  options: readonly FilterOption[];
  onPick?: ((next: ClosetSearch) => void) | undefined;
}>): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading>{title}</GroupHeading>
      <ul className={GROUP_CLASS[variant]}>
        {/* A group's options are a fixed list in a fixed order, so where
            one sits is what it is. */}
        {options.map((option, index) => (
          <li key={index}>
            {onPick === undefined ? (
              <Link
                to="/closet"
                search={option.search}
                // Exact, or a link whose search is a part of this one's —
                // All while Tops is set — would be called current too.
                activeOptions={{ exact: true }}
                aria-current={option.isCurrent ? "true" : undefined}
                className={`${CHOICE_BASE} ${CHOICE_CLASS[variant]}`}
              >
                <OptionBody option={option} />
              </Link>
            ) : (
              <button
                type="button"
                aria-pressed={option.isCurrent}
                onClick={() => {
                  onPick(option.search);
                }}
                className={`${CHOICE_BASE} ${CHOICE_CLASS[variant]}`}
              >
                <OptionBody option={option} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * GROUP: All, then the six in screen C's order, each with its count. A
 * group the closet holds nothing in still shows, at 0, so the list does
 * not change shape as pieces come and go.
 */
function groupOptions(
  search: ClosetSearch,
  counts: RailCounts,
): FilterOption[] {
  const unset = { ...search, group: undefined };
  return [
    {
      label: "All",
      count: counts.all,
      isCurrent: search.group === undefined,
      search: unset,
    },
    ...uiGroups.map((group: UiGroup) => ({
      label: uiGroupLabels[group],
      count: counts.groups.get(group) ?? 0,
      isCurrent: search.group === group,
      search: { ...unset, group },
    })),
  ];
}

/**
 * COVERAGE: covered, partial, untested, each with an ink swatch and a
 * count. Choosing the chosen level again clears it (owner, 2026-11-05;
 * #109f): there is no "All" here, and none is added.
 */
function coverageOptions(
  search: ClosetSearch,
  counts: RailCounts,
): FilterOption[] {
  const unset = { ...search, coverage: undefined };
  return verdictCoverages.map((level) => ({
    label: (
      <>
        <CoverageMark level={level} />
        {coverageWords[level]}
      </>
    ),
    count: counts.coverage.get(level) ?? 0,
    isCurrent: search.coverage === level,
    search: search.coverage === level ? unset : { ...unset, coverage: level },
  }));
}

type GroupKey = "group" | "worksAt" | "coverage";

/**
The three controls, keyed, so the rail and the chip row draw the same ones.
*/
function useControls(
  props: Readonly<ClosetFiltersProps>,
): Readonly<Record<GroupKey, JSX.Element>> {
  const { variant, search, counts, onSearch } = props;
  const isHydrated = useIsHydrated();
  return {
    group: (
      <FilterGroup
        title="Group"
        variant={variant}
        options={groupOptions(search, counts)}
      />
    ),
    worksAt: <WorksAt {...props} />,
    coverage: (
      <FilterGroup
        title="Coverage"
        variant={variant}
        options={coverageOptions(search, counts)}
        onPick={isHydrated ? onSearch : undefined}
      />
    ),
  };
}

/**
 * Each chip's `GROUP · VALUE` (#109b): unset reads ALL, and WORKS AT's
 * unset reads ANY.
 */
export function chipValues(
  search: ClosetSearch,
  tempUnit: TempUnit,
): Readonly<Record<GroupKey, string>> {
  return {
    group: search.group === undefined ? "All" : uiGroupLabels[search.group],
    worksAt: worksAtLabel(search, tempUnit) ?? "Any",
    coverage:
      search.coverage === undefined ? "All" : coverageWords[search.coverage],
  };
}

const CHIP_TITLES: Readonly<Record<GroupKey, string>> = {
  group: "Group",
  worksAt: "Works at",
  coverage: "Coverage",
};

const CHIP_ORDER: readonly GroupKey[] = ["group", "worksAt", "coverage"];

/**
 * Below 1040 (#109b): one chip per group, always shown, in the rail's
 * order, each reading `GROUP · VALUE`. A tap opens that group's control
 * inline under the row, one open at a time, `aria-expanded`; the open
 * chip is ink, the rest outlined.
 *
 * **Before hydration a chip can open nothing**, so every control is shown
 * open under the row and every one of them works — links and a GET form —
 * until the script that makes the row a row arrives.
 */
function ChipRow(props: Readonly<ClosetFiltersProps>): JSX.Element {
  const controls = useControls(props);
  const isHydrated = useIsHydrated();
  const [open, setOpen] = useState<GroupKey | undefined>();
  const id = useId();
  const values = chipValues(props.search, props.tempUnit);
  const isShown = (key: GroupKey): boolean => !isHydrated || open === key;
  return (
    <nav
      aria-label="Filter the closet"
      data-part="chips"
      className="flex flex-col gap-3"
    >
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {CHIP_ORDER.map((key) => (
          <li key={key}>
            <button
              type="button"
              aria-expanded={isShown(key)}
              aria-controls={`${id}-${key}`}
              onClick={() => {
                setOpen(open === key ? undefined : key);
              }}
              className="target flex items-center rounded-pill border border-hairline px-3 py-1 text-ink aria-expanded:border-ink aria-expanded:bg-ink aria-expanded:text-ground"
            >
              <Mono step="xs">{`${CHIP_TITLES[key]} · ${values[key]}`}</Mono>
            </button>
          </li>
        ))}
      </ul>
      {CHIP_ORDER.map((key) => (
        <div key={key} id={`${id}-${key}`} hidden={!isShown(key)}>
          {controls[key]}
        </div>
      ))}
    </nav>
  );
}

function Rail(props: Readonly<ClosetFiltersProps>): JSX.Element {
  const controls = useControls(props);
  return (
    <nav
      aria-label="Filter the closet"
      data-part="rail"
      className="flex flex-col gap-6"
    >
      {controls.group}
      {controls.worksAt}
      {controls.coverage}
    </nav>
  );
}

export function ClosetFilters(
  props: Readonly<ClosetFiltersProps>,
): JSX.Element {
  return props.variant === "rail" ? (
    <Rail {...props} />
  ) : (
    <ChipRow {...props} />
  );
}
