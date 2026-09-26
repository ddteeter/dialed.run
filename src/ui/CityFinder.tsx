import type { JSX, KeyboardEvent } from "react";
import { useState } from "react";

import { cityLookupInput, cityNotFound } from "../lib/contracts";
import type { CityLookup, ResolvedPlace } from "../lib/contracts";
import { FailureBand, PendingLabel, TextField, inFlight } from "./form";
import type { FieldProps } from "./use-form-submit";

/**
 * The hint under the city field (round 26 #12): it asks for the part that
 * tells one Portland from another, and says nothing is used unseen.
 */
export const CITY_HINT =
  "Add the state or country. We'll show you the place we found before we use it.";

/**
 * The lookup itself failed — the `NOT FOUND YET` band (round 26 #12):
 * *"That band means the service failed. The field message means the city
 * doesn't exist, and that's the difference between them."*
 */
const LOOKUP_FAILED = {
  kicker: "Not found yet",
  message: "Couldn't look that up.",
};

type LookUp = (input: { data: { label: string } }) => Promise<CityLookup>;

/**
 * The typed city, found and confirmed before it is used (round 26 #12):
 * the field and **Find** beside it; Find shows the provider's one answer
 * as "Weather for {resolved}" with **Use this**; nothing is saved until
 * Use this. The same field on O1 and on Your conditions, which is why it
 * lives in `ui/`: what Use this *does* is the caller's (`onUse`) — O1 makes
 * it the chip, Your conditions saves it.
 *
 * **Enter means Find, never the surrounding form's submit.** On O1 the
 * field sits inside the calibration form, whose submit is Next; a runner
 * pressing Enter in the city field is asking where the city is.
 *
 * The field's own messages — nothing typed, a place that does not exist —
 * are field messages, because the fix is in the field. A lookup that
 * failed is the band, because it is not. A message the caller holds
 * (O1's "Press Find, or clear the field to skip.") shows when the field
 * has none of its own.
 *
 * Typing again clears what Find last said: a stale "Weather for" under a
 * name that has since changed would be Use this pointing at the wrong
 * place.
 */
export function CityFinder({
  name,
  label,
  value,
  onChange,
  field,
  error,
  lookUp,
  onUse,
  using = false,
  announce,
}: Readonly<{
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
  The surrounding form's `field`, so its read-only state applies and
  typing clears its message. Absent where there is no form around the
  field — Your conditions, where Find and Use this are the only actions.
  */
  field?: ((name: string) => FieldProps) | undefined;
  error?: string | undefined;
  lookUp: LookUp;
  onUse: (place: ResolvedPlace) => void;
  /**
  Use this is in flight — the caller's save, where there is one.
  */
  using?: boolean | undefined;
  /**
  The screen's one status region (Accessibility Contract rule 08).
  */
  announce: (status: string) => void;
}>): JSX.Element {
  const [isFinding, setIsFinding] = useState(false);
  const [found, setFound] = useState<ResolvedPlace>();
  const [message, setMessage] = useState<string>();
  const [hasFailed, setHasFailed] = useState(false);

  /**
  A field message, said in the status region too — it is the answer.
  */
  function say(sentence: string): void {
    setMessage(sentence);
    announce(sentence);
  }

  /**
  The lookup failed: the band, and the same words in the status region.
  */
  function fail(): void {
    setHasFailed(true);
    announce(`${LOOKUP_FAILED.kicker}. ${LOOKUP_FAILED.message}`);
  }

  async function find(): Promise<void> {
    if (isFinding) return;
    setFound(undefined);
    setMessage(undefined);
    setHasFailed(false);
    const parsed = cityLookupInput.safeParse({ label: value });
    if (!parsed.success) {
      // One field, so one issue: the schema's own sentence for it.
      for (const issue of parsed.error.issues) say(issue.message);
      return;
    }
    setIsFinding(true);
    let answer: CityLookup;
    try {
      answer = await lookUp({ data: parsed.data });
    } catch {
      // A request that never came back is the same fact as a provider
      // that failed: nothing was looked up, and Try again is the way on.
      setIsFinding(false);
      fail();
      return;
    }
    setIsFinding(false);
    if (answer.kind === "found") {
      const place = {
        address: answer.address,
        lat: answer.lat,
        lng: answer.lng,
      };
      setFound(place);
      announce(`Weather for ${place.address}.`);
    } else if (answer.kind === "not-found") {
      say(cityNotFound(parsed.data.label));
    } else {
      fail();
    }
  }

  const surrounding = field?.(name);
  const shown = message ?? error;
  const own = (): FieldProps => ({
    name,
    readOnly: (surrounding?.readOnly ?? false) || isFinding,
    "aria-invalid": shown === undefined ? undefined : true,
    "aria-describedby": shown === undefined ? undefined : `${name}-message`,
    onInput: () => {
      surrounding?.onInput();
      setMessage(undefined);
      setFound(undefined);
    },
  });

  return (
    <div data-part="city-finder" className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        {/* The field is the only control inside this box, so any Enter
            that reaches it came from the field. */}
        <div
          className="flex-1"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void find();
          }}
        >
          <TextField
            name={name}
            label={label}
            value={value}
            onChange={onChange}
            field={own}
            error={shown}
            hint={CITY_HINT}
            autoComplete="address-level2"
          />
        </div>
        <button
          type="button"
          data-part="find"
          {...inFlight(isFinding)}
          onClick={() => {
            void find();
          }}
          className="target mt-6 cursor-pointer rounded-pill border border-ink bg-transparent px-5 py-3 text-body font-bold text-ink"
        >
          <PendingLabel
            label="Find"
            pendingLabel="Finding"
            pending={isFinding}
          />
        </button>
      </div>
      {found === undefined ? undefined : (
        <div
          data-part="resolved"
          className="flex flex-col gap-3 rounded-card border border-hairline bg-ground p-4"
        >
          <p className="m-0 text-body">
            Weather for <strong>{found.address}</strong>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-part="use-this"
              {...inFlight(using)}
              onClick={() => {
                onUse(found);
              }}
              className="target cursor-pointer rounded-pill border-none bg-ink px-5 py-3 text-body font-bold text-ground"
            >
              <PendingLabel
                label="Use this"
                pendingLabel="Saving"
                pending={using}
              />
            </button>
            <span className="text-small text-quiet">
              Not it? Add more to the name.
            </span>
          </div>
        </div>
      )}
      {hasFailed ? (
        <FailureBand
          kicker={LOOKUP_FAILED.kicker}
          message={LOOKUP_FAILED.message}
          onRetry={() => {
            void find();
          }}
        />
      ) : undefined}
    </div>
  );
}
