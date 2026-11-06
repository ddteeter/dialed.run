import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode, RefObject } from "react";
import { useId, useRef, useState } from "react";

import type { TempUnit } from "../../../lib/contracts";
import { tempInUnit, unitToC } from "../../../lib/contracts/temperature";
import { formatTempRange } from "../../../lib/contracts/thermal";
import { Bracketed, Mono } from "../../../ui";
import type { ClosetSearch } from "../inputs";
import { useIsHydrated } from "./use-is-hydrated";

/**
 * Closet C's WORKS AT (R-94, design 174), in the two forms round 46 #109h
 * rules: with no script, two whole-degree fields in the runner's unit
 * ("Lowest", "Highest", visually hidden) and a plain-text Apply in a GET
 * form that names its unit; with script, the bar itself is the control
 * and Apply goes. Both write the search in Celsius. The span is ink
 * (owner, 2026-11-05; round 46 #109c).
 */

interface Range {
  from?: number;
  to?: number;
}

export interface WorksAtProps {
  search: ClosetSearch;
  /**
  The closet's own coldest and warmest ends; none when no piece states one.
  */
  span: { lowC: number; highC: number } | undefined;
  tempUnit: TempUnit;
  /**
  The hydrated controls' navigation: the whole next search.
  */
  onSearch?: ((next: ClosetSearch) => void) | undefined;
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

const UNIT_MARK: Readonly<Record<TempUnit, string>> = { f: "°F", c: "°C" };

function EndField({
  name,
  label,
  valueC,
  boundC,
  tempUnit,
}: Readonly<{
  name: "lowest" | "highest";
  label: string;
  valueC: number | undefined;
  boundC: number;
  tempUnit: TempUnit;
}>): JSX.Element {
  const id = `${useId()}-${name}`;
  return (
    <span>
      <label htmlFor={id} className="sr-only">
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
 * #109h with no script: `34 to 58 Apply`. Empty ends are open ends, and
 * the closet's own bounds are the placeholders. The other filters ride
 * along as hidden fields, and `unit` says what was typed. Only ever drawn
 * when no script is driving the rail, so it is only ever a plain GET.
 */
function WorksAtForm({
  search,
  span,
  tempUnit,
}: Readonly<{
  search: ClosetSearch;
  span: { lowC: number; highC: number };
  tempUnit: TempUnit;
}>): JSX.Element {
  return (
    <form method="get" className="flex items-center gap-2">
      <EndField
        name="lowest"
        label="Lowest"
        valueC={search.from}
        boundC={span.lowC}
        tempUnit={tempUnit}
      />
      <span className="text-small text-quiet">to</span>
      <EndField
        name="highest"
        label="Highest"
        valueC={search.to}
        boundC={span.highC}
        tempUnit={tempUnit}
      />
      <button
        type="submit"
        className="target text-small font-semibold text-ink underline"
      >
        Apply
      </button>
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
 * Two thumbs on one track: native range inputs laid over each other,
 * transparent but for their thumbs, so each keeps its own keyboard and
 * its own name. Only the thumbs take the pointer, or the upper input
 * would swallow every press meant for the lower thumb.
 */
const THUMB_CLASS =
  "pointer-events-none absolute inset-0 m-0 h-full w-full appearance-none bg-transparent [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:bg-ink";

/**
Where a value sits along the track, as a percentage.
*/
export function trackPercent(value: number, low: number, high: number): number {
  return high === low ? 0 : ((value - low) / (high - low)) * 100;
}

/**
 * What the bar asks for, in Celsius: an end at its bound is an open end,
 * so dragging a thumb back to the edge lets go of that side.
 */
export function barRange(
  ends: { low: number; high: number },
  bounds: { low: number; high: number },
  tempUnit: TempUnit,
): Range {
  return {
    ...(ends.low > bounds.low && { from: unitToC(ends.low, tempUnit) }),
    ...(ends.high < bounds.high && { to: unitToC(ends.high, tempUnit) }),
  };
}

/**
 * One of the bar's two thumbs: a whole degree at a time across the
 * closet's span, and the search asked for when it is let go.
 */
function Thumb({
  label,
  value,
  bounds,
  onValue,
  onCommit,
}: Readonly<{
  label: "Lowest" | "Highest";
  value: number;
  bounds: { low: number; high: number };
  onValue: (value: number) => void;
  onCommit: () => void;
}>): JSX.Element {
  return (
    <input
      type="range"
      aria-label={label}
      min={bounds.low}
      max={bounds.high}
      step={1}
      value={value}
      onChange={(event) => {
        onValue(Number(event.target.value));
      }}
      onPointerUp={onCommit}
      onKeyUp={onCommit}
      className={THUMB_CLASS}
    />
  );
}

/**
 * #109h with script: the bar is the control. The readout above it is the
 * span as set (`18–72°F`, as #109b draws it); it moves with the thumbs,
 * and the search changes when a thumb is let go — one history entry for
 * one drag, replaced rather than pushed, since a span is one setting.
 */
function SpanBar({
  search,
  span,
  tempUnit,
  onSearch,
}: Readonly<{
  search: ClosetSearch;
  span: { lowC: number; highC: number };
  tempUnit: TempUnit;
  onSearch: (next: ClosetSearch) => void;
}>): JSX.Element {
  const bounds = {
    low: tempInUnit(span.lowC, tempUnit),
    high: tempInUnit(span.highC, tempUnit),
  };
  const [ends, setEnds] = useState({
    low:
      search.from === undefined
        ? bounds.low
        : tempInUnit(search.from, tempUnit),
    high:
      search.to === undefined ? bounds.high : tempInUnit(search.to, tempUnit),
  });
  const commit = (): void => {
    onSearch({
      ...search,
      from: undefined,
      to: undefined,
      ...barRange(ends, bounds, tempUnit),
    });
  };
  const left = trackPercent(ends.low, bounds.low, bounds.high);
  const right = 100 - trackPercent(ends.high, bounds.low, bounds.high);
  return (
    <div className="flex flex-col gap-2">
      <Mono step="sm" className="text-ink">
        {`${String(ends.low)}–${String(ends.high)}${UNIT_MARK[tempUnit]}`}
      </Mono>
      {/* 44 high, so each thumb's input is a full target (rule 03). */}
      <div data-part="span-bar" className="relative h-11">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-hairline">
          <div
            data-part="span"
            className="absolute inset-y-0 rounded-pill bg-ink"
            style={{ left: `${String(left)}%`, right: `${String(right)}%` }}
          />
        </div>
        <Thumb
          label="Lowest"
          value={ends.low}
          bounds={bounds}
          onValue={(value) => {
            setEnds({ ...ends, low: Math.min(value, ends.high) });
          }}
          onCommit={commit}
        />
        <Thumb
          label="Highest"
          value={ends.high}
          bounds={bounds}
          onValue={(value) => {
            setEnds({ ...ends, high: Math.max(value, ends.low) });
          }}
          onCommit={commit}
        />
      </div>
    </div>
  );
}

/**
 * WORKS AT's label line, and its way out while a span is set (round 46
 * #109f): `Any`, right-aligned and 44 high. With script it is a button
 * that lets go of both ends — the bar back to the closet's full span —
 * and puts focus on the label; with none it is a link to the closet
 * without the span.
 */
function AnyControl({
  search,
  isLive,
  onSearch,
  labelRef,
}: Readonly<{
  search: ClosetSearch;
  isLive: boolean;
  onSearch: ((next: ClosetSearch) => void) | undefined;
  labelRef: RefObject<HTMLHeadingElement | null>;
}>): JSX.Element | undefined {
  if (search.from === undefined && search.to === undefined) return;
  const cleared = { ...search, from: undefined, to: undefined };
  if (!isLive || onSearch === undefined) {
    return (
      <Link
        to="/closet"
        search={cleared}
        activeOptions={{ exact: true }}
        className="target inline-flex items-center justify-center text-small text-ink"
      >
        Any
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="target text-small text-ink"
      onClick={() => {
        onSearch(cleared);
        labelRef.current?.focus();
      }}
    >
      Any
    </button>
  );
}

function WorksAtHeading({
  label,
  labelRef,
  children,
}: Readonly<{
  label: string;
  labelRef: RefObject<HTMLHeadingElement | null>;
  children: ReactNode;
}>) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 ref={labelRef} tabIndex={-1} className="m-0">
        <Mono step="xs" className="text-label">
          {label}
        </Mono>
      </h2>
      {children}
    </div>
  );
}

export function WorksAt({
  search,
  span,
  tempUnit,
  onSearch,
}: Readonly<WorksAtProps>): JSX.Element {
  const isHydrated = useIsHydrated();
  const labelRef = useRef<HTMLHeadingElement>(null);
  const isLive = isHydrated && onSearch !== undefined && span !== undefined;
  let control: JSX.Element;
  if (span === undefined) {
    control = (
      <p className="m-0 text-small text-muted">
        <Bracketed>Untested</Bracketed>
      </p>
    );
  } else if (isLive) {
    control = (
      <SpanBar
        // A changed search starts the thumbs from it.
        key={`${String(search.from)}-${String(search.to)}`}
        search={search}
        span={span}
        tempUnit={tempUnit}
        onSearch={onSearch}
      />
    );
  } else {
    control = <WorksAtForm search={search} span={span} tempUnit={tempUnit} />;
  }
  return (
    <section className="flex flex-col gap-2">
      <WorksAtHeading
        // #109h: the no-script fields' label names the unit they take
        // (`WORKS AT · °F`); the bar's readout says it, and with no span
        // there are no numbers for a unit to belong to.
        label={
          span === undefined || isLive
            ? "Works at"
            : `Works at · ${UNIT_MARK[tempUnit]}`
        }
        labelRef={labelRef}
      >
        <AnyControl
          search={search}
          isLive={isLive}
          onSearch={onSearch}
          labelRef={labelRef}
        />
      </WorksAtHeading>
      {control}
    </section>
  );
}
