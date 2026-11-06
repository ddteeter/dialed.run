import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";
import { useId } from "react";

import {
  uiGroupLabels,
  uiGroups,
  verdictCoverages,
  type TempUnit,
  type UiGroup,
  type VerdictCoverage,
} from "../../../lib/contracts";
import { tempInUnit, unitToC } from "../../../lib/contracts/temperature";
import { formatTempRange } from "../../../lib/contracts/thermal";
import { Bracketed, CoverageMark, Mono } from "../../../ui";
import type { RailCounts } from "../filters";
import type { ClosetSearch } from "../inputs";

/**
 * Closet C's three filter groups (R-94, design 174): GROUP with counts,
 * WORKS AT, COVERAGE. One component, drawn as the desk's rail or as the
 * phone's chip row (board C: *"below 1040 the three groups become the
 * phone's filter chips"*).
 *
 * **Every filter works before hydration.** GROUP and COVERAGE are links to
 * the closet with the search changed; WORKS AT is a GET form that names
 * the unit it was typed in, which `closetSearch` converts. Hydrated, the
 * form navigates instead of reloading.
 *
 * **Monochrome** (§AB, and round 16: *"nothing in the rail carries a
 * hue"*): the coverage swatches are ink density and the selected span is
 * ink, not the board's pink (owner, 2026-11-05).
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
  The hydrated form's navigation, in Celsius; either end may be open.
  Without one the form submits as a plain GET, as it does before hydration.
  */
  onWorksAt?: ((range: { from?: number; to?: number }) => void) | undefined;
}

/**
 * The look of one choice. A rail row is text, bold when chosen (board C);
 * a chip is a pill, ink when chosen, as every chosen chip in the app is.
 */
const CHOICE_CLASS: Readonly<Record<FiltersVariant, string>> = {
  rail: "target flex items-center gap-2 text-body text-ink no-underline aria-[current=true]:font-bold",
  chips:
    "target flex items-center gap-2 rounded-pill border border-hairline px-3 py-1 text-small text-ink no-underline aria-[current=true]:border-ink aria-[current=true]:bg-ink aria-[current=true]:text-ground",
};

const GROUP_CLASS: Readonly<Record<FiltersVariant, string>> = {
  rail: "m-0 flex list-none flex-col gap-2 p-0",
  chips: "m-0 flex list-none flex-wrap gap-2 p-0",
};

