import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode, RefObject } from "react";
import { useEffect, useId, useRef, useState } from "react";

import type { TempUnit } from "../../../lib/contracts";
import { tempInUnit, unitToC } from "../../../lib/contracts/temperature";
import {
  openSpanInUnit,
  spanInUnit,
  worksAtForms,
} from "../../../lib/contracts/measures";
import { Bracketed, Mono, Spoken } from "../../../ui";
import type { ClosetSearch } from "../inputs";
import { useIsHydrated } from "../../../ui/use-is-hydrated";

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
 * The asked span as the runner reads it, `34–58°`, `34°+` or `under 58°`,
 * and as it is said, "34 to 58 degrees" (round 53 · 162.3).
 */
export function worksAtLabel(
  search: ClosetSearch,
  tempUnit: TempUnit,
): { shown: string; said: string } | undefined {
  return worksAtForms({ lowC: search.from, highC: search.to }, tempUnit);
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
  shift,
  onValue,
  onCommit,
}: Readonly<{
  label: "Lowest" | "Highest";
  value: number;
  bounds: { low: number; high: number };
  /**
  Where the thumb is drawn from its value, so two never overlap.
  */
  shift: string;
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
      style={{ transform: shift }}
    />
  );
}

/**
 * Round 55 · 192: thumbs always sit at least 24 apart, centre to centre.
 * A narrower range draws its span at 24, centred on the true values, and
 * each thumb steps half the shortfall outward. A translate's percentage
 * is of the input's own width, which is the track's, so the shortfall is
 * one CSS length and needs no measuring.
 */
export function thumbSpread(spanPercent: number): string {
  return `max(0px, 24px - ${String(spanPercent)}%) / 2`;
}

/**
 * How far each thumb steps out, as CSS lengths: half the shortfall each,
 * but never past its end of the track. A thumb at a bound has no room
 * outward, so its half goes to the other side, and the two still sit 24
 * apart (C-14: at a bound, a thumb sat about 12px past the track's end).
 * `left` and `right` are the span's distances from each end, in percent.
 */
export function thumbShifts(
  left: number,
  right: number,
): { lower: string; upper: string } {
  const half = thumbSpread(100 - left - right);
  const lowRoom = `${String(left)}%`;
  const highRoom = `${String(right)}%`;
  return {
    lower: `min(${lowRoom}, ${half} + max(0px, ${half} - ${highRoom}))`,
    upper: `min(${highRoom}, ${half} + max(0px, ${half} - ${lowRoom}))`,
  };
}

/**
 * Which ends of the span are asked, in the runner's unit: an end not
 * asked is open.
 */
interface AskedEnds {
  low: number | undefined;
  high: number | undefined;
}

/**
 * The value WORKS AT's header shows (Round 55 · 192): `Any` while neither
 * end is asked, the span's exact whole degrees with the unit's letter,
 * `39–46°F`, when both are, and with one end open the FILTERED line's own
 * words, `61°F+` or `under 58°F` (C-14), never the closet's bound as if
 * the runner had set it.
 */
export function worksAtValueForms(
  asked: AskedEnds,
  tempUnit: TempUnit,
): { shown: string; said: string } | undefined {
  const { low, high } = asked;
  if (low !== undefined && high !== undefined)
    return spanInUnit(low, high, tempUnit);
  if (low !== undefined) return openSpanInUnit({ low }, tempUnit);
  if (high !== undefined) return openSpanInUnit({ high }, tempUnit);
  return undefined;
}

function WorksAtValue({
  asked,
  tempUnit,
}: Readonly<{ asked: AskedEnds; tempUnit: TempUnit }>): JSX.Element {
  const forms = worksAtValueForms(asked, tempUnit);
  return (
    <span data-part="works-at-value" className="text-ink">
      <Mono step="sm">
        {forms === undefined ? "Any" : <Spoken {...forms} />}
      </Mono>
    </span>
  );
}

/**
 * The room the header's value and Clear can ever take for this closet,
 * held by unseen copies in the same cell: the closet's whole span, and
 * each end left open (R2-CLOSET-01). The rail's track is as wide as its
 * widest row, so a value arriving would otherwise widen the rail and move
 * the grid, which is C-11's complaint; with the room held, setting a span
 * moves nothing. Hidden from the reader, who hears the value once.
 */
function ValueRoom({
  bounds,
  tempUnit,
}: Readonly<{
  bounds: { low: number; high: number };
  tempUnit: TempUnit;
}>): JSX.Element {
  const widest = [
    spanInUnit(bounds.low, bounds.high, tempUnit),
    openSpanInUnit({ low: bounds.low }, tempUnit),
    openSpanInUnit({ high: bounds.high }, tempUnit),
  ];
  return (
    <>
      {widest.map(({ shown }) => (
        <span
          key={shown}
          data-part="value-room"
          aria-hidden="true"
          className={VALUE_ROOM_CLASS}
        >
          <Mono step="sm">{shown}</Mono>
          <span className={CLEAR_CLASS}>Clear</span>
        </span>
      ))}
    </>
  );
}

