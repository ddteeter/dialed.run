import type { ReactNode } from "react";

import { Icon, Mono } from "../../../ui";
import { chipLabel } from "../chips";
import type { Chip } from "../chips";

/**
 * One chip: a toggle, pill-shaped, in the mono step the board sets its
 * chips in. Chosen, it inverts to ink and carries the board's "✕" — the
 * `close` glyph, decorative, because `aria-pressed` already says it is
 * chosen and a second announcement would say it twice.
 *
 * A3's row and A3b's tag list are the same control, so they share this
 * rather than each drawing a pill.
 */
export function ChipToggle({
  pressed,
  readOnly,
  onToggle,
  children,
}: Readonly<{
  pressed: boolean;
  readOnly: boolean;
  onToggle: () => void;
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      // Read-only once logged, and still focusable: rule 07 bans
      // `disabled`, and a receipt is for reading.
      aria-disabled={readOnly || undefined}
      onClick={() => {
        if (!readOnly) onToggle();
      }}
      className={
        pressed
          ? "target flex items-center gap-1 rounded-pill border border-ink bg-ink px-3 py-2 text-ground"
          : "target flex items-center gap-1 rounded-pill border border-hairline px-3 py-2 text-quiet"
      }
    >
      <Mono step="xs">{children}</Mono>
      {pressed ? <Icon name="close" size={12} /> : undefined}
    </button>
  );
}

/**
 * A3's "Anything specific?" row (design round 20): five generated chips,
 * then MORE ›, which opens A3b.
 *
 * The chips are chosen by `suggestChips`; this only draws them and says
 * which are pressed. A chip is pressed when the runner's answer already
 * holds it — its garment flagged that way, or its tag on — so a choice
 * made in A3b shows up here as a pressed chip too.
 */
export function VerdictChips({
  chips,
  chosenFlags,
  chosenTags,
  readOnly,
  onToggle,
  onMore,
}: Readonly<{
  chips: readonly Chip[];
  chosenFlags: Readonly<Record<string, string>>;
  chosenTags: ReadonlySet<string>;
  readOnly: boolean;
  onToggle: (chip: Chip, isPressed: boolean) => void;
  onMore: () => void;
}>) {
  return (
    <div className="flex flex-col gap-3">
      <h2>
        <Mono step="xs">Anything specific? · optional</Mono>
      </h2>
      {/* The name design's board gives this region, so the conformance
          run can diff the two directly. */}
      <div data-slot="flag-chips" className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const isPressed =
            chip.kind === "flag"
              ? chosenFlags[chip.itemId] === chip.flag
              : chosenTags.has(chip.tag);
          return (
            <ChipToggle
              // The chip itself is its identity: two chips alike in every
              // field are the same chip.
              key={JSON.stringify(chip)}
              pressed={isPressed}
              readOnly={readOnly}
              onToggle={() => {
                onToggle(chip, isPressed);
              }}
            >
              {chipLabel(chip)}
            </ChipToggle>
          );
        })}
        <button
          type="button"
          data-slot="flag-more"
          aria-haspopup="dialog"
          aria-disabled={readOnly || undefined}
          onClick={() => {
            if (!readOnly) onMore();
          }}
          className="target rounded-pill border border-hairline px-3 py-2 font-semibold text-cold-text"
        >
          <Mono step="xs">More &rsaquo;</Mono>
        </button>
      </div>
    </div>
  );
}
