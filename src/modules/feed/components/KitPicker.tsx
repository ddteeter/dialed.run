import type { JSX } from "react";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { formatTemp, precipClassOf } from "../../../lib/temperature";
import { Bracketed, FieldMessage, Mono, Sheet } from "../../../ui";
import type { Conditions } from "../conditions-shape";
import { uiGroupLabels } from "../groups";
import type { UiGroup } from "../groups";
import type { PickerGroup } from "../picker";

/**
 * The groups A2 draws as a row of tiles; the rest are "+ CATEGORY" chips.
 *
 * Product Screens A2 draws TOP and BOTTOM as rows and HANDS, HEAD, SHOES
 * and EXTRAS as chips — the pieces a kit is built around, and the pieces
 * added to it. Outer layers are part of the first answer, so they get a
 * row of their own where the closet has any.
 */
const ROW_GROUPS: ReadonlySet<UiGroup> = new Set(["tops", "outer", "bottoms"]);

type PickerItem = PickerGroup["items"][number];

/**
 * What a group shows, given the filter: a function the component builds
 * once from its own state, rather than a flag passed to a helper — the
 * choice is the component's, and the helper would only be asked it.
 */
type Shown = (group: PickerGroup) => readonly PickerItem[];

function matchingOnly(group: PickerGroup): readonly PickerItem[] {
  return group.items.filter((item) => item.matches);
}

function everything(group: PickerGroup): readonly PickerItem[] {
  return group.items;
}

/**
 * "Tops · 4 of 14 match" with the filter on; "Tops · 14" with it off or
 * with nothing to match against — the count is the sentence, and it says
 * how much the filter is hiding.
 */
function matchLine(group: PickerGroup): string {
  return `${uiGroupLabels[group.group]} · ${String(group.matchCount)} of ${String(group.items.length)} match`;
}

function totalLine(group: PickerGroup): string {
  return `${uiGroupLabels[group.group]} · ${String(group.items.length)}`;
}

/**
The conditions as the filter chip names them — "41° damp".
*/
export function conditionsWords(conditions: Conditions, units: Units): string {
  return `${formatTemp(conditions.tempC, units.temp)} ${precipClassOf(conditions.precipMm)}`;
}

/**
 * One piece, as a tile: pressed when it is in the kit.
 *
 * The board draws a photo swatch; the picker's rows carry no photo yet, so
 * the tile carries the garment's name, which is what a runner reads to
 * choose it anyway.
 */
function PieceTile({
  name,
  pressed,
  onToggle,
}: Readonly<{
  name: string;
  pressed: boolean;
  onToggle: () => void;
}>): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={
        pressed
          ? "target flex size-16 shrink-0 items-end overflow-hidden rounded-field border-2 border-ink bg-ink p-1 text-left text-micro text-ground"
          : "target flex size-16 shrink-0 items-end overflow-hidden rounded-field border border-hairline bg-panel p-1 text-left text-micro text-ink"
      }
    >
      {name}
    </button>
  );
}

/**
 * A2's closet picker: live from the first frame (round 22, "A2 Waiting":
 * *"Picker is live and unfiltered while waiting"*), a row of tiles for the
 * pieces a kit is built around, and a chip for each of the rest. Every
 * "ALL ›" and "+ CATEGORY" opens A2b for that group — *"never a route,
 * never in place"* (round 20).
 */
