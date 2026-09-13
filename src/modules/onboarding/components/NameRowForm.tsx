import type { JSX } from "react";
import { useState } from "react";

import {
  FormFailureBand,
  FormStatus,
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
  brandOptions: readonly string[];
  onBrandInput: (value: string) => void;
  modelOptions: readonly string[];
  onNamed: (result: NamedResult) => void;
}>): JSX.Element {
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");

  const form = useFormSubmit({
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
        list={`brands-${itemId}`}
      />
      <datalist id={`brands-${itemId}`}>
        {brandOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>

      <TextField
        name="model"
        label={LABELS.model}
        value={model}
        onChange={setModel}
        field={form.field}
        error={form.fieldErrors.model}
        autoComplete="off"
        list={`models-${itemId}`}
      />
      <datalist id={`models-${itemId}`}>
        {modelOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <span className="text-xs text-night/50">Brand alone is enough.</span>

      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton label="Save" pendingLabel="Saving" pending={form.pending} />
    </form>
  );
}
