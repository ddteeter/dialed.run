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
 * **Drawn at 32, hit at 44** (round 21, ask 4): `h-8` is the drawing and
 * `target-seam` the target — a `::before` six pixels proud above and
 * below. `target` would pad the box itself to 44, which is the height the
 * ruling takes away.
 *
 * **Read-only, a chosen chip keeps its ink and loses its ✕.** Round 21:
 * *"After Log it the chips stay, read-only (chosen still inked, no ✕)"*.
 * The ✕ is the offer to un-choose, and a receipt makes no offers.
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
          ? "target-seam flex h-8 items-center gap-1 rounded-pill border border-ink bg-ink px-3 text-ground"
          : "target-seam flex h-8 items-center gap-1 rounded-pill border border-hairline px-3 text-quiet"
      }
    >
      <Mono step="sm">{children}</Mono>
      {pressed && !readOnly ? <Icon name="close" size={12} /> : undefined}
    </button>
  );
}

/**
 * The chips' group: wrapping, with round 21's `12px 7px` gap — the row gap
 * is the one that makes two rows' 44px targets meet at the seam rather
 * than overlap. A3's row and A3b's tags both sit in one.
 */
export function ChipRow({
  slot,
  children,
}: Readonly<{ slot?: string | undefined; children: ReactNode }>) {
  return (
    <div data-slot={slot} className="flex flex-wrap gap-x-[7px] gap-y-3">
      {children}
    </div>
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
 *
 * **MORE › leaves with share and submit when Noted lands** (round 21, ask
 * 1a): *"An inert control that still looks tappable is a lie"*. So a
 * read-only row has no MORE at all, rather than one that does nothing.
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
      <ChipRow slot="flag-chips">
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
        {readOnly ? undefined : (
          <button
            type="button"
            data-slot="flag-more"
            aria-haspopup="dialog"
            onClick={onMore}
            className="target-seam flex h-8 items-center rounded-pill border border-hairline px-3 font-semibold text-cold-text"
          >
            <Mono step="sm">More &rsaquo;</Mono>
          </button>
        )}
      </ChipRow>
    </div>
  );
}
