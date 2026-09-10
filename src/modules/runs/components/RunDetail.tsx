import { RETRY_SAVE } from "../../../lib/copy";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Bracketed, Mono } from "../../../ui";
import type { RunRow } from "../service";

/**
 * The manual-temp action, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires it and this renders. The prop's shape is the server
 * function's own, so the route passes it with no wrapper.
 */
export interface RunDetailProps {
  run: RunRow;
  recordManualTemp: (input: {
    data: { runId: string; tempC: number };
  }) => Promise<unknown>;
}

function ManualTempFallback({
  runId,
  recordManualTemp,
}: Readonly<Omit<RunDetailProps, "run"> & { runId: string }>) {
  const router = useRouter();
  const [tempC, setTempC] = useState("10");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setIsSubmitting(true);
    try {
      await recordManualTemp({
        data: { runId, tempC: Number(tempC) },
      });
      await router.invalidate();
    } catch {
      setError(RETRY_SAVE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-night/15 bg-white p-4"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <Bracketed className="text-pink">Unavailable</Bracketed>
      <p className="m-0 text-sm text-night/70">
        We couldn&rsquo;t resolve conditions automatically. You can type a
        temperature — it won&rsquo;t train the model.
      </p>
      <label className="flex items-center gap-2 text-sm font-semibold">
        Temp (°C)
        <input
          type="number"
          value={tempC}
          onChange={(event) => {
            setTempC(event.target.value);
          }}
          className="w-24 rounded-md border border-night/20 px-3 py-1.5 font-normal"
        />
      </label>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-md bg-night px-4 py-2 font-semibold text-chalk disabled:opacity-50"
      >
        Save temperature
      </button>
    </form>
  );
}

export function RunDetail({ run, recordManualTemp }: Readonly<RunDetailProps>) {
  const isIndoor = run.indoor;
  const requiresManualTemp =
    !isIndoor &&
    (run.weatherStatus === "failed" || run.weatherStatus === "pending");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl uppercase leading-none">
        {run.title}
      </h1>
      <Mono className="text-sm text-night/60">
        {(run.distanceM / 1000).toFixed(2)} KM ·{" "}
        {Math.round(run.durationS / 60)} MIN
      </Mono>
      {isIndoor && <Bracketed className="text-night/60">Indoor</Bracketed>}
      {requiresManualTemp && (
        <ManualTempFallback runId={run.id} recordManualTemp={recordManualTemp} />
      )}
      {/* CTA slot repointed by lane 104 to attach-the-kit (A2). */}
      <div data-slot="attach-kit-cta" />
    </div>
  );
}
