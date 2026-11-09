import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";

import type { GarmentVisibility, TempUnit } from "../../../lib/contracts";
import { photoAcceptAttribute } from "../../../lib/photo-constraints";
import { formatTempRange } from "../../../lib/contracts/thermal";
import {
  Bracketed,
  ControlFailureBand,
  FileWell,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  useControlAction,
  PHOTO_STILL_ON,
  usePhotoPick,
} from "../../../ui";
import type { PhotoStep } from "../../../ui";
import { ProductLink } from "../../../ui/ProductLink";
import { garmentLabel } from "../../../lib/garment-label";
import { isPhotoBeingChecked, photoUrlFor } from "../photo-url";
import { runsLabel } from "../../../lib/runs-label";
import { retiredLabel } from "../retired-label";
import { kindLabel, typeOf } from "../type-labels";
import { useRunnerZone } from "./use-runner-zone";
import { CompositionBlock } from "./Composition";
import { CorrectionSheet, type CorrectionSheetProps } from "./CorrectionSheet";
import { BackToCloset } from "./BackToCloset";
import { DeleteWithRuns, type BandCount } from "./DeleteWithRuns";
import { GarmentConfirm, type ConfirmKind } from "./GarmentConfirm";
import { GARMENT_PHOTO_COPY } from "./photo-pick";
import type { LinkOutcome } from "../garment-link";
import type {
  EffectiveAttributes,
  WardrobeItemRow,
  getItemDetailWithPairs,
} from "../service";

type Detail = Awaited<ReturnType<typeof getItemDetailWithPairs>>;

/**
 * No count to ask for: a page composed without feed's (a test, or a
 * render of Y alone) says nothing about bands, which is what the sheet
 * does with a count that failed.
 */
async function noBandCount(): Promise<undefined> {
  // Nothing to count.
}

/**
 * What a delete hands the closet it lands on: the piece's name, for round
 * 26 #3's "{name} deleted." **History state, never the URL** (PR #129
 * review) — a search param would be free text anyone could put on a
 * runner's screen with a link, and would say it again on every reload of
 * a shared address. State is written only by the app's own navigation.
 */
declare module "@tanstack/react-router" {
  interface HistoryState {
    deletedGarment?: string;
  }
}

const VISIBILITY_WORDS = {
  reflective: "reflective trim",
  hi_viz: "hi-viz",
} as const satisfies Record<Exclude<GarmentVisibility, "plain">, string>;

/**
 * The weight as the line says it: round 22's §AG reads "· midweight", and
 * "mid" alone said nothing to a reader or a screen reader (a11y judgment
 * audit, 2026-11-04).
 */
const WEIGHT_WORDS = {
  light: "lightweight",
  mid: "midweight",
  heavy: "heavyweight",
} as const satisfies Record<NonNullable<EffectiveAttributes["weight"]>, string>;

/**
 * One of the words beside §AG's composition, and whether the product lent
 * it: the runner left that field empty and the shop's page filled it
 * (round 43 #94). A lent word is drawn in --quiet, the runner's in ink.
 */
interface AttributeWord {
  readonly word: string;
  readonly isLent: boolean;
}

/**
 * What the piece is built from and how — the words beside §AG's
 * composition ("82% merino, 18% nylon · midweight").
 *
 * `plain` visibility is not shown. All three values are stored because the
 * Call's rule needs to tell "plain" from "not answered", but "plain" on a
 * detail screen is a line that says nothing — the two worth reading are
 * the two that change how a garment is seen. Visibility is never lent.
 */
function attributeWords(
  effective: EffectiveAttributes,
  item: WardrobeItemRow,
): AttributeWord[] {
  const words: AttributeWord[] = [];
  if (effective.weight) {
    words.push({
      word: WEIGHT_WORDS[effective.weight],
      isLent: item.weight === null,
    });
  }
  if (effective.fabric) {
    words.push({ word: effective.fabric, isLent: item.fabric === null });
  }
  if (effective.windResistant) {
    words.push({ word: "wind resistant", isLent: item.windResistant === null });
  }
  if (effective.waterResistant) {
    words.push({
      word: "water resistant",
      isLent: item.waterResistant === null,
    });
  }
  if (item.visibilityLevel && item.visibilityLevel !== "plain") {
    words.push({ word: VISIBILITY_WORDS[item.visibilityLevel], isLent: false });
  }
  return words;
}