// fallow-ignore-next-line code-duplication -- a ten-prop signature that matches closet/components/GarmentForm.tsx only by destructuring one prop per line; one picks a kit, the other edits a garment, and they share nothing to extract
export function KitList({
  groups,
  conditions,
  units,
  isFiltered,
  onFilter,
  isOr,
  selected,
  onToggle,
  onOpen,
  error,
}: Readonly<{
  groups: readonly PickerGroup[];
  conditions: Conditions | undefined;
  units: Units;
  isFiltered: boolean;
  onFilter: (isOn: boolean) => void;
  /**
   * "Or pick from the closet" beside a suggestion; "From the closet" when
   * there is none — *"'OR PICK' loses its OR"* (round 22, A2 No
   * suggestion).
   */
  isOr: boolean;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  onOpen: (group: UiGroup) => void;
  error: string | undefined;
}>): JSX.Element {
  const rows = groups.filter((group) => ROW_GROUPS.has(group.group));
  const chips = groups.filter((group) => !ROW_GROUPS.has(group.group));
  const shown: Shown = isFiltered ? matchingOnly : everything;
  const countLine = isFiltered ? matchLine : totalLine;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const showing = groups.reduce((sum, group) => sum + shown(group).length, 0);

  return (
    <section
      data-slot="closet-picker"
      aria-labelledby="closet-picker-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="closet-picker-heading" className="m-0 text-muted">
          <Mono step="xs">
            {isOr ? "Or pick from the closet" : "From the closet"}
          </Mono>
        </h2>
        {conditions === undefined ? undefined : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={isFiltered}
              onClick={() => {
                onFilter(!isFiltered);
              }}
              className="target flex items-center rounded-pill border border-hairline px-3 text-quiet"
            >
              <Mono step="xs">{conditionsWords(conditions, units)}</Mono>
            </button>
            <Mono step="xs" className="text-muted">
              Showing {showing} of {total}
            </Mono>
          </div>
        )}
      </div>
      <div data-slot="kit-list" className="flex flex-col gap-3">
        {rows.map((group) => (
          <div key={group.group} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Mono step="xs" className="text-muted">
                {countLine(group)}
              </Mono>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`All ${uiGroupLabels[group.group]}`}
                onClick={() => {
                  onOpen(group.group);
                }}
                className="target flex items-center font-semibold text-cold-text"
              >
                <Mono step="xs">All &rsaquo;</Mono>
              </button>
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {shown(group).map((item) => (
                <PieceTile
                  key={item.id}
                  name={item.name}
                  pressed={selected.has(item.id)}
                  onToggle={() => {
                    onToggle(item.id);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
        {chips.length === 0 ? undefined : (
          <div className="flex flex-wrap gap-2">
            {chips.map((group) => (
              <button
                key={group.group}
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  onOpen(group.group);
                }}
                className="target flex items-center gap-1 rounded-pill border border-hairline px-3 text-quiet"
              >
                <Mono step="xs">
                  + {uiGroupLabels[group.group]} {shown(group).length}
                </Mono>
              </button>
            ))}
          </div>
        )}
      </div>
      <FieldMessage name="kit" error={error} />
    </section>
  );
}

/**
 * A2b — one category, as a sheet (round 20): *"Filters, search, and
 * multi-select live here — never in the main flow. A 200-piece closet uses
 * the same screen."*
 *
 * It edits the same kit the main screen does, as A3b edits A3's answer:
 * a piece ticked here is a pressed tile there when the sheet closes.
 *
 * **The filter starts on, unless it would hide everything** — *"a
 * category with zero matches opens with the filter off"* — and never
 * without conditions to filter by.
 */
export function KitSheet({
  group,
  conditions,
  units,
  selected,
  onToggle,
  onClose,
}: Readonly<{
  group: PickerGroup | undefined;
  conditions: Conditions | undefined;
  units: Units;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  onClose: () => void;
}>): JSX.Element {
  return (
    <Sheet
      open={group !== undefined}
      onClose={onClose}
      label={group === undefined ? "Pick" : uiGroupLabels[group.group]}
    >
      {group === undefined ? undefined : (
        // Keyed by the group, so opening a second category starts its own
        // search and its own filter rather than inheriting the last one's.
        <SheetBody
          key={group.group}
          group={group}
          conditions={conditions}
          units={units}
          selected={selected}
          onToggle={onToggle}
          onClose={onClose}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  group,
  conditions,
  units,
  selected,
  onToggle,
  onClose,
}: Readonly<{
  group: PickerGroup;
  conditions: Conditions | undefined;
  units: Units;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  onClose: () => void;
}>): JSX.Element {
  const [query, setQuery] = useState("");
  const [isFiltered, setIsFiltered] = useState(
    conditions !== undefined && group.matchCount > 0,
  );
  const label = uiGroupLabels[group.group];
  const needle = query.toLowerCase();
  const shownHere: Shown = isFiltered ? matchingOnly : everything;
  // Brand and name as the row reads them. `join` writes a null brand as
  // nothing, so a piece with none is found by its name alone.
  const found = shownHere(group).filter((item) =>
    [item.brand, item.name].join(" ").toLowerCase().includes(needle),
  );
  const chosen = group.items.filter((item) => selected.has(item.id)).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display text-heading">{label}</h2>
        <Mono step="xs" className="text-muted">
          {conditions === undefined
            ? `${String(group.items.length)} pieces`
            : `${String(group.matchCount)} of ${String(group.items.length)} match ${conditionsWords(conditions, units)}`}
        </Mono>
        <Mono step="xs">{chosen} selected</Mono>
      </div>
      <label className="target flex flex-col gap-1">
        <Mono step="xs" className="text-label">
          Search
        </Mono>
        <input
          type="search"
          value={query}
          placeholder={`Search ${label.toLowerCase()}…`}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="rounded-field border border-hairline bg-panel px-3 py-2 text-body"
        />
      </label>
      {conditions === undefined ? undefined : (
        <button
          type="button"
          aria-pressed={isFiltered}
          onClick={() => {
            setIsFiltered(!isFiltered);
          }}
          className="target flex items-center self-start rounded-pill border border-hairline px-3 text-quiet"
        >
          <Mono step="xs">Matches conditions</Mono>
        </button>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {found.map((item) => (
          <li key={item.id}>
            <label className="target flex items-center gap-3 text-body">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => {
                  onToggle(item.id);
                }}
              />
              <span>
                {item.brand === null ? "" : `${item.brand} `}
                {item.name}
              </span>
              {item.untested ? (
                <Bracketed className="text-muted">untested</Bracketed>
              ) : undefined}
            </label>
          </li>
        ))}
      </ul>
      {isFiltered && group.hiddenByFilterCount > 0 ? (
        <Mono step="xs" className="text-muted">
          Hidden by the filter · {group.hiddenByFilterCount}
        </Mono>
      ) : undefined}
      <button
        type="button"
        onClick={onClose}
        className="target cursor-pointer rounded-pill border border-hairline bg-transparent px-6 py-3 text-body font-semibold"
      >
        Done
      </button>
    </div>
  );
}
