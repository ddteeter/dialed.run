import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { JSX } from "react";

import type {
  ColorName,
  Garment,
  GarmentVisibility,
} from "../../../lib/contracts";
import {
  colorNameSchema,
  fabricSchema,
  garmentCategories,
  garmentCategoryLabels,
  garmentVisibilitySchema,
  layerSchema,
  weightSchema,
} from "../../../lib/contracts";
import {
  garmentCategoriesInOrder,
  hasGarmentAttribute,
  type GarmentAttributeKey,
} from "../../../lib/contracts/garment-fields";
import {
  estimateTempRange,
  formatTempRange,
} from "../../../lib/contracts/thermal";
import {
  Bracketed,
  causeLine,
  ChoiceField,
  ChoiceList,
  classifyFailure,
  ControlFailureBand,
  DeskSplit,
  FileWell,
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  ToggleField,
  useControlAction,
  useFormSubmit,
} from "../../../ui";
import { photoAcceptAttribute } from "../../../lib/photo-constraints";
import type { PhotoStep } from "../../../ui";
import { garmentFormSchema, type GarmentFormValues } from "../form-schema";
import { garmentLabel } from "../label";
import type { ClosetNearby } from "../nearby";
import { AlreadyInCloset } from "./AlreadyInCloset";
import { GARMENT_PHOTO_COPY, usePhotoPick } from "./photo-pick";
import {
  PHOTO_NOT_SAVED,
  PhotoRefused,
  type PhotoRefusal,
} from "./PhotoRefused";
import { ShadeSheet } from "./ShadeSheet";

type Category = (typeof garmentCategories)[number];

/**
 * Display names only. The *values* come from the schema's own enums below,
 * so an option can never exist that the contract would reject — a
 * hand-written `<option value="…">` list is a second statement of a set
 * zod already holds (CLAUDE.md, "Derive, don't mirror").
 */
const LAYER_LABELS: Record<(typeof layerSchema.options)[number], string> = {
  base: "Base",
  mid: "Mid",
  outer: "Outer",
};
const WEIGHT_LABELS: Record<(typeof weightSchema.options)[number], string> = {
  light: "Light",
  mid: "Mid",
  heavy: "Heavy",
};
const FABRIC_LABELS: Record<(typeof fabricSchema.options)[number], string> = {
  synthetic: "Synthetic",
  merino: "Merino",
  cotton: "Cotton",
  blend: "Blend",
  down: "Down",
};

/**
Field name -> human label, for the summary rows the contract requires once
two or more fields fail at once.
*/
const LABELS = {
  brand: "Brand",
  name: "Model / name",
  category: "Category",
  layer: "Layer",
  weight: "Weight",
  fabric: "Fabric",
  size: "Size",
  // The free text the runner types — a brand's own name for a shade, like
  // "Obsidian". §AH keeps it exactly as it was and calls it the colourway;
  // `colorName` below is the structured reading beside it. Two fields
  // labelled "Color" on one form is the collision that rename avoids.
  color: "Colorway",
  colorName: "Color",
  colorHex: "Hex",
  visibilityLevel: "Visibility",
};

/**
 * The thirteen, sentence-cased for the chip.
 *
 * **Not a re-hash of the database.** The *keys* are the contract's thirteen
 * names and `satisfies` is what holds them to it — add a fourteenth to
 * `colorNames`, or remove one, and this stops compiling. The *values* are
 * display copy that exists nowhere else: the column stores `hi_viz`, the
 * chip says "Hi-viz", and nothing in D1 knows the difference.
 *
 * **And the labels do not belong in the database**, for three reasons that
 * all point the same way. They are user-facing copy, which `docs/product.md`
 * §UI lexicon owns and which changes on a design round rather than on a
 * migration. The set is locked at thirteen and not user-extensible, so a
 * lookup table would be a join for a constant. And this renders in the
 * client bundle, so sourcing it from D1 means a query to draw a form.
 *
 * Written out rather than derived by capitalising `colorNames`, because
 * `Object.fromEntries` comes back as `Record<string, string>` and needs a
 * cast to narrow — and a cast cannot fail, so it would answer `undefined`
 * for a name nobody labelled. `garmentCategoryLabels` in `lib/contracts.ts`
 * made the same trade for the same reason.
 */
const COLOR_LABELS = {
  black: "Black",
  white: "White",
  grey: "Grey",
  navy: "Navy",
  brown: "Brown",
  beige: "Beige",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
} as const satisfies Record<ColorName, string>;