/**
 * The site a line names, kept in its own case inside an uppercase line:
 * a domain is data, and `JANJI.COM` is not how it is written. A source
 * that was denied is "the page" (design 163), which is a word and shouts
 * with the rest.
 */
function Site({ domain }: Readonly<{ domain: string | undefined }>) {
  return domain === undefined ? (
    "the page"
  ) : (
    <span className="normal-case">{domain}</span>
  );
}

/**
 * Round 43 #94's one line under the link: what enrichment made of it, as
 * a bracketed statement and, where the round gives one, a clause after.
 * `hasLentWords` keeps "grey values are from the page" to when there are
 * grey values to speak of.
 */
function outcomeParts(
  outcome: LinkOutcome,
  hasLentWords: boolean,
): { statement: ReactNode; clause: string | undefined } {
  switch (outcome.kind) {
    case "found": {
      return {
        statement: (
          <>
            Specs from <Site domain={outcome.source} />
          </>
        ),
        clause: hasLentWords ? "Grey values are from the page" : undefined,
      };
    }
    case "nothing": {
      return {
        statement: (
          <>
            No specs on <Site domain={outcome.source} />
          </>
        ),
        clause: undefined,
      };
    }
    case "unread": {
      return {
        statement: (
          <>
            Couldn&apos;t read <Site domain={outcome.source} />
          </>
        ),
        clause: outcome.isRetrying ? "Trying again today" : undefined,
      };
    }
    case "reading": {
      return {
        statement: "Reading the page",
        clause: "Usually under a minute",
      };
    }
    case "noIdentity": {
      return { statement: "Not read", clause: "Add a brand and model" };
    }
    case "unconfirmed": {
      return {
        statement: "Not read yet",
        clause: "Confirm your email to read it",
      };
    }
  }
}

/**
 * Round 43 #95: under the name, the shop's page as `ProductLink`, "Shop
 * page" with its domain beside it, and #94's outcome line beneath. A link
 * closet's one read will not show — denied, or not https — is no link
 * and no line here. Changed or removed through Edit only.
 */
