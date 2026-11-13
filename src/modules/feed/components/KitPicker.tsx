import type { JSX, ReactNode } from "react";
import { useState } from "react";

import { garmentCategoryLabels } from "../../../lib/contracts";
import type { Units } from "../../../lib/contracts";
import { formatTemp, precipClassOf } from "../../../lib/contracts/temperature";
import { Bracketed, FieldMessage, Icon, Mono, Sheet } from "../../../ui";
import type { Conditions } from "../../../lib/contracts";
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
 * The conditions filter chip, A2's ("41° damp") and A2b's ("Matches
 * conditions"), in one class string per state, keyed off `aria-pressed`
 * (D2-04, N1-17). On, it takes the board's teal fill and the `close`
 * glyph — the filter is applied, and this is what removes it; off, it is
 * the outline every other chip wears.
 *
 * **Drawn at 32, hit at 44**, as A3's chips are (round 21, ask 4): `h-8`
 * is the pill, sized to its words, and `target-seam` the target, six
 * pixels proud above and below. `target` grew the box itself to 44 next to
 * 10px mono, which read as a large empty button. Both rows it sits in
 * leave at least SPACE[3] above and below it, so the seam never overlaps a
 * neighbour's target.
 */
const FILTER_CHIP_CLASS = {
  on: "target-seam flex h-8 items-center gap-1 self-start rounded-pill border border-teal bg-teal px-3 text-accent-ink",
  off: "target-seam flex h-8 items-center gap-1 self-start rounded-pill border border-hairline px-3 text-quiet",
} as const;

function FilterChip({
  isOn,
  label,
  onToggle,
  children,
}: Readonly<{
  isOn: boolean;
  label?: string | undefined;
  onToggle: () => void;
  children: ReactNode;
}>): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      aria-label={label}
      onClick={onToggle}
      className={isOn ? FILTER_CHIP_CLASS.on : FILTER_CHIP_CLASS.off}
    >
      <Mono step="xs">{children}</Mono>
      {isOn ? <Icon name="close" size={12} /> : undefined}
    </button>
  );
}

/**
The word a category goes by, for a tile with no photo.
*/
const TYPE_WORDS: ReadonlyMap<string, string> = new Map(
  Object.entries(garmentCategoryLabels),
);

/**
 * The tile's well (Round 55 · 239): a 72 square, the hatch that means "no
 * photo" with the piece's type word in it, as the closet's tiles draw it.
 * Pressed is a 2px pink ring outside a 2px `--ground` gap, never an ink
 * fill. Decorative: the name under it is the button's name.
 */
const TILE_WELL_CLASS = {
  pressed:
    "photo-hatch flex size-18 items-center justify-center rounded-field font-display text-small uppercase text-muted ring-2 ring-action ring-offset-2 ring-offset-ground",
  resting:
    "photo-hatch flex size-18 items-center justify-center rounded-field font-display text-small uppercase text-muted",
} as const;

/**
 * One piece, as a tile: pressed when it is in the kit. The full name —
 * brand and name, as A2b's rows read it — sits under the well in
 * TYPE.small, clamped to two lines, so a long name is never cut inside
 * the tile (Round 55 · 239).
 */
function PieceTile({
  item,
  pressed,
  onToggle,
}: Readonly<{
  item: PickerItem;
  pressed: boolean;
  onToggle: () => void;
}>): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className="flex w-18 shrink-0 cursor-pointer flex-col gap-2 border-none bg-transparent p-0 text-left text-ink"
    >
      <span
        data-part="tile-well"
        aria-hidden="true"
        className={pressed ? TILE_WELL_CLASS.pressed : TILE_WELL_CLASS.resting}
      >
        {TYPE_WORDS.get(item.category)}
      </span>
      <span className="line-clamp-2 text-small">{fullName(item)}</span>
    </button>
  );
}

/**
"Janji Rover Half-zip": the brand, when there is one, then the name.
*/
function fullName(item: PickerItem): string {
  return item.brand === null ? item.name : `${item.brand} ${item.name}`;
}

