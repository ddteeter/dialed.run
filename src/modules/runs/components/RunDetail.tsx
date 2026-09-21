import { RETRY_SAVE } from "../../../lib/copy";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Bracketed, inFlight, Mono, PendingLabel } from "../../../ui";
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
    // The guard the `disabled` attribute used to be. `aria-disabled` keeps
    // the button focusable and announcing (rule 07), so the second press
    // still arrives and has to die here rather than at the markup.
    if (isSubmitting) return;
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
      className="flex flex-col gap-3 rounded-card border border-hairline bg-panel p-4"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <Bracketed className="text-cold-text">Unavailable</Bracketed>
      <p className="m-0 text-small text-quiet">
        We couldn&rsquo;t resolve conditions automatically. You can type a
        temperature — it won&rsquo;t train the model.
      </p>
      <label className="target flex items-center gap-2 text-body font-semibold">
        Temp (°C)
        <input
          type="number"
          value={tempC}
          onChange={(event) => {
            setTempC(event.target.value);
          }}
          className="w-24 rounded-field border border-hairline px-3 py-2 font-normal"
        />
      </label>
      {error === undefined ? undefined : (
        <p className="text-small font-semibold text-cold-text">{error}</p>
      )}
      {/* `aria-disabled`, never `disabled` (rule 07) — and no dimming,
          because rule 02 bans opacity as a meaning channel. What says the
          work is happening is the label, per design's round-13 table. The
          guard is in `submit` below, where a second press has to die. */}
      <button
        type="submit"
        {...inFlight(isSubmitting)}
        className="target self-start rounded-pill bg-ink px-4 py-2 font-semibold text-ground"
      >
        <PendingLabel
          label="Save temperature"
          pendingLabel="Saving"
          pending={isSubmitting}
        />
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
      <h1 className="font-display text-title uppercase">{run.title}</h1>
      <Mono step="md" className="text-quiet">
        {(run.distanceM / 1000).toFixed(2)} KM ·{" "}
        {Math.round(run.durationS / 60)} MIN
      </Mono>
      {isIndoor && <Bracketed className="text-quiet">Indoor</Bracketed>}
      {requiresManualTemp && (
        <ManualTempFallback
          runId={run.id}
          recordManualTemp={recordManualTemp}
        />
      )}
      {/* CTA slot repointed by lane 104 to attach-the-kit (A2). */}
      <div data-slot="attach-kit-cta" />
    </div>
  );
}