function ShopPage({
  detail,
}: Readonly<{ detail: Detail }>): JSX.Element | undefined {
  const { link, outcome } = detail.linkDetail;
  if (link === undefined) return undefined;
  const hasLentWords = attributeWords(detail.effective, detail.item).some(
    (word) => word.isLent,
  );
  const parts =
    outcome === undefined ? undefined : outcomeParts(outcome, hasLentWords);
  return (
    <div data-part="shop-page" className="flex flex-col gap-1">
      <ProductLink url={link} label="Shop page" />
      {parts === undefined ? undefined : (
        <p className="m-0 text-quiet">
          <Bracketed step="xs">{parts.statement}</Bracketed>
          {parts.clause === undefined ? undefined : (
            <Mono step="xs">{` · ${parts.clause}`}</Mono>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Z2a's identity kicker: `TOP · HALF-ZIP · M`, and the two tags a piece can wear.
 *
 * `[RETIRED SEP 12]` rides the kicker in ink — *"brackets = a statement"*
 * — dated in the runner's zone (`retiredLabel`), and so does `[GENERIC]`,
 * which is F's word for a piece nobody named.
 */
function IdentityKicker({
  item,
  isGeneric,
}: Readonly<{ item: WardrobeItemRow; isGeneric: boolean }>): JSX.Element {
  const zone = useRunnerZone();
  // Z2a's `TOP · HALF-ZIP · M`: the type, once a piece has one (D-75).
  const words = [
    kindLabel(item.category, typeOf(item.category, item.type)),
    item.size,
  ]
    .filter((word) => word !== null && word !== "")
    .join(" · ");
  return (
    <p className="m-0 text-muted">
      <Mono step="xs">{words}</Mono>
      {isGeneric ? (
        <>
          <Mono step="xs"> · </Mono>
          <Bracketed step="xs" className="font-semibold text-ink">
            Generic
          </Bracketed>
        </>
      ) : undefined}
      {item.retired ? (
        <>
          <Mono step="xs"> · </Mono>
          <Bracketed step="xs" className="font-semibold text-ink">
            {retiredLabel(item.retiredAt, zone)}
          </Bracketed>
        </>
      ) : undefined}
    </p>
  );
}

/**
 * The colourway line under the name — §AH's structured name and the
 * runner's own word for it, as words, and round 22's square beside them
 * when an exact shade is known. The square is the shade the runner chose
 * (round 21, item 15: *"the square swatch is data, not a control"*), so it
 * is absent rather than guessed when there is none.
 */
function Colorway({
  item,
}: Readonly<{ item: WardrobeItemRow }>): JSX.Element | undefined {
  const words = [item.colorName, item.color].filter(
    (word) => word !== null && word !== "",
  );
  if (words.length === 0) return undefined;
  return (
    <p className="m-0 flex items-center gap-2 text-quiet">
      {item.colorHex === null ? undefined : (
        <span
          data-content=""
          aria-hidden="true"
          className="size-3 shrink-0"
          style={{ backgroundColor: item.colorHex }}
        />
      )}
      <Mono step="xs">{words.join(" · ")}</Mono>
    </p>
  );
}

/**
A piece never worn has no performance row; it reads as nothing yet.
*/
const NEVER_WORN = {
  runCount: 0,
  verdictCount: 0,
  dialedCount: 0,
  mileageM: 0,
};

function summaryOf(detail: Detail): typeof NEVER_WORN {
  return detail.performance?.summary ?? NEVER_WORN;
}

/**
 * Stats, then works-at: MONO.md for what was logged, MONO.sm in the
 * dialed hue for the band. Retired, the band is past tense — *"Works at →
 * WORKED AT"*. They share a row at width.
 */
function Stats({
  detail,
  tempUnit,
}: Readonly<{ detail: Detail; tempUnit: TempUnit }>): JSX.Element {
  const { item, tempRange } = detail;
  const summary = summaryOf(detail);
  const km = Math.round(summary.mileageM / 1000);
  const verdicts = summary.verdictCount;
  const dialed = String(summary.dialedCount);
  return (
    <div
      data-part="stats"
      className="flex flex-col gap-1 border-y border-hairline py-3 wide:flex-row wide:items-baseline wide:gap-6"
    >
      <Mono step="md">
        {`${String(km)} km logged`}
        {/* "3/5" is spoken "three slash five": the eye gets the ratio,
            a screen reader the sentence. */}
        {verdicts > 0 ? (
          <>
            {" · "}
            <span aria-hidden="true">{`${dialed}/${String(verdicts)} dialed`}</span>
            <span className="sr-only">{`${dialed} of ${runsLabel(verdicts)} dialed`}</span>
          </>
        ) : undefined}
      </Mono>
      {tempRange ? (
        <p className="m-0 text-dialed-text">
          <Mono>{item.retired ? "Worked at " : "Works at "}</Mono>
          <Bracketed>{formatTempRange(tempRange, tempUnit)}</Bracketed>
        </p>
      ) : (
        <p className="m-0 text-muted">
          <Bracketed>Untested</Bracketed>
        </p>
      )}
    </div>
  );
}

/**
 * Round 22: *"Pairs with lists up to three, by co-dialed count, and is
 * absent under 3 runs"* — the service decides which; this draws them.
 * A retired piece has none: *"Pairs with goes (it's a suggestion)."*
 */
function PairsWith({
  detail,
}: Readonly<{ detail: Detail }>): JSX.Element | undefined {
  if (detail.item.retired || detail.pairedItems.length === 0) return undefined;
  return (
    <section data-part="pairs-with" className="flex flex-col gap-2">
      <h2 className="m-0 text-muted">
        <Mono step="xs">Pairs with · when dialed</Mono>
      </h2>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {detail.pairedItems.map((pair) => (
          <li
            key={pair.item.id}
            className="rounded-pill border border-ink px-3 py-1"
          >
            <Mono step="xs">
              {pair.item.name}
              {/* The chip draws the count bare; spoken, it says of what. */}
              <span aria-hidden="true">{` · ${String(pair.count)}`}</span>
              <span className="sr-only">{`, ${runsLabel(pair.count)} dialed together`}</span>
            </Mono>
          </li>
        ))}
      </ul>
    </section>
  );
}

type GarmentDetailProps = Readonly<{
  detail: Detail;
  /**
  The runner's unit, for the works-at range.
  */
  tempUnit: TempUnit;
  retire: (input: { data: { itemId: string } }) => Promise<unknown>;
  unretire: (input: { data: { itemId: string } }) => Promise<unknown>;
  remove: (input: { data: { itemId: string } }) => Promise<unknown>;
  uploadPhoto: (input: {
    data: FormData;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  removePhoto: (input: { data: { itemId: string } }) => Promise<unknown>;
  /**
   * W3's blur, composed by the route: a garment photo is a photo, and a
   * face in it is somebody's face whatever screen it was taken on.
   */
  renderPhotoStep?: PhotoStep | undefined;
  /**
   * R-69's "being checked" band (round 27 #21), composed by the route
   * because its copy is safety's and this module may not import it. Shown
   * under the photo while `isPhotoBeingChecked` says so.
   */
  photoChecking?: ReactNode;
  /**
   * Feed's count of the 5 °C bands the piece has a verdicted run in, for
   * round 26's "Its record in {b} bands" — handed over by the route and
   * asked only when the delete sheet opens, so the page never waits on
   * it or fails with it.
   */
  bandCount?: BandCount | undefined;
  /**
   * §AG's WRONG? sheet (D-163, R48·129): its two server functions, handed
   * in by the route. Absent, the piece offers no correction.
   */
  correction?: CorrectionActions | undefined;
}>;

/**
 * The photo well's actions: Replace (through W3's step) and Remove, with
 * the field failure a refused file leaves and the status sentences the
 * three of them say.
 */
function usePhotoActions({
  itemId,
  uploadPhoto,
  removePhoto,
  renderPhotoStep,
}: Pick<GarmentDetailProps, "uploadPhoto" | "removePhoto" | "renderPhotoStep"> &
  Readonly<{ itemId: string }>) {
  const router = useRouter();
  const [photoError, setPhotoError] = useState<string | undefined>();
  const [status, setStatus] = useState("");

  /**
   * A replacement photo, once the bytes are the ones to send. A wrong type
   * or size comes back as a field failure on the well (the fix is another
   * file); a dropped connection throws, and lands on the band under it.
   */
  const upload = useControlAction({
    action: async (file: File) => {
      setPhotoError(undefined);
      const formData = new FormData();
      formData.set("itemId", itemId);
      formData.set("photo", file);
      const result = await uploadPhoto({ data: formData });
      if (!result.ok) {
        setPhotoError(result.error);
        return;
      }
      await router.invalidate();
    },
    kicker: "Nothing saved",
  });

  const removal = useControlAction({
    action: async () => {
      await removePhoto({ data: { itemId } });
      await router.invalidate();
    },
    kicker: PHOTO_STILL_ON,
  });

  const photo = usePhotoPick({
    renderPhotoStep,
    onReady: (file) => {
      void upload.run(file);
    },
  });

  return {
    upload,
    removal,
    photo,
    photoError,
    status: status || upload.status || removal.status,
    step: photo.step(setStatus),
  };
}

/**
 * Retire, Unretire and Delete, and which of the confirm sheets is open.
 */
function useGarmentLifecycle({
  itemId,
  name,
  retire,
  unretire,
  remove,
}: Pick<GarmentDetailProps, "retire" | "unretire" | "remove"> &
  Readonly<{ itemId: string; name: string }>) {
  const navigate = useNavigate();
  const router = useRouter();
  const [confirming, setConfirming] = useState<ConfirmKind | undefined>();

  const bringBack = useControlAction({
    action: async () => {
      await unretire({ data: { itemId } });
      await router.invalidate();
    },
    kicker: "Still retired",
  });

  /**
   * Land on the closet with retired pieces shown, so the piece is visibly
   * *there* and marked [Retired] — the grid hides retired pieces by
   * default, and without the switch on it would simply appear to have
   * been deleted by the action that promises not to.
   */
  async function toClosetWithRetired(): Promise<void> {
    await navigate({ to: "/closet", search: { retired: true } });
  }

  /**
   * One action per sheet, never one shared between them: a failure is a
   * fact about the thing that failed. Shared, a failed Retire followed by
   * Keep it and Delete opened the delete sheet showing "Not retired", and
   * its Try again replayed the retire under a heading asking to delete.
   */
  const retiring = useControlAction({
    action: async () => {
      await retire({ data: { itemId } });
      await router.invalidate();
      await toClosetWithRetired();
    },
    kicker: "Not retired",
  });

  const deleting = useControlAction({
    action: async () => {
      await remove({ data: { itemId } });
      // Round 26 #3: "On success: C, with a status line '{name} deleted.'"
      await navigate({ to: "/closet", state: { deletedGarment: name } });
    },
    kicker: "Not deleted",
  });

  return {
    confirming,
    setConfirming,
    bringBack,
    retiring,
    deleting,
    status: bringBack.status || retiring.status || deleting.status,
  };
}

/**
 * The photo, when there is one: the well is the photo, Replace and Remove
 * act on it, and their failures sit under it.
 */
function GarmentPhoto({
  item,
  label,
  photo,
  photoChecking,
}: Readonly<{
  item: WardrobeItemRow;
  label: string;
  photo: ReturnType<typeof usePhotoActions>;
  photoChecking: ReactNode;
}>): JSX.Element | undefined {
  const photoUrl = photoUrlFor(item);
  const { upload, removal } = photo;
  if (photoUrl === undefined) return undefined;
  return (
    <div className="flex flex-col gap-2">
      <FileWell
        part="photo-well"
        copy={GARMENT_PHOTO_COPY}
        pending={upload.pending || photo.photo.stepping}
        inputRef={photo.photo.wellRef}
        accept={photoAcceptAttribute}
        error={photo.photoError}
        preview={{ src: photoUrl, alt: label }}
        onRemove={() => {
          void removal.run();
        }}
        onFiles={(files) => {
          // Equivalent mutant on the optional index: a `change` from a
          // file input always carries a `FileList`, empty when the
          // picker was dismissed. The `?.` is the compiler's, because
          // the DOM types the property as nullable for inputs that are
          // not files at all.
          // Stryker disable next-line OptionalChaining
          const file = files?.[0];
          if (file) photo.photo.pick(file);
        }}
      />
      <ControlFailureBand
        failure={upload.failure}
        onRetry={upload.retry}
        retryRef={upload.retryRef}
      />
      <ControlFailureBand
        failure={removal.failure}
        onRetry={removal.retry}
        retryRef={removal.retryRef}
      />
      {photo.step}
      {isPhotoBeingChecked(item) ? photoChecking : undefined}
    </div>
  );
}

/**
 * WRONG?'s two server functions, as the route passes them.
 */
export type CorrectionActions = Pick<
  CorrectionSheetProps,
  "loadContext" | "fileCorrection"
>;

/**
 * §AG's composition and the words beside it; empty, the block hides
 * unless the piece is a shared product, which keeps WRONG? › (R-74).
 */
function CompositionSection({
  detail,
  correction,
}: Readonly<{
  detail: Detail;
  correction: CorrectionActions | undefined;
}>): JSX.Element {
  const { item, composition } = detail;
  const words = attributeWords(detail.effective, item);
  const wrong =
    correction === undefined || item.productId === null ? undefined : (
      <WrongLink
        subject={{
          productId: item.productId,
          garmentId: item.id,
          category: item.category,
        }}
        actions={correction}
      />
    );
  const block =
    composition === undefined ? undefined : (
      <CompositionBlock
        composition={{
          verbatim: composition.verbatim,
          parts: composition.parts,
          brand: item.brand ?? undefined,
        }}
        source={detail.linkDetail.specSource}
        wrong={wrong}
      />
    );
  return (
    <div data-part="composition" className="flex flex-col gap-2 empty:hidden">
      {/* §AG: the brand's own label. `brand` is the garment's, which is
          what the runner sees on the label in their hand; a piece with
          no brand gets no "as labelled by" line rather than an invented
          one. With no label to hang it on, WRONG? stands alone. */}
      {block ?? wrong}
      {words.length > 0 ? (
        <p className="m-0 text-body">
          {words.map(({ word, isLent }, index) => (
            <span key={word}>
              {index > 0 ? " · " : undefined}
              <span className={isLent ? "text-quiet" : "text-ink"}>{word}</span>
            </span>
          ))}
        </p>
      ) : undefined}
    </div>
  );
}

/**
 * `WRONG? ›` and the sheet it opens. A fresh sheet each time it opens, so
 * a sent one's receipt is not what the next press finds.
 */
function WrongLink({
  subject,
  actions,
}: Readonly<{
  subject: CorrectionSheetProps["subject"];
  actions: CorrectionActions;
}>): JSX.Element {
  const [opened, setOpened] = useState(0);
  const isOpen = opened > 0;
  return (
    <>
      <button
        type="button"
        data-part="wrong"
        onClick={() => {
          setOpened((count) => count + 1);
        }}
        className="target cursor-pointer border-none bg-transparent p-0 text-ink"
      >
        <Mono step="xs">
          Wrong? <span aria-hidden="true">›</span>
        </Mono>
      </button>
      {isOpen ? (
        <CorrectionSheet
          key={opened}
          open
          onClose={() => {
            setOpened(0);
          }}
          subject={subject}
          {...actions}
        />
      ) : undefined}
    </>
  );
}

/**
 * The confirm sheets. Round 26 #3: a piece with runs is asked whether to
 * retire it instead, in its own sheet; round 22's plain confirm stays for
 * one with none.
 */
function ConfirmSheets({
  item,
  runCount,
  bandCount,
  lifecycle,
}: Readonly<{
  item: WardrobeItemRow;
  runCount: number;
  bandCount: BandCount;
  lifecycle: ReturnType<typeof useGarmentLifecycle>;
}>): JSX.Element {
  const { confirming, setConfirming, retiring, deleting } = lifecycle;
  const isDeletingWorn = confirming === "delete" && runCount > 0;
  return (
    <>
      <GarmentConfirm
        kind={isDeletingWorn ? undefined : confirming}
        name={item.name}
        runCount={runCount}
        action={confirming === "delete" ? deleting : retiring}
        onClose={() => {
          setConfirming(undefined);
        }}
      />
      {runCount > 0 ? (
        <DeleteWithRuns
          open={isDeletingWorn}
          itemId={item.id}
          name={item.name}
          runCount={runCount}
          countBands={bandCount}
          retire={retiring}
          remove={deleting}
          onClose={() => {
            setConfirming(undefined);
          }}
        />
      ) : undefined}
    </>
  );
}

/**
 * One garment, in full — round 22's Y, whole.
 *
 * *"Order is fixed; a section with nothing in it is absent"*: identity,
 * photo, stats, composition, pairs with, actions. Every action is
 * secondary — *"nothing on this screen is the day's task"* — and Delete
 * is a text link apart from the other two.
 *
 * **No photo means no well here.** *"Adding one is Edit's job, so detail
 * never shows an empty Add box."* With a photo, the well is the photo:
 * Replace takes a new one through W3's blur, Remove takes it away.
 *
 * **Retire, don't delete** is a product rule, and where retiring lands the
 * runner is how the rule becomes visible: on the closet *with retired
 * pieces shown*, so the piece is plainly there and marked. Un-retiring
 * stays put and needs no confirm, because the tag going is the whole
 * confirmation.
 */
export function GarmentDetail({
  detail,
  retire,
  unretire,
  remove,
  uploadPhoto,
  removePhoto,
  renderPhotoStep,
  photoChecking,
  bandCount = noBandCount,
  tempUnit,
  correction,
}: GarmentDetailProps) {
  const { item, isGeneric } = detail;
  const itemId = item.id;
  const { runCount } = summaryOf(detail);
  // Same name for the heading and the photo's accessible name.
  const label = garmentLabel({ name: item.name, brand: item.brand, isGeneric });
  const photo = usePhotoActions({
    itemId,
    uploadPhoto,
    removePhoto,
    renderPhotoStep,
  });
  const lifecycle = useGarmentLifecycle({
    itemId,
    name: item.name,
    retire,
    unretire,
    remove,
  });
  const { bringBack, setConfirming } = lifecycle;

  return (
    <div className="mx-auto flex w-full max-w-column wide:mx-0 flex-col gap-5 px-4 py-8 wide:px-6">
      <FormStatus>{photo.status || lifecycle.status}</FormStatus>

      <div data-part="identity" className="flex flex-col gap-1">
        <BackToCloset />
        <IdentityKicker item={item} isGeneric={isGeneric} />
        <h1 className="m-0 font-display text-title">{label}</h1>
        <ShopPage detail={detail} />
        <Colorway item={item} />
      </div>

      <GarmentPhoto
        item={item}
        label={label}
        photo={photo}
        photoChecking={photoChecking}
      />

      <Stats detail={detail} tempUnit={tempUnit} />

      <CompositionSection detail={detail} correction={correction} />

      <PairsWith detail={detail} />

      <div
        data-part="actions"
        className="flex items-center gap-2 border-t border-hairline pt-4 wide:border-t-0 wide:pt-0"
      >
        {/* Retired, Edit goes — *"you don't edit a retired piece;
            unretire first"* — and Unretire takes Retire's place. */}
        {item.retired ? (
          <button
            type="button"
            {...inFlight(bringBack.pending)}
            onClick={() => {
              void bringBack.run();
            }}
            className="target inline-flex cursor-pointer items-center rounded-pill border border-hairline bg-transparent px-5 py-3 text-body font-semibold text-ink no-underline"
          >
            <PendingLabel
              label="Unretire"
              pendingLabel="Unretiring"
              pending={bringBack.pending}
            />
            <span className="sr-only">{` ${label}`}</span>
          </button>
        ) : (
          <>
            <Link
              to="/closet/edit/$itemId"
              params={{ itemId }}
              className="target inline-flex cursor-pointer items-center rounded-pill border border-hairline bg-transparent px-5 py-3 text-body font-semibold text-ink no-underline"
            >
              Edit
              {/* Every action names the piece it acts on, for a screen
                  reader that lands on it alone. */}
              <span className="sr-only">{` ${label}`}</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setConfirming("retire");
              }}
              className="target inline-flex cursor-pointer items-center rounded-pill border border-hairline bg-transparent px-5 py-3 text-body font-semibold text-ink no-underline"
            >
              Retire
              <span className="sr-only">{` ${label}`}</span>
            </button>
          </>
        )}
        {/* Always offered, and always a text link beside the pills: Retire
            is the recommended action, Delete the secondary one (owner's
            ruling on task 122). Its sheet says what a delete costs. */}
        <button
          type="button"
          onClick={() => {
            setConfirming("delete");
          }}
          className="target ml-auto cursor-pointer border-none bg-transparent px-1 text-body text-quiet underline underline-offset-4"
        >
          Delete
          <span className="sr-only">{` ${label}`}</span>
        </button>
      </div>
      <ControlFailureBand
        failure={bringBack.failure}
        onRetry={bringBack.retry}
        retryRef={bringBack.retryRef}
      />

      <ConfirmSheets
        item={item}
        runCount={runCount}
        bandCount={bandCount}
        lifecycle={lifecycle}
      />
    </div>
  );
}