/**
 * A2's closet picker: live from the first frame (round 22, "A2 Waiting":
 * *"Picker is live and unfiltered while waiting"*), a row of tiles for the
 * pieces a kit is built around, and a chip for each of the rest. Every
 * "ALL ›" and "+ CATEGORY" opens A2b for that group: a sheet below the
 * desk, as round 20 drew it, and a push into the column at the desk
 * (Round 54 · 164.3, which supersedes round 20's *"never a route"* there).
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
  onStatus,
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
  /**
   * The screen's one status region (rule 08): the filter says there how
   * many pieces it now shows, which otherwise changes in silence.
   */
  onStatus: (sentence: string) => void;
}>): JSX.Element {
  const rows = groups.filter((group) => ROW_GROUPS.has(group.group));
  const chips = groups.filter((group) => !ROW_GROUPS.has(group.group));
  const shown: Shown = isFiltered ? matchingOnly : everything;
  const countLine = isFiltered ? matchLine : totalLine;
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const showingLine = (isOn: boolean): string => {
    const showOf = isOn ? matchingOnly : everything;
    const count = groups.reduce((sum, group) => sum + showOf(group).length, 0);
    return `Showing ${String(count)} of ${String(total)}`;
  };

  return (
    <section
      data-slot="closet-picker"
      aria-labelledby="closet-picker-heading"
      className="flex flex-col gap-3"
    >
      {/* The heading has its row, and the chip and its count the row
          under it (D2-05): side by side, the longer "Or pick" heading
          wrapped the chip to the left while the shorter one left it at
          the right, so one control sat in two places. */}
      <h2 id="closet-picker-heading" className="m-0 text-muted">
        <Mono step="xs">
          {isOr ? "Or pick from the closet" : "From the closet"}
        </Mono>
      </h2>
      {conditions === undefined ? undefined : (
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            isOn={isFiltered}
            // The drawn conditions first, then what the chip does, in
            // the words the sheet's own chip uses.
            label={`${conditionsWords(conditions, units)}, matches conditions`}
            onToggle={() => {
              onFilter(!isFiltered);
              onStatus(showingLine(!isFiltered));
            }}
          >
            {conditionsWords(conditions, units)}
          </FilterChip>
          <Mono step="xs" className="text-muted">
            {showingLine(isFiltered)}
          </Mono>
        </div>
      )}
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
            {/* `-m-1 p-1`: the pressed ring sits 4px outside the well,
                and a scrolling row clips what overflows it. */}
            <div className="-m-1 flex gap-2 overflow-x-auto p-1">
              {shown(group).map((item) => (
                <PieceTile
                  key={item.id}
                  item={item}
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
        <PickBody
          key={group.group}
          layout="sheet"
          group={group}
          conditions={conditions}
          units={units}
          selected={selected}
          onToggle={onToggle}
          onDone={onClose}
        />
      )}
    </Sheet>
  );
}

/**
 * A2b at the desk (Round 54 · 164.3): not a sheet but a push into the 620
 * column — *"A list that can grow pushes."* The back link to A2, the title,
 * the meta, search, one card of checkboxes, then Done as the flow's pink
 * caps button at content width. Both ways out keep the picks: they are
 * A2's, and A2 is still there behind this page.
 */
export function KitPage({
  group,
  conditions,
  units,
  selected,
  onToggle,
  back,
  onDone,
}: Readonly<{
  group: PickerGroup;
  conditions: Conditions | undefined;
  units: Units;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  back: ReactNode;
  onDone: () => void;
}>): JSX.Element {
  return (
    <div data-slot="kit-page" className="flex flex-col gap-6">
      {back}
      <PickBody
        key={group.group}
        layout="push"
        group={group}
        conditions={conditions}
        units={units}
        selected={selected}
        onToggle={onToggle}
        onDone={onDone}
      />
    </div>
  );
}

/**
 * The sheet and the push are one body; what differs is the frame. In the
 * push the title is the page's heading, the checkboxes sit in one card,
 * and Done is the flow's forward action (Round 54 · 167).
 */
type PickLayout = "sheet" | "push";

const PICK_TITLE_CLASS: Readonly<Record<PickLayout, string>> = {
  sheet: "m-0 font-display text-heading",
  push: "m-0 font-display text-title",
};

const PICK_LIST_CLASS: Readonly<Record<PickLayout, string>> = {
  sheet: "m-0 flex list-none flex-col gap-1 p-0",
  push: "m-0 flex list-none flex-col gap-1 rounded-card border border-hairline bg-panel px-4 py-2",
};

const PICK_DONE_CLASS: Readonly<Record<PickLayout, string>> = {
  sheet:
    "target cursor-pointer rounded-pill border border-hairline bg-transparent px-6 py-3 text-body font-semibold",
  push: "target grid min-h-13 cursor-pointer place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase text-accent-ink",
};

function PickBody({
  layout,
  group,
  conditions,
  units,
  selected,
  onToggle,
  onDone,
}: Readonly<{
  layout: PickLayout;
  group: PickerGroup;
  conditions: Conditions | undefined;
  units: Units;
  selected: ReadonlySet<string>;
  onToggle: (itemId: string) => void;
  onDone: () => void;
}>): JSX.Element {
  const [query, setQuery] = useState("");
  const [isFiltered, setIsFiltered] = useState(
    conditions !== undefined && group.matchCount > 0,
  );
  const label = uiGroupLabels[group.group];
  const needle = query.toLowerCase();
  const shownHere: Shown = isFiltered ? matchingOnly : everything;
  // Brand and name as the row reads them, so a piece with no brand is
  // found by its name alone.
  const found = shownHere(group).filter((item) =>
    fullName(item).toLowerCase().includes(needle),
  );
  const chosen = group.items.filter((item) => selected.has(item.id)).length;
  // The page's heading in the push; the sheet's own title in the sheet.
  const Title = layout === "push" ? "h1" : "h2";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        {/* The pushed page's heading. In the sheet, the sheet's own label
            is the title (#643). */}
        {layout === "push" ? (
          <Title className={PICK_TITLE_CLASS[layout]}>{label}</Title>
        ) : undefined}
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
        <FilterChip
          isOn={isFiltered}
          onToggle={() => {
            setIsFiltered(!isFiltered);
          }}
        >
          Matches conditions
        </FilterChip>
      )}
      <ul className={PICK_LIST_CLASS[layout]}>
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
              <span>{fullName(item)}</span>
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
        onClick={onDone}
        className={PICK_DONE_CLASS[layout]}
      >
        Done
      </button>
    </div>
  );
}