/**
 * The header's right side: what is shown, and the unseen room, stacked in
 * one grid cell and set to its right edge.
 */
const VALUE_CELL_CLASS =
  "col-start-1 row-start-1 flex items-center justify-end gap-3";
const VALUE_ROOM_CLASS =
  "invisible col-start-1 row-start-1 flex items-center justify-end gap-3";

/**
The closet's span in the runner's unit, the bar's two bounds.
*/
function boundsOf(
  span: { lowC: number; highC: number },
  tempUnit: TempUnit,
): { low: number; high: number } {
  return {
    low: tempInUnit(span.lowC, tempUnit),
    high: tempInUnit(span.highC, tempUnit),
  };
}

/**
The asked ends in the runner's unit, an open end at the closet's bound.
*/
function endsOf(
  search: ClosetSearch,
  bounds: { low: number; high: number },
  tempUnit: TempUnit,
): { low: number; high: number } {
  return {
    low:
      search.from === undefined
        ? bounds.low
        : tempInUnit(search.from, tempUnit),
    high:
      search.to === undefined ? bounds.high : tempInUnit(search.to, tempUnit),
  };
}

/**
The ends the search asks for, in the runner's unit; an unasked end is open.
*/
function askedOf(search: ClosetSearch, tempUnit: TempUnit): AskedEnds {
  return {
    low:
      search.from === undefined ? undefined : tempInUnit(search.from, tempUnit),
    high: search.to === undefined ? undefined : tempInUnit(search.to, tempUnit),
  };
}

/**
 * #109h with script: the bar is the control. Its value sits in the header
 * row (Round 55 · 192) and moves with the thumbs, and the search changes
 * when a thumb is let go — one history entry for one drag, replaced
 * rather than pushed, since a span is one setting.
 */
function SpanBar({
  search,
  span,
  tempUnit,
  onSearch,
  onCleared,
  labelRef,
}: Readonly<{
  search: ClosetSearch;
  span: { lowC: number; highC: number };
  tempUnit: TempUnit;
  onSearch: (next: ClosetSearch) => void;
  /**
  Clear was pressed: the label takes focus once the new search draws.
  */
  onCleared: () => void;
  labelRef: RefObject<HTMLHeadingElement | null>;
}>): JSX.Element {
  const bounds = boundsOf(span, tempUnit);
  const [ends, setEnds] = useState(endsOf(search, bounds, tempUnit));
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
  const shift = thumbShifts(left, right);
  return (
    <>
      <WorksAtHeading
        label="Works at"
        labelRef={labelRef}
        room={<ValueRoom bounds={bounds} tempUnit={tempUnit} />}
      >
        <WorksAtValue
          asked={{
            low: ends.low > bounds.low ? ends.low : undefined,
            high: ends.high < bounds.high ? ends.high : undefined,
          }}
          tempUnit={tempUnit}
        />
        <ClearControl
          search={search}
          onClear={(cleared) => {
            onSearch(cleared);
            onCleared();
          }}
        />
      </WorksAtHeading>
      {/* 44 high, so each thumb's input is a full target (rule 03). */}
      <div data-part="span-bar" className="relative h-11">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-pill bg-hairline">
          <div
            data-part="span"
            className="absolute inset-y-0 rounded-pill bg-ink"
            style={{
              left: `calc(${String(left)}% - ${shift.lower})`,
              right: `calc(${String(right)}% - ${shift.upper})`,
            }}
          />
        </div>
        <Thumb
          label="Lowest"
          value={ends.low}
          bounds={bounds}
          shift={`translateX(calc(${shift.lower} * -1))`}
          onValue={(value) => {
            setEnds({ ...ends, low: Math.min(value, ends.high) });
          }}
          onCommit={commit}
        />
        <Thumb
          label="Highest"
          value={ends.high}
          bounds={bounds}
          shift={`translateX(calc(${shift.upper}))`}
          onValue={(value) => {
            setEnds({ ...ends, high: Math.max(value, ends.low) });
          }}
          onCommit={commit}
        />
      </div>
    </>
  );
}

/**
 * WORKS AT's way out while a span is set (round 46 #109f), named Clear and
 * in the header row beside the value (Round 55 · 192), so setting a span
 * adds no row and COVERAGE never moves. With script it is a button that
 * lets go of both ends — the bar back to the closet's full span — and puts
 * focus on the label; with none it is a link to the closet without the
 * span.
 */
