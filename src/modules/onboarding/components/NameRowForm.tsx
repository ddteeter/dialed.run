import type { JSX } from "react";
import { useState } from "react";

import {
  FormFailureBand,
  FormStatus,
  Mono,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import { nameIdentityInput } from "../inputs";
import type { NameIdentity } from "../inputs";
import type { NamedResult } from "../naming";

const LABELS = { brand: "Brand", model: "Model" };

/**
 * The two fields P2.5 asks for, expanded in place (design §AC2).
 *
 * **Two fields, one required.** Brand resolves against the curated seed
 * list; model is optional, suggested from that brand's known products and
 * typed only if none fit. **Brand alone is enough** — a runner who knows
 * it is a Smartwool and not which one has told us something true, and the
 * row keeps its own name and stays on offer (rule 04).
 *
 * **No photo field, and that is design's reasoning rather than a cut:**
 * naming is an act of *identity*, and a photo says nothing about which
 * product this is. Photos stay on garment detail, where they are about
 * appearance.
 *
 * **No link field either** (rule Q3, and my recommendation that design
 * agreed with): pasting a URL triggers enrichment, enrichment is lane 107,
 * and `src/modules/enrichment/` does not exist. A field that swallows a
 * URL and shows nothing is a screen making a promise the build cannot
 * keep — on the one screen whose entire job is to be believed.
 *
 * It is not screen F and it does not navigate (rule 03): F builds a
 * garment from nothing, this attaches an identity to one that already has
 * verdicts and a range worth keeping.
 */
export function NameRowForm({
  itemId,
  label,
  nameGarment,
  brandOptions,
  onBrandInput,
  modelOptions,
  onNamed,
}: Readonly<{
  itemId: string;
  /**
  The tap-list name, kept when only a brand is given.
  */
  label: string;
  nameGarment: (input: {
    data: { itemId: string } & NameIdentity;
  }) => Promise<NamedResult>;
  /**
   * Names, not ids, and keyed by name — on purpose. A chip only fills
   * the field with text, and the runner may type a brand that is on no
   * list at all, so what the form sends is the name either way
   * and the server resolves it: `createOrGetBrand` and `resolveProduct`
   * find-or-create the row on the *normalized* name, which is where the
   * system-level ids are minted. The name is a safe React key because the
   * same normalization is a UNIQUE index — two rows cannot share one.
   */
  brandOptions: readonly string[];
  onBrandInput: (value: string) => void;
  /**
  Product names for the typed brand, on the same terms as `brandOptions`.
  */
  modelOptions: readonly string[];
  onNamed: (result: NamedResult) => void;
}>): JSX.Element {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");

  const form = useFormSubmit({
    carry: "page",
    schema: nameIdentityInput,
    action: (values) => nameGarment({ data: { itemId, ...values } }),
    onSuccess: onNamed,
    successMessage: `${label} named.`,
    labels: LABELS,
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({ brand, model: model === "" ? undefined : model });
      }}
    >
      <FormStatus>{form.status}</FormStatus>

      <TextField
        name="brand"
        label={LABELS.brand}
        value={brand}
        onChange={(value) => {
          setBrand(value);
          onBrandInput(value);
        }}
        field={form.field}
        error={form.fieldErrors.brand}
        autoComplete="off"
      />
      <SuggestionChips
        options={brandOptions}
        onPick={(option) => {
          setBrand(option);
          onBrandInput(option);
          // A picked brand answers "Which brand?" as typing one would.
          form.markField("brand", undefined);
        }}
      />

      <TextField
        name="model"
        label={LABELS.model}
        value={model}
        onChange={setModel}
        field={form.field}
        error={form.fieldErrors.model}
        autoComplete="off"
      />
      <SuggestionChips options={modelOptions} onPick={setModel} />

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      {/* Save with the form's note beside it (AC2a, R55·229). An empty
          save's message under Brand says it instead, so the note goes. */}
      <div data-part="save-row" className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label="Save"
          pendingLabel="Saving"
          pending={form.pending}
          tone="secondary"
        />
        {form.fieldErrors.brand === undefined ? (
          <span className="text-small text-quiet">Brand alone is enough.</span>
        ) : undefined}
      </div>
    </form>
  );
}

/**
 * Suggestions as chips under their field (AC2a, R55·229), where a
 * `<datalist>` drew the browser's own ▼ in the field. A tap fills the
 * field; anything else is still typed. None, nothing drawn.
 */
function SuggestionChips({
  options,
  onPick,
}: Readonly<{
  options: readonly string[];
  onPick: (option: string) => void;
}>): JSX.Element | undefined {
  if (options.length === 0) return undefined;
  return (
    <div data-part="suggestions" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => {
            onPick(option);
          }}
          className="target cursor-pointer rounded-pill border border-hairline bg-transparent px-3 py-2 text-quiet"
        >
          <Mono step="xs">{option}</Mono>
        </button>
      ))}
    </div>
  );
}
