import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";

import type { effortSchema } from "../../../lib/contracts";
import {
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  SubmitButton,
  TextField,
  useFormSubmit,
  useIdempotencyKey,
} from "../../../ui";
import { manualRunInput } from "../inputs";

type Effort = z.infer<typeof effortSchema>;

const EFFORTS: readonly Effort[] = ["easy", "steady", "workout", "race"];

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

/**
 * `datetime-local` gives a string with no zone; the schema wants epoch
 * seconds. An empty or unparseable value becomes NaN, which the schema
 * rejects with its own sentence — so there is no hand-written client rule
 * here, which the contract forbids outright.
 */
function toEpochSeconds(localDateTime: string): number {
  return Math.floor(new Date(localDateTime).getTime() / 1000);
}

/**
 * Keyed by *schema field*, labelled in *input units*, and the two differ on
 * purpose.
 *
 * The contract stores SI — `durationS` is seconds, `distanceM` is metres —
 * because that is what makes pace arithmetic and the future unit
 * preference (D-6) a display concern rather than a storage one. Nobody
 * types seconds into a form, so the inputs take minutes and kilometres and
 * `toSeconds`/`toMetres` convert on submit.
 *
 * The keys cannot be renamed to match the labels: `useFormSubmit` looks a
 * field up by `name` to focus it and reads `fieldErrors[name]`, so the DOM
 * name has to be the schema key or a server-side error lands on nothing.
 *
 * The consequence to watch is that **the schema's error messages are
 * phrased in the input's units** — `durationS` says "How many minutes did
 * it take?" — because the schema's message is what the user reads.
 */
const LABELS = {
  title: "Title",
  startedAt: "Started",
  durationS: "Minutes",
  distanceM: "Distance (km)",
};

function toSeconds(minutes: string): number {
  return Math.round(Number(minutes) * 60);
}

function toMetres(kilometres: string): number {
  return Number(kilometres) * 1000;
}

/**
 * The server functions, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires them and this renders. Each prop's shape is the
 * server function's own, so the route passes them with no wrapper.
 */
export interface ManualRunFormProps {
  submitRun: (input: {
    data: z.infer<typeof manualRunInput>;
  }) => Promise<{ id: string }>;
}

export function ManualRunForm({ submitRun }: Readonly<ManualRunFormProps>) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("Morning run");
  // Equivalent mutant on the initial value: anything stryker substitutes
  // is not a parseable datetime either, so `toEpochSeconds` answers NaN
  // for both and the schema refuses both. The empty string is what a
  // `datetime-local` renders as blank.
  // Stryker disable next-line StringLiteral
  const [startedAt, setStartedAt] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [distanceKm, setDistanceKm] = useState("5");
  const [indoor, setIndoor] = useState(false);
  const [effort, setEffort] = useState<Effort | "">("");
  const { idempotencyKey, rotate } = useIdempotencyKey();

  const form = useFormSubmit({
    schema: manualRunInput,
    action: async (values) => submitRun({ data: values }),
    // Equivalent mutant on the sentence, and a finding rather than a gap:
    // `onSuccess` navigates to the new run, which unmounts the live region
    // in the same commit that fills it. Nothing can observe the
    // announcement, and a screen reader very likely cannot either.
    // Recorded as D-44.
    // Stryker disable next-line StringLiteral
    successMessage: "Run logged.",
    labels: LABELS,
    onSuccess: async (created) => {
      // Equivalent mutant: rotating the key matters for a *second* run
      // typed into the same mounted form, and the navigation below means
      // there is never one. It stays because the navigation is the
      // caller's to change.
      // Stryker disable next-line CallExpression
      rotate();
      await navigate({ to: "/runs/$runId", params: { runId: created.id } });
    },
  });

  return (
    <form
      ref={form.formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit({
          title,
          startedAt: toEpochSeconds(startedAt),
          durationS: toSeconds(minutes),
          distanceM: toMetres(distanceKm),
          indoor,
          idempotencyKey,
          ...(effort !== "" && { effort }),
        });
      }}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormErrorSummary
        rows={form.summaryRows}
        onFocusField={form.focusField}
        summaryRef={form.summaryRef}
      />
      <TextField
        name="title"
        label={LABELS.title}
        value={title}
        onChange={setTitle}
        field={form.field}
        error={form.fieldErrors.title}
      />
      <FormField
        name="startedAt"
        label={LABELS.startedAt}
        error={form.fieldErrors.startedAt}
      >
        <input
          {...form.field("startedAt")}
          id="startedAt"
          type="datetime-local"
          value={startedAt}
          onChange={(event) => {
            setStartedAt(event.target.value);
          }}
          className="w-full border-none bg-transparent outline-none"
        />
      </FormField>
      <div className="flex gap-4">
        <div className="flex-1">
          <FormField
            name="durationS"
            label={LABELS.durationS}
            error={form.fieldErrors.durationS}
          >
            <input
              {...form.field("durationS")}
              id="durationS"
              type="number"
              min="1"
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value);
              }}
              className="w-full border-none bg-transparent outline-none"
            />
          </FormField>
        </div>
        <div className="flex-1">
          <FormField
            name="distanceM"
            label={LABELS.distanceM}
            error={form.fieldErrors.distanceM}
          >
            <input
              {...form.field("distanceM")}
              id="distanceM"
              type="number"
              min="0.1"
              step="0.01"
              value={distanceKm}
              onChange={(event) => {
                setDistanceKm(event.target.value);
              }}
              className="w-full border-none bg-transparent outline-none"
            />
          </FormField>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={indoor}
          readOnly={form.pending}
          onChange={(event) => {
            setIndoor(event.target.checked);
          }}
        />
        Indoor / treadmill
      </label>
      <FormField
        name="effort"
        label="Effort (optional)"
        error={form.fieldErrors.effort}
      >
        <select
          {...form.field("effort")}
          id="effort"
          value={effort}
          onChange={(event) => {
            // `isEffort` alone: "" is not an effort, so it falls to the
            // same "" the explicit check used to produce — and the
            // fallback becomes the reachable path for "Not set" rather
            // than a branch nothing can take.
            const { value } = event.target;
            setEffort(isEffort(value) ? value : "");
          }}
          className="w-full border-none bg-transparent outline-none"
        >
          <option value="">Not set</option>
          {EFFORTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </FormField>
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label="Log run"
        pendingLabel="Logging"
        pending={form.pending}
      />
    </form>
  );
}
