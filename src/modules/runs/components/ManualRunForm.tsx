import { RETRY_SAVE } from "../../../lib/copy";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { z } from "zod";

import type { effortSchema } from "../../../lib/contracts";
import { submitManualRun } from "../functions";

type Effort = z.infer<typeof effortSchema>;

const EFFORTS: readonly Effort[] = ["easy", "steady", "workout", "race"];

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

function toEpochSeconds(localDateTime: string): number {
  return Math.floor(new Date(localDateTime).getTime() / 1000);
}

export function ManualRunForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("Morning run");
  const [startedAt, setStartedAt] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [distanceKm, setDistanceKm] = useState("5");
  const [indoor, setIndoor] = useState(false);
  const [effort, setEffort] = useState<Effort | "">("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (startedAt === "") {
      setError("When did you run?");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await submitManualRun({
        data: {
          title,
          startedAt: toEpochSeconds(startedAt),
          durationS: Math.round(Number(minutes) * 60),
          distanceM: Number(distanceKm) * 1000,
          indoor,
          ...(effort !== "" && { effort }),
        },
      });
      await navigate({ to: "/runs/$runId", params: { runId: created.id } });
    } catch {
      setError(RETRY_SAVE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Title
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          required
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Started
        <input
          type="datetime-local"
          value={startedAt}
          onChange={(event) => {
            setStartedAt(event.target.value);
          }}
          required
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        />
      </label>
      <div className="flex gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
          Minutes
          <input
            type="number"
            min="1"
            value={minutes}
            onChange={(event) => {
              setMinutes(event.target.value);
            }}
            className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm font-semibold">
          Distance (km)
          <input
            type="number"
            min="0.1"
            step="0.01"
            value={distanceKm}
            onChange={(event) => {
              setDistanceKm(event.target.value);
            }}
            className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={indoor}
          onChange={(event) => {
            setIndoor(event.target.checked);
          }}
        />
        Indoor / treadmill
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Effort (optional)
        <select
          value={effort}
          onChange={(event) => {
            const { value } = event.target;
            setEffort(value === "" || isEffort(value) ? value : "");
          }}
          className="rounded-md border border-night/20 bg-white px-3 py-2 font-normal"
        >
          <option value="">Not set</option>
          {EFFORTS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-night px-4 py-2 font-semibold text-chalk disabled:opacity-50"
      >
        Log the run
      </button>
    </form>
  );
}
