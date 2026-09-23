import { entryTags } from "../../../lib/contracts";
import { ChoiceList, Mono, Sheet } from "../../../ui";
import type { FieldProps } from "../../../ui";
import { ITEM_FLAG_LABELS, ITEM_FLAG_OPTIONS, tagLabel } from "../chips";
import type { EntryTag, ItemFlagChoice } from "../chips";
import { ChipToggle } from "./VerdictChips";

/**
 * A3b — everything A3's five chips cannot hold (design round 20): *"every
 * kit garment as a Fine / Too much / Not enough triple, plus all nine tags;
 * that is how 'the Harrier was not enough' is said when it wasn't
 * suggested."*
 *
 * **Undesigned.** Round 20 describes this sheet and draws no board for it,
 * so it is composed from what exists and nothing else: the `Sheet`, one
 * `ChoiceList` per garment — the per-item groups A3 carried inline before
 * the chips replaced them — and the chips' own toggle for the tags. It is
 * listed in `docs/design-deltas.md`.
 *
 * It edits the same answer the chips do, not a copy: a choice here is a
 * pressed chip on A3 when the sheet closes.
 */
export function SpecificsSheet({
  open,
  onClose,
  items,
  flagFor,
  onFlag,
  tags,
  onTag,
  field,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  items: readonly { itemId: string; name: string }[];
  flagFor: (itemId: string) => ItemFlagChoice;
  onFlag: (itemId: string, flag: ItemFlagChoice) => void;
  tags: ReadonlySet<string>;
  onTag: (tag: EntryTag) => void;
  field: (name: string) => FieldProps;
}>) {
  return (
    <Sheet open={open} onClose={onClose} label="Anything specific?">
      <div className="flex flex-col gap-6">
        <h2 className="m-0 font-display text-heading">Anything specific?</h2>

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
          <div className="flex flex-wrap gap-2">
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
          </div>
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
