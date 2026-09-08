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
import { manualRunInput, submitManualRun } from "../functions";

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

const LABELS = {
  title: "Title",
  startedAt: "Started",
  durationS: "Minutes",
  distanceM: "Distance (km)",
};

export function ManualRunForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("Morning run");
  const [startedAt, setStartedAt] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [distanceKm, setDistanceKm] = useState("5");
  const [indoor, setIndoor] = useState(false);
  const [effort, setEffort] = useState<Effort | "">("");
  const { idempotencyKey, rotate } = useIdempotencyKey();

  const form = useFormSubmit({
    schema: manualRunInput,
    action: async (values) => submitManualRun({ data: values }),
    successMessage: "Run logged.",
    labels: LABELS,
    onSuccess: async (created) => {
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
          durationS: Math.round(Number(minutes) * 60),
          distanceM: Number(distanceKm) * 1000,
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
            const { value } = event.target;
            setEffort(value === "" || isEffort(value) ? value : "");
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