function ClearControl({
  search,
  onClear,
}: Readonly<{
  search: ClosetSearch;
  /**
  Absent until script runs: then a link is all that works.
  */
  onClear?: (cleared: ClosetSearch) => void;
}>): JSX.Element | undefined {
  if (search.from === undefined && search.to === undefined) return;
  const cleared = { ...search, from: undefined, to: undefined };
  if (onClear === undefined) {
    return (
      <Link
        to="/closet"
        search={cleared}
        activeOptions={{ exact: true }}
        className={CLEAR_CLASS}
      >
        Clear
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={CLEAR_CLASS}
      onClick={() => {
        onClear(cleared);
      }}
    >
      Clear
    </button>
  );
}

/**
 * Clear, as board 192 draws it: underlined, so it reads as a control, and
 * a full target whose row is already 44 high.
 */
const CLEAR_CLASS =
  "target inline-flex items-center text-small font-bold text-ink underline";

/**
 * WORKS AT's header row: the label at the left, the value and Clear at
 * the right. Always a target's height, so Clear arriving changes nothing
 * around it (C-14: the row grew 10px).
 */
function WorksAtHeading({
  label,
  labelRef,
  room,
  children,
}: Readonly<{
  label: string;
  labelRef: RefObject<HTMLHeadingElement | null>;
  /**
  The value's unseen room, once the closet has a span to show.
  */
  room?: ReactNode;
  children?: ReactNode;
}>) {
  return (
    <div
      data-part="works-at-header"
      className="flex min-h-11 items-center justify-between gap-2"
    >
      <h2 ref={labelRef} tabIndex={-1} className="m-0">
        <Mono step="xs" className="text-label">
          {label}
        </Mono>
      </h2>
      <span data-part="works-at-room" className="grid">
        <span className={VALUE_CELL_CLASS}>{children}</span>
        {room}
      </span>
    </div>
  );
}

/**
 * Clear puts focus on the label (round 46 #109f), but the label it was
 * pressed beside is gone by then: a changed search draws the span bar
 * anew (its `key`), heading and all. So Clear asks, and the label is
 * focused once the cleared search has drawn the new one.
 */
function useFocusOnceDrawn(
  labelRef: RefObject<HTMLHeadingElement | null>,
  search: ClosetSearch,
): () => void {
  // Unset until Clear asks: an effect on mount has nothing to do.
  const focusAsk = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (focusAsk.current !== true) return;
    focusAsk.current = false;
    // Equivalent without `?.`: the effect runs after the commit that drew
    // the label, so the ref is set. The `?.` is the type's.
    // Stryker disable next-line OptionalChaining
    labelRef.current?.focus();
  }, [labelRef, search.from, search.to]);
  return () => {
    focusAsk.current = true;
  };
}

export function WorksAt({
  search,
  span,
  tempUnit,
  onSearch,
}: Readonly<WorksAtProps>): JSX.Element {
  const isHydrated = useIsHydrated();
  const labelRef = useRef<HTMLHeadingElement>(null);
  const focusLabelOnceDrawn = useFocusOnceDrawn(labelRef, search);
  // The bar's commit and Any's, once script runs to make them.
  const liveSearch = isHydrated ? onSearch : undefined;
  if (span !== undefined && liveSearch !== undefined) {
    return (
      <section className="flex flex-col gap-2">
        <SpanBar
          // A changed search starts the thumbs from it.
          key={`${String(search.from)}-${String(search.to)}`}
          search={search}
          span={span}
          tempUnit={tempUnit}
          onSearch={liveSearch}
          onCleared={focusLabelOnceDrawn}
          labelRef={labelRef}
        />
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <WorksAtHeading
        // #109h: the no-script fields' label names the unit they take
        // (`WORKS AT · °F`); with no span there are no numbers for a unit
        // to belong to, and no value to show.
        label={
          span === undefined ? "Works at" : `Works at · ${UNIT_MARK[tempUnit]}`
        }
        labelRef={labelRef}
        room={
          span === undefined ? undefined : (
            <ValueRoom bounds={boundsOf(span, tempUnit)} tempUnit={tempUnit} />
          )
        }
      >
        {span === undefined ? undefined : (
          <>
            <WorksAtValue
              asked={askedOf(search, tempUnit)}
              tempUnit={tempUnit}
            />
            <ClearControl search={search} />
          </>
        )}
      </WorksAtHeading>
      {span === undefined ? (
        <p className="m-0 text-small text-muted">
          <Bracketed>Untested</Bracketed>
        </p>
      ) : (
        <WorksAtForm search={search} span={span} tempUnit={tempUnit} />
      )}
    </section>
  );
}