/**
 * Same split as `COLOR_LABELS`: the keys are `garmentVisibilities`, held
 * there by the annotation; the words are this screen's, and `hi_viz` is a
 * column value that no runner should ever read.
 */
const VISIBILITY_LABELS: Record<GarmentVisibility, string> = {
  plain: "Plain",
  reflective: "Reflective trim",
  hi_viz: "Hi-viz",
};

/**
 * Which attribute inputs a category admits. Derived from `garmentSchema`
 * via lib/contracts/garment-fields — this used to be a hand-written switch mirroring
 * the union, which meant adding an attribute to a category required
 * editing the schema, this file, and form-mapping.ts, with no type error
 * if you missed one.
 */
function fieldsForCategory(
  category: Category,
): Record<GarmentAttributeKey, boolean> {
  return {
    layer: hasGarmentAttribute(category, "layer"),
    weight: hasGarmentAttribute(category, "weight"),
    fabric: hasGarmentAttribute(category, "fabric"),
    windResistant: hasGarmentAttribute(category, "windResistant"),
    waterResistant: hasGarmentAttribute(category, "waterResistant"),
  };
}

const EMPTY_VALUES: GarmentFormValues = {
  brand: "",
  name: "",
  category: "top",
  size: "",
  color: "",
  colorName: "",
  colorHex: "",
  visibilityLevel: "",
  productUrl: "",
  layer: "",
  weight: "",
  fabric: "",
  windResistant: false,
  waterResistant: false,
};

export interface GarmentFormProps {
  /**
  The page's heading — "Add a garment", "Edit Harrier".
  */
  heading: string;
  /**
   * The way back to C (round 26 #9), handed in as the route's
   * `BackToCloset` so this form needs no router of its own.
   */
  back?: ReactNode;
  initial?: Partial<GarmentFormValues> | undefined;
  brandOptions?: readonly string[] | undefined;
  onBrandInput?: ((value: string) => void) | undefined;
  /**
   * The save, handed in rather than imported.
   *
   * `../functions` pulls TanStack Start's virtual server entry, so a file
   * that reaches it cannot be imported by any test. The route wires it and
   * closes over whatever differs between adding and editing — the
   * idempotency key, the item id — so this component does not branch on
   * which one it is.
   */
  save: (garment: Garment) => Promise<{ id: string }>;
  onSaved: (result: { id: string }) => Promise<void>;
  submitLabel: string;
  pendingLabel: string;
  successMessage: string;
  /**
   * Everything about the well, as one prop because it is one field: what
   * is stored, the two writes, and the step a picked photo goes through.
   */
  photo: GarmentPhoto;
  /**
   * The runner's closet by category, for F at the desk's rail card (round
   * 26 #10). The add form passes it; given it, the form is DS1's split.
   */
  nearby?: ClosetNearby | undefined;
}