/**
One choice in a group: what it reads, its count, and where it leads.
*/
interface FilterOption {
  key: string;
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

/**
 * A group of choices, each a link to the closet with the search changed,
 * so it works before hydration; the chosen one is `aria-current`. GROUP
 * and COVERAGE differ only in their options, so they share this.
 */
function FilterGroup({
  title,
  variant,
  options,
}: Readonly<{
  title: string;
  variant: FiltersVariant;
  options: readonly FilterOption[];
}>): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <GroupHeading>{title}</GroupHeading>
      <ul className={GROUP_CLASS[variant]}>
        {options.map((option) => (
          <li key={option.key}>
            <Link
              to="/closet"
              search={option.search}
              aria-current={option.isCurrent ? "true" : undefined}
              className={CHOICE_CLASS[variant]}
            >
              {option.label}{" "}
              <Mono step="xs" className="text-label">
                {option.count}
              </Mono>
            </Link>
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
      key: "all",
      label: "All",
      count: counts.all,
      isCurrent: search.group === undefined,
      search: unset,
    },
    ...uiGroups.map((group: UiGroup) => ({
      key: group,
      label: uiGroupLabels[group],
      count: counts.groups.get(group) ?? 0,
      isCurrent: search.group === group,
      search: { ...unset, group },
    })),
  ];
}

/**
 * COVERAGE: covered, partial, untested, each with an ink swatch and a
 * count. Tapping the chosen level again clears it (owner, 2026-11-05):
 * there is no drawn "All" here, and none is added.
 */
function coverageOptions(
  search: ClosetSearch,
  counts: RailCounts,
): FilterOption[] {
  const unset = { ...search, coverage: undefined };
  return verdictCoverages.map((level) => ({
    key: level,
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

/**
The asked span as the runner reads it: `34–58°`, `34°+`, `under 58°`.
*/
export function worksAtLabel(
  search: ClosetSearch,
  tempUnit: TempUnit,
): string | undefined {
  return formatTempRange(
    {
      ...(search.from !== undefined && { lowC: search.from }),
      ...(search.to !== undefined && { highC: search.to }),
    },
    tempUnit,
  );
}

function numberOf(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * What the hydrated form asks for, in Celsius: each end the runner filled
 * in, converted from their unit; an empty end stays open.
 */
export function endsInC(
  form: FormData,
  tempUnit: TempUnit,
): { from?: number; to?: number } {
  const from = numberOf(form.get("from"));
  const to = numberOf(form.get("to"));
  return {
    ...(from !== undefined && { from: unitToC(from, tempUnit) }),
    ...(to !== undefined && { to: unitToC(to, tempUnit) }),
  };
}

/**
 * The span bar: the closet's span as the track, the asked span in ink.
 * Decorative — the two fields beside it are the control and say the
 * numbers — so it is hidden from assistive tech.
 */
function SpanBar({
  span,
  search,
}: Readonly<{
  span: { lowC: number; highC: number };
  search: ClosetSearch;
}>): JSX.Element {
  const width = span.highC - span.lowC;
  const at = (tempC: number): number =>
    width === 0 ? 0 : ((tempC - span.lowC) / width) * 100;
  const left = Math.max(0, Math.min(100, at(search.from ?? span.lowC)));
  const right = Math.max(0, Math.min(100, 100 - at(search.to ?? span.highC)));
  return (
    <div
      aria-hidden="true"
      data-part="span-bar"
      className="relative h-1.5 rounded-pill bg-hairline"
    >
      <div
        data-part="span"
        className="absolute inset-y-0 rounded-pill bg-ink"
        style={{ left: `${String(left)}%`, right: `${String(right)}%` }}
      />
    </div>
  );
}

function EndField({
  name,
  label,
  valueC,
  boundC,
  tempUnit,
}: Readonly<{
  name: "from" | "to";
  label: string;
  valueC: number | undefined;
  boundC: number;
  tempUnit: TempUnit;
}>): JSX.Element {
  const id = `${useId()}-${name}`;
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-quiet">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        step={1}
        placeholder={String(tempInUnit(boundC, tempUnit))}
        defaultValue={
          valueC === undefined ? undefined : tempInUnit(valueC, tempUnit)
        }
        className="target w-16 rounded-field border border-hairline bg-panel px-2 py-1 font-mono text-mono-sm"
      />
    </span>
  );
}

/**
 * WORKS AT: a GET form, so it works before hydration (the rest of the
 * rail is links). Empty ends are open ends, and the closet's own bounds
 * are the placeholders. The other filters ride along as hidden fields so
 * a submit keeps them, and `unit` says what was typed.
 */
function WorksAtForm({
  search,
  span,
  tempUnit,
  onWorksAt,
}: Readonly<
  Pick<ClosetFiltersProps, "search" | "tempUnit" | "onWorksAt"> & {
    span: { lowC: number; highC: number };
  }
>): JSX.Element {
  return (
    <form
      method="get"
      onSubmit={(event) => {
        if (onWorksAt === undefined) return;
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onWorksAt(endsInC(form, tempUnit));
      }}
      className="flex flex-col gap-2"
      // A changed search re-mounts the fields with its values.
      key={`${String(search.from)}-${String(search.to)}`}
    >
      <SpanBar span={span} search={search} />
      <div className="flex items-end gap-2">
        <EndField
          name="from"
          label="From"
          valueC={search.from}
          boundC={span.lowC}
          tempUnit={tempUnit}
        />
        <EndField
          name="to"
          label="To"
          valueC={search.to}
          boundC={span.highC}
          tempUnit={tempUnit}
        />
        <button
          type="submit"
          className="target rounded-pill border border-hairline px-3 py-1 text-small font-semibold"
        >
          Apply
        </button>
      </div>
      <input type="hidden" name="unit" value={tempUnit} />
      {search.group === undefined ? undefined : (
        <input type="hidden" name="group" value={search.group} />
      )}
      {search.coverage === undefined ? undefined : (
        <input type="hidden" name="coverage" value={search.coverage} />
      )}
      {search.retired === true ? (
        <input type="hidden" name="retired" value="true" />
      ) : undefined}
    </form>
  );
}

/**
 * WORKS AT's heading, and its way out: an `Any` link while a span is set
 * (owner, 2026-11-05), which drops both ends and keeps the rest.
 */
function WorksAtHeading({ search }: Readonly<{ search: ClosetSearch }>) {
  const isSet = search.from !== undefined || search.to !== undefined;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <GroupHeading>Works at</GroupHeading>
      {isSet ? (
        <Link
          to="/closet"
          search={{ ...search, from: undefined, to: undefined }}
          className="target text-small text-ink"
        >
          Any
        </Link>
      ) : undefined}
    </div>
  );
}

function WorksAtFilter(
  props: Readonly<Omit<ClosetFiltersProps, "counts">>,
): JSX.Element {
  const { variant, search, span, tempUnit } = props;
  const body =
    span === undefined ? (
      <p className="m-0 text-small text-muted">
        <Bracketed>Untested</Bracketed>
      </p>
    ) : (
      <WorksAtForm {...props} span={span} />
    );
  if (variant === "rail") {
    return (
      <section className="flex flex-col gap-2">
        <WorksAtHeading search={search} />
        {body}
      </section>
    );
  }
  const label = worksAtLabel(search, tempUnit);
  // The phone's one WORKS AT chip, which opens the same form inline
  // (owner, 2026-11-05).
  return (
    <details className="flex flex-col gap-2">
      <summary className="target flex w-fit cursor-pointer items-center gap-2 rounded-pill border border-hairline px-3 py-1 text-small">
        <Mono step="xs">Works at</Mono>
        {label === undefined ? undefined : (
          <Bracketed step="xs">{label}</Bracketed>
        )}
      </summary>
      <div className="flex flex-col gap-2 pt-2">
        <WorksAtHeading search={search} />
        {body}
      </div>
    </details>
  );
}

export function ClosetFilters(
  props: Readonly<ClosetFiltersProps>,
): JSX.Element {
  const { variant, search, counts } = props;
  return (
    <nav
      aria-label="Filter the closet"
      data-part={variant === "rail" ? "rail" : "chips"}
      className={
        variant === "rail" ? "flex flex-col gap-6" : "flex flex-col gap-3"
      }
    >
      <FilterGroup
        title="Group"
        variant={variant}
        options={groupOptions(search, counts)}
      />
      <WorksAtFilter {...props} />
      <FilterGroup
        title="Coverage"
        variant={variant}
        options={coverageOptions(search, counts)}
      />
    </nav>
  );
}
