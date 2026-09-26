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
  const { flagFor, onFlag, tags, onTag } = answer;
  // Looked up directly rather than through `verdictLabel`, which takes a
  // number: no verdict simply finds no step.
  const label = verdictScale.find((step) => step.value === verdict)?.label;
  return (
    <Sheet open={open} onClose={onClose} label="Anything specific?">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-display text-heading">Anything specific?</h2>
          <Mono step="xs" className="text-muted">
            {label === undefined ? "Optional" : `${label} · optional`}
          </Mono>
        </div>

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
