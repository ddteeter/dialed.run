import { entryTags, verdictScale } from "../../../lib/contracts";
import { ChoiceList, Mono, Sheet } from "../../../ui";
import type { FieldProps } from "../../../ui";
import { ITEM_FLAG_LABELS, ITEM_FLAG_OPTIONS, tagLabel } from "../chips";
import type { EntryTag, ItemFlagChoice } from "../chips";
import { ChipRow, ChipToggle } from "./VerdictChips";

/**
 * A3b — everything A3's five chips cannot hold (design round 20): *"every
 * kit garment as a Fine / Too much / Not enough triple, plus all nine tags;
 * that is how 'the Harrier was not enough' is said when it wasn't
 * suggested."*
 *
 * **Drawn by round 21 "as you built it"** (Round 21 Rulings, "A3b
 * Anything specific"): the `Sheet`, one `ChoiceList` per garment legended
 * with its name, then all nine tags as A3's pill toggle. The board adds
 * one line under the title — the verdict it qualifies, "A BIT WARM ·
 * OPTIONAL" — and the tags take A3's 32px chips. Done and swipe-down both
 * keep; nothing asks to discard.
 *
 * It edits the same answer the chips do, not a copy: a choice here is a
 * pressed chip on A3 when the sheet closes.
 */
interface SpecificsSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * The verdict the sheet opened with, for the line under its title —
   * round 21 draws "A BIT WARM · OPTIONAL", the answer these specifics
   * qualify. Before a verdict the line is the "optional" alone.
   */
  verdict: number | undefined;
  items: readonly { itemId: string; name: string }[];
  /**
   * The answer the sheet edits — the same one A3's chips edit, so a choice
   * here is a pressed chip there when the sheet closes.
   */
  answer: SpecificsAnswer;
  field: (name: string) => FieldProps;
}

/**
 * A3's per-garment flags and tags, as the sheet reads and writes them.
 * One prop rather than four, because they are one thing: the specifics.
 */
interface SpecificsAnswer {
  flagFor: (itemId: string) => ItemFlagChoice;
  onFlag: (itemId: string, flag: ItemFlagChoice) => void;
  tags: ReadonlySet<string>;
  onTag: (tag: EntryTag) => void;
}

export function SpecificsSheet({
  open,
  onClose,
  verdict,
  items,
  answer,
  field,
}: Readonly<SpecificsSheetProps>) {
  return (
    <Sheet open={open} onClose={onClose} label="Anything specific?">
      <div className="flex flex-col gap-6">
        {/* The sheet's label is its title (#643); this is the line under it. */}
        <Mono step="xs" className="text-muted">
          {specificsLine(verdict)}
        </Mono>

        <SpecificsBody items={items} answer={answer} field={field} />

        <button
          type="button"
          onClick={onClose}
          className="target cursor-pointer rounded-pill border border-hairline bg-transparent px-6 py-3 text-body font-semibold"
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The line under A3b's title: the verdict these specifics qualify, or the
 * "optional" alone before one. Looked up directly rather than through
 * `verdictLabel`, which takes a number: no verdict simply finds no step.
 */
export function specificsLine(verdict: number | undefined): string {
  const label = verdictScale.find((step) => step.value === verdict)?.label;
  return label === undefined ? "Optional" : `${label} · optional`;
}

/**
 * A3b's body, between its title and Done: a group per garment, then the
 * tags. The sheet below the desk and the push at it (Round 54 · 164.3)
 * draw it alike.
 */
export function SpecificsBody({
  items,
  answer,
  field,
}: Readonly<Pick<SpecificsSheetProps, "items" | "answer" | "field">>) {
  const { flagFor, onFlag, tags, onTag } = answer;
  return (
    <>
      {items.map((item) => (
        // One group per garment, legended with its name, so a reader
        // entering the group hears which piece it is about.
        <ChoiceList
          key={item.itemId}
          name={`flag-${item.itemId}`}
          legend={item.name}
          layout="chips"
          options={ITEM_FLAG_OPTIONS}
          optionLabels={ITEM_FLAG_LABELS}
          value={flagFor(item.itemId)}
          field={field}
          onChange={(next) => {
            onFlag(item.itemId, next);
          }}
        />
      ))}

      <section className="flex flex-col gap-2">
        <h3>
          <Mono step="xs">Tags</Mono>
        </h3>
        <ChipRow>
          {entryTags.map((tag) => (
            <ChipToggle
              key={tag}
              pressed={tags.has(tag)}
              readOnly={false}
              onToggle={() => {
                onTag(tag);
              }}
            >
              {tagLabel(tag)}
            </ChipToggle>
          ))}
        </ChipRow>
      </section>
    </>
  );
}
