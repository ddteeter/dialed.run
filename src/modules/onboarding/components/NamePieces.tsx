import type { JSX } from "react";
import { useState } from "react";

import { Mono } from "../../../ui";
import type { NameableItem, NamedResult, NamingOffer } from "../naming";
import type { NameIdentity } from "../inputs";
import { MoreDisclosure } from "./MoreDisclosure";
import { NameRowForm } from "./NameRowForm";

/**
 * Screen P2.5 — "make them real" (design §AC).
 *
 * **The argument, in design's words: a category can't remember.** "Merino
 * base layer" cannot hold a temperature range, because no two of them are
 * the same garment — every verdict given to it averages against strangers'
 * different pieces. A named product is one object, and naming is how a
 * runner's piece joins a population.
 *
 * **Every generic row is offered, and the order carries the suggestion**
 * (rule 01) — the same doctrine as §AA's one list: rank, never filter. No
 * badge claims to know a stranger's favourites.
 *
 * **In v1 the order is closet order, and that is rule 02, not a shortcut.**
 * Design sorts rows worn on an O4-tagged run into their own heading first;
 * O4 is bulk history import and is out of this packet's scope (D-13), so
 * there are no tagged runs and rule 02 applies: *"the first heading is
 * absent — not empty. One flat list, closet order."*
 *
 * **Never a gate** (rule 04). The counter is a fraction, not a quota;
 * Next is live at zero named. O3 can say "enough to start" because six
 * taps is a real threshold for a first call — naming changes nothing about
 * whether the app works today.
 */
const FOLD = 5;

export function NamePieces({
  offer,
  nameGarment,
  brandOptions,
  onBrandInput,
  modelOptions,
  onDone,
}: Readonly<{
  offer: NamingOffer;
  nameGarment: (input: {
    data: { itemId: string } & NameIdentity;
  }) => Promise<NamedResult>;
  /**
  Brand suggestions for the row being named, from the curated seed list.
  */
  brandOptions: readonly string[];
  onBrandInput: (value: string) => void;
  /**
  This brand's known products — design's chips, "typed only if none fit".
  */
  modelOptions: readonly string[];
  /**
   * Both Next and Skip land on P3 (rule 06); the screen does not care
   * which, and never reappears either way.
   */
  onDone: () => void;
}>): JSX.Element {
  const [naming, setNaming] = useState<string>();
  const [named, setNamed] = useState<ReadonlyMap<string, NamedResult>>(
    new Map(),
  );
  const [expanded, setExpanded] = useState(false);

  // Only a linked product counts. A brand-only row has told us something
  // true and is not finished (rule 04), so counting it would inflate the
  // fraction against the runner's own sense of what they have done.
  //
  // The count is read, not announced: each row's own form owns the live
  // region and says what it named. Two regions on one screen is the case
  // §Forms & failure names outright — "two live regions firing at once
  // means one of them is lost" — and the screen-level one said less.
  let namedCount = 0;
  for (const [, row] of named) if (row.isNamed) namedCount += 1;

  const hidden = offer.items.slice(FOLD);
  const shown = expanded ? offer.items : offer.items.slice(0, FOLD);

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[15px] leading-relaxed text-night/70">
        Name those. A category can&rsquo;t remember &mdash; a product can.
      </p>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map((item) => (
          <li key={item.itemId}>
            <PieceRow
              item={item}
              result={named.get(item.itemId)}
              isNaming={naming === item.itemId}
              onStartNaming={() => {
                setNaming(item.itemId);
              }}
              nameGarment={nameGarment}
              brandOptions={brandOptions}
              onBrandInput={onBrandInput}
              modelOptions={modelOptions}
              onNamed={(result) => {
                setNamed((previous) =>
                  new Map(previous).set(item.itemId, result),
                );
                setNaming(undefined);
              }}
            />
          </li>
        ))}
      </ul>

      <MoreDisclosure
        remaining={hidden.length}
        expanded={expanded}
        onToggle={() => {
          setExpanded((previous) => !previous);
        }}
      />

      <div className="border-t border-night/15 pt-3">
        {/* A fraction, never a goal — and the same sentence shape the
            closet nudge already uses, so a runner meets one idea twice
            rather than two ideas once. */}
        <Mono className="text-night/50">
          {namedCount} of {offer.totalCount} named
        </Mono>
      </div>

      <NextAndSkip onDone={onDone} />
    </div>
  );
}

/**
 * Next is a plain button rather than a submit: nothing is saved here.
 *
 * Each row saves itself the moment it is named, so this screen has no
 * pending payload and no failure of its own — which is also why it cannot
 * gate. Skip is O3's underlined text, and both land on P3 (rule 06).
 */
function NextAndSkip({ onDone }: Readonly<{ onDone: () => void }>): JSX.Element {
  return (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={onDone}
        className="grid min-h-[52px] cursor-pointer place-items-center rounded-[10px] border-none bg-pink px-6 py-4 font-display text-base uppercase tracking-[-0.01em] text-night"
      >
        Next
      </button>
      <button
        type="button"
        onClick={onDone}
        className="cursor-pointer self-center border-none bg-transparent p-0 text-sm underline underline-offset-[3px]"
      >
        Skip for now
      </button>
    </div>
  );
}

/**
 * One offer: what it is now, and the form that gives it a name.
 *
 * Collapsed it states the Z language — `categoryLabel · GENERIC` — because
 * that is what the closet says about it everywhere else. Named, it states
 * the identity it gained.
 */
function PieceRow({
  item,
  result,
  isNaming,
  onStartNaming,
  nameGarment,
  brandOptions,
  onBrandInput,
  modelOptions,
  onNamed,
}: Readonly<{
  item: NameableItem;
  result: NamedResult | undefined;
  isNaming: boolean;
  onStartNaming: () => void;
  nameGarment: (input: {
    data: { itemId: string } & NameIdentity;
  }) => Promise<NamedResult>;
  brandOptions: readonly string[];
  onBrandInput: (value: string) => void;
  modelOptions: readonly string[];
  onNamed: (result: NamedResult) => void;
}>): JSX.Element {
  // A named row shows what it gained; a brand-only one shows what it now
  // knows and keeps its offer (rule 04).
  const label = result?.label ?? item.label;
  const subtitle = result?.subtitle ?? item.subtitle;
  const isFinished = result?.isNamed === true;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-night/15 bg-chalk px-[14px] py-[12px]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{label}</span>
          <Mono className="text-[10px] text-night/50">{subtitle}</Mono>
        </div>
        {isNaming || isFinished ? undefined : (
          <button
            type="button"
            onClick={onStartNaming}
            className="shrink-0 cursor-pointer rounded-full border border-night/20 bg-transparent px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.06em]"
          >
            Name it
          </button>
        )}
      </div>
      {isNaming ? (
        <NameRowForm
          itemId={item.itemId}
          label={item.label}
          nameGarment={nameGarment}
          brandOptions={brandOptions}
          onBrandInput={onBrandInput}
          modelOptions={modelOptions}
          onNamed={onNamed}
        />
      ) : undefined}
    </div>
  );
}