interface GarmentPhoto {
  /**
   * The garment's stored photo, when it has one: the well's preview, and
   * what §AH's shade sampler reads a pixel out of.
   *
   * Handed in rather than derived, because the add form has no photo yet
   * and the edit form may. §AH: no photo, no sampler — the hex field
   * stands alone.
   */
  url?: string | undefined;
  /**
   * The photo's two writes, run after the save once the row exists — the
   * add form has no id to attach a photo to until then. Handed in for the
   * same reason as `save`.
   */
  upload: (input: {
    data: FormData;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (input: { data: { itemId: string } }) => Promise<unknown>;
  /**
  W3's blur, composed by the route — see `usePhotoPick`.
  */
  renderStep?: PhotoStep | undefined;
}

/**
 * F's column. Alone (Edit), the panel it always was; beside the rail (F at
 * the desk, round 26 #10), DS1's primary column, 620 at most and set to
 * the left as the log flow's desk pages are.
 */
const PRIMARY_ALONE =
  "mx-auto flex w-full max-w-panel flex-col gap-6 px-4 py-8 wide:px-6";
const PRIMARY_SPLIT = `${PRIMARY_ALONE} wide:mx-0 wide:max-w-column`;

/**
 * A blob URL for the held photo, revoked when it is replaced or dropped.
 */
function useObjectUrl(file: File | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (file === undefined) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [file]);
  return url;
}

/**
 * Screen F (v1, identity-first, D-27): brand + model lead; category one tap;
 * attribute fields collapsed below, shown only where the category admits
 * them. A generic entry (category + name only) is still one submit away —
 * never blocked on brand/model.
 *
 * **This form had no failure path before R-17.** It was presentational,
 * and the route called `garmentFromFormValues` — which ended in
 * `garmentSchema.parse` — inside a `void`-ed async handler. An invalid
 * garment threw into an unhandled rejection: no message, no mark, the
 * button simply did nothing. An `http://` product link and any over-long
 * value both reached it, since `type="url"` accepts the scheme and no
 * input carried a `maxLength`.
 *
 * The form is `noValidate` on purpose now. The browser's own checks are
 * not the contract's — they cannot produce the summary, the live-region
 * sentence or the failure band — so the schema is the single gate and
 * `useFormSubmit` renders what it says.
 */
// fallow-ignore-next-line code-duplication -- a ten-prop signature that matches feed/components/KitPicker.tsx KitList only by destructuring one prop per line; one edits a garment, the other picks a kit, and they share nothing to extract
export function GarmentForm({
  heading,
  back,
  initial,
  brandOptions,
  onBrandInput,
  save,
  onSaved,
  submitLabel,
  pendingLabel,
  successMessage,
  photo,
  nearby,
}: Readonly<GarmentFormProps>) {
  const [values, setValues] = useState<GarmentFormValues>({
    ...EMPTY_VALUES,
    ...initial,
  });
  const fields = fieldsForCategory(values.category);
  const [shadeOpen, setShadeOpen] = useState(false);
  /**
   * The photo is part of the form, so nothing about it is written until
   * the save: a picked photo is held (after W3's blur) and previewed from
   * the device, and Remove marks the stored one to go.
   */
  const [held, setHeld] = useState<File | undefined>();
  const [removed, setRemoved] = useState(false);
  /**
   * The saved garment whose photo did not go up, and why, when that is the
   * state (round 26 #4). The form has done its job — the row exists — so
   * its fields go and the screen becomes the saved garment's: what the
   * band's Try again and Pick another write against. Holding the id
   * rather than a flag means neither can be offered without one.
   */
  const [refused, setRefused] = useState<
    (PhotoRefusal & { itemId: string }) | undefined
  >();
  const [photoPending, setPhotoPending] = useState(false);
  const photoInFlight = useRef(false);
  const heldUrl = useObjectUrl(held);
  const preview = heldUrl ?? (removed ? undefined : photo.url);
  const pick = usePhotoPick({
    renderPhotoStep: photo.renderStep,
    onReady: (file) => {
      setHeld(file);
      // Once saved, a new photo has no form to wait for: it goes to the
      // saved garment as soon as it is ready.
      if (refused !== undefined) void finishWithPhoto(refused.itemId, file);
    },
  });

  const form = useFormSubmit({
    schema: garmentFormSchema,
    action: save,
    successMessage,
    labels: LABELS,
    onSuccess: async (saved) => {
      await finishWithPhoto(saved.id, held);
    },
  });

  /**
   * Edit's Remove, once the row is saved. A removal that fails is not
   * round 26 #4's state — there is no photo to add and nothing to pick —
   * so it is the control failure band under the well, in the words Y's
   * own Remove uses ("Photo kept"), with the fields left as they are.
   * Try again removes it and moves on; so does saving again.
   */
  const photoRemoval = useControlAction({
    action: async (itemId: string) => {
      await photo.remove({ data: { itemId } });
    },
    onSuccess: async (itemId) => {
      await onSaved({ id: itemId });
    },
    kicker: "Photo kept",
  });

  /**
   * The upload, after the row it belongs to exists — the add form has no
   * id before then. Any failure turns the screen into round 26 #4's saved
   * state, because the garment is saved and only the photo is owed: a
   * refusal carries the server's reason and offers another file, a throw
   * carries its cause and, if it was the connection, Try again. The cause
   * is the control's (`causeLine`), not the form's: the form's server line
   * ends "Nothing changed.", and the garment did change.
   * Returns whether the photo is now as the runner left it.
   */
  async function didUploadPhoto(itemId: string, file: File): Promise<boolean> {
    setPhotoPending(true);
    try {
      const data = new FormData();
      data.set("itemId", itemId);
      data.set("photo", file);
      const result = await photo.upload({ data });
      if (result.ok) return true;
      setRefused({ itemId, reason: result.error, canRetry: false });
      form.announce(PHOTO_NOT_SAVED);
      return false;
    } catch (error) {
      setRefused({
        itemId,
        reason: causeLine(error),
        canRetry: classifyFailure(error).kind === "network",
      });
      form.announce(PHOTO_NOT_SAVED);
      return false;
    } finally {
      setPhotoPending(false);
    }
  }

  /**
   * Write the photo, and move on only if it landed. One at a time: the
   * guard is a ref because two presses inside one render would both read
   * `photoPending` as false. A removal is its own control, with its own
   * guard.
   */
  async function finishWithPhoto(
    itemId: string,
    file: File | undefined,
  ): Promise<void> {
    if (file === undefined) {
      if (removed && photo.url !== undefined) await photoRemoval.run(itemId);
      else await onSaved({ id: itemId });
      return;
    }
    if (photoInFlight.current) return;
    photoInFlight.current = true;
    try {
      if (await didUploadPhoto(itemId, file)) await onSaved({ id: itemId });
    } finally {
      photoInFlight.current = false;
    }
  }

  /**
   * A file from the well, or from Pick another, into W3's step. Once
   * saved, what the step hands back goes straight to the garment.
   */
  function pickFrom(files: FileList | null): void {
    if (files === null) return;
    const file = files[0];
    if (file === undefined) return;
    pick.pick(file);
  }

  const estimate = useMemo(
    () =>
      estimateTempRange({
        category: values.category,
        // Equivalent mutants on both conversions, and the same class as
        // `estimateTempRange`'s own weight guard: the estimator reads
        // `layer === "outer"` and indexes its tables by weight, so an
        // empty string and an absent value already behave identically
        // there. These exist because `GarmentFormValues` types an
        // unanswered select as `""` and `ThermalInput` types it as
        // absent — the conversion is for the compiler, not the runtime.
        // Stryker disable next-line ConditionalExpression,StringLiteral
        layer: values.layer === "" ? undefined : values.layer,
        // Stryker disable next-line ConditionalExpression,StringLiteral
        weight: values.weight === "" ? undefined : values.weight,
        windResistant: values.windResistant,
      }),
    [values.category, values.layer, values.weight, values.windResistant],
  );

  function update<K extends keyof GarmentFormValues>(
    key: K,
    value: GarmentFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const fieldsView = (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit(values);
      }}
    >
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="font-display text-heading">What is it?</legend>
        <FormField
          name="brand"
          label={LABELS.brand}
          error={form.fieldErrors.brand}
        >
          <input
            {...form.field("brand")}
            id="brand"
            type="text"
            list="garment-brand-options"
            value={values.brand}
            onChange={(event) => {
              update("brand", event.target.value);
              onBrandInput?.(event.target.value);
            }}
            className="rounded-field border border-hairline bg-panel px-3 py-2 font-normal"
          />
        </FormField>
        <datalist id="garment-brand-options">
          {(brandOptions ?? []).map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <TextField
          name="name"
          label={LABELS.name}
          value={values.name}
          onChange={(value) => {
            update("name", value);
          }}
          field={form.field}
          error={form.fieldErrors.name}
        />
      </fieldset>

      <FormField
        name="category"
        label={LABELS.category}
        error={form.fieldErrors.category}
      >
        {/*
          `field()` carries `readOnly` for §5's "inputs stay focusable while
          in flight, never disabled". A `<select>` has no such attribute and
          React drops it while `pending` is false, so it is inert here
          rather than wrong — which is why this spreads the same helper as
          every text input instead of a filtered copy of it. The filtered
          copy existed briefly and its only effect was four mutants nothing
          could kill.
        */}
        <select
          {...form.field("category")}
          id="category"
          value={values.category}
          onChange={(event) => {
            update("category", event.target.value as Category);
          }}
          className="rounded-field border border-hairline bg-panel px-3 py-2 font-normal"
        >
          {garmentCategoriesInOrder.map((category) => (
            <option key={category} value={category}>
              {garmentCategoryLabels[category]}
            </option>
          ))}
        </select>
      </FormField>

      <fieldset className="flex flex-col gap-3 border-t border-hairline pt-4">
        <legend className="sr-only">Attributes</legend>
        {
          // fallow-ignore-next-line code-duplication -- three optional attributes rendered explicitly so the form reads as a form; the shared body is already ChoiceField
          fields.layer ? (
            <ChoiceField
              name="layer"
              label={LABELS.layer}
              error={form.fieldErrors.layer}
              field={form.field}
              value={values.layer}
              options={layerSchema.options}
              optionLabels={LAYER_LABELS}
              onChange={(picked) => {
                update("layer", picked);
              }}
            />
          ) : undefined
        }
        {fields.weight ? (
          <ChoiceField
            name="weight"
            label={LABELS.weight}
            error={form.fieldErrors.weight}
            field={form.field}
            value={values.weight}
            options={weightSchema.options}
            optionLabels={WEIGHT_LABELS}
            onChange={(picked) => {
              update("weight", picked);
            }}
          />
        ) : undefined}
        {fields.fabric ? (
          <ChoiceField
            name="fabric"
            label={LABELS.fabric}
            error={form.fieldErrors.fabric}
            field={form.field}
            value={values.fabric}
            options={fabricSchema.options}
            optionLabels={FABRIC_LABELS}
            onChange={(picked) => {
              update("fabric", picked);
            }}
          />
        ) : undefined}
        {fields.windResistant ? (
          <ToggleField
            name="windResistant"
            label="Wind resistant"
            field={form.field}
            isOn={values.windResistant}
            onChange={(next) => {
              update("windResistant", next);
            }}
          />
        ) : undefined}
        {fields.waterResistant ? (
          <ToggleField
            name="waterResistant"
            label="Water resistant"
            field={form.field}
            isOn={values.waterResistant}
            onChange={(next) => {
              update("waterResistant", next);
            }}
          />
        ) : undefined}
        {/* §AH: the fourth and fifth attributes, inside the group that is
            already collapsed. F stays identity-first and the tap count on
            the happy path does not move. Not gated on `fields.*` — every
            category has a colour, including the ones with no layer and no
            fabric. */}
        <ChoiceList
          name="visibilityLevel"
          legend={LABELS.visibilityLevel}
          layout="chips"
          options={garmentVisibilitySchema.options}
          optionLabels={VISIBILITY_LABELS}
          value={values.visibilityLevel}
          field={form.field}
          error={form.fieldErrors.visibilityLevel}
          onChange={(picked) => {
            update("visibilityLevel", picked);
          }}
        />
        <ChoiceList
          name="colorName"
          legend={LABELS.colorName}
          hint="Pick the nearest. A print is its main color."
          layout="chips"
          options={colorNameSchema.options}
          optionLabels={COLOR_LABELS}
          value={values.colorName}
          field={form.field}
          error={form.fieldErrors.colorName}
          onChange={(picked) => {
            update("colorName", picked);
          }}
        />
        {/* §AH: "Level 2 without level 1 isn't possible — the sheet is
            reached from a chosen name." So the affordance does not exist
            until a name does, rather than existing and refusing. */}
        {values.colorName === "" ? undefined : (
          <>
            <button
              type="button"
              onClick={() => {
                setShadeOpen(true);
              }}
              className="target cursor-pointer self-start border-none bg-transparent p-0 text-quiet underline underline-offset-4"
            >
              <Mono step="sm">
                Exact shade
                {values.colorHex === "" ? "" : ` · ${values.colorHex}`}
              </Mono>
            </button>
            <ShadeSheet
              open={shadeOpen}
              colorName={COLOR_LABELS[values.colorName]}
              value={values.colorHex}
              photoUrl={preview}
              onUse={(picked) => {
                update("colorHex", picked);
                setShadeOpen(false);
              }}
              onClear={() => {
                update("colorHex", "");
                setShadeOpen(false);
              }}
              onClose={() => {
                setShadeOpen(false);
              }}
            />
          </>
        )}
      </fieldset>

      {estimate ? (
        <p className="text-small text-quiet">
          Estimated{" "}
          <Bracketed className="text-dialed-text">
            {formatTempRange(estimate)}
          </Bracketed>
        </p>
      ) : undefined}

      <TextField
        name="size"
        label={LABELS.size}
        value={values.size}
        onChange={(value) => {
          update("size", value);
        }}
        field={form.field}
        error={form.fieldErrors.size}
      />
      <TextField
        name="color"
        label={LABELS.color}
        value={values.color}
        onChange={(value) => {
          update("color", value);
        }}
        field={form.field}
        error={form.fieldErrors.color}
      />
      {/* Round 22, item 17: the well is the last thing before the save —
          identity, Size, Colorway, photo, Add to closet. The product-link
          field that sat here is gone for v1 (AC2b: a field that can only
          say "pending" is a promise the build can't keep); F2a/F2b return
          with enrichment. A stored link still round-trips untouched,
          because the value rides in the form state the field no longer
          draws. */}
      <FileWell
        part="photo-well"
        copy={GARMENT_PHOTO_COPY}
        pending={pick.stepping || photoPending}
        accept={photoAcceptAttribute}
        preview={
          preview === undefined ? undefined : { src: preview, alt: values.name }
        }
        onRemove={() => {
          setHeld(undefined);
          setRemoved(true);
        }}
        onFiles={pickFrom}
      />
      {pick.step(form.announce)}
      <ControlFailureBand
        failure={photoRemoval.failure}
        onRetry={photoRemoval.retry}
        retryRef={photoRemoval.retryRef}
      />

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        pending={form.pending}
      />
    </form>
  );

  const primary = (
    <>
      {/* The one status region, outside both views: the sentence that
          says the photo did not go up is written as the fields leave. */}
      <FormStatus>{photoRemoval.status || form.status}</FormStatus>
      {back}
      <FormHeading
        heading={heading}
        saved={refused === undefined ? undefined : values}
      />
      {refused === undefined ? (
        fieldsView
      ) : (
        <SavedPhotoRefused
          onDone={() => {
            void onSaved({ id: refused.itemId });
          }}
        >
          <FileWell
            part="photo-well"
            copy={GARMENT_PHOTO_COPY}
            pending={pick.stepping || photoPending}
            accept={photoAcceptAttribute}
            onFiles={pickFrom}
          />
          {pick.step(form.announce)}
          <PhotoRefused
            refusal={refused}
            onRetry={() => {
              void finishWithPhoto(refused.itemId, held);
            }}
            onFiles={pickFrom}
          />
        </SavedPhotoRefused>
      )}
    </>
  );

  return (
    <FormFrame nearby={nearby} values={values}>
      {primary}
    </FormFrame>
  );
}

/**
 * F's frame: its column alone (Edit), or DS1's split at the desk with the
 * one rail card beside it when the runner's closet is handed in (round 26
 * #10) — which follows the category and the name as they are typed.
 */
function FormFrame({
  nearby,
  values,
  children,
}: Readonly<{
  nearby: ClosetNearby | undefined;
  values: GarmentFormValues;
  children: ReactNode;
}>): JSX.Element {
  if (nearby === undefined) {
    return (
      <div data-part="primary" className={PRIMARY_ALONE}>
        {children}
      </div>
    );
  }
  return (
    <DeskSplit
      rail={
        <AlreadyInCloset
          category={values.category}
          pieces={nearby[values.category] ?? []}
          typed={{ brand: values.brand, name: values.name }}
        />
      }
    >
      <div data-part="primary" className={PRIMARY_SPLIT}>
        {children}
      </div>
    </DeskSplit>
  );
}

/**
 * F's one heading, whichever view (Accessibility Contract rule 04): the
 * page's own while there is a form; once the garment is saved, the
 * piece's name in its own case under `SAVED TO CLOSET · {CATEGORY}`.
 */
function FormHeading({
  heading,
  saved,
}: Readonly<{
  heading: string;
  saved: GarmentFormValues | undefined;
}>): JSX.Element {
  // One `<h1>` in the source as well as on the screen, which is what the
  // one-heading check reads; the saved name keeps its own case.
  return (
    <div className="flex flex-col gap-1">
      {saved === undefined ? undefined : (
        <Mono step="xs" className="text-dialed-text">
          {`Saved to closet · ${garmentCategoryLabels[saved.category]}`}
        </Mono>
      )}
      <h1
        data-state={saved === undefined ? undefined : "saved"}
        className="m-0 font-display text-title uppercase data-[state=saved]:normal-case"
      >
        {saved === undefined
          ? heading
          : garmentLabel({
              name: saved.name,
              brand: saved.brand,
              // A piece saved with no brand is called by its name alone.
              isGeneric: saved.brand === "",
            })}
      </h1>
    </div>
  );
}

/**
 * Round 26 #4, "F Photo failed": the garment is saved, so the fields have
 * gone — F is the saved garment's page now, not a form to submit twice.
 * Under `SAVED TO CLOSET` and the piece's name (the page's one heading):
 * the empty well, the band under it, and **Done**, to the garment (Y).
 */
function SavedPhotoRefused({
  children,
  onDone,
}: Readonly<{
  /**
  The empty well, W3's step, and the band under them.
  */
  children: ReactNode;
  onDone: () => void;
}>): JSX.Element {
  return (
    <div data-part="saved" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">{children}</div>
      <button
        type="button"
        onClick={onDone}
        className="target w-full cursor-pointer rounded-pill border-none bg-ink px-4 py-4 text-lead font-bold text-ground"
      >
        Done
      </button>
    </div>
  );
}
