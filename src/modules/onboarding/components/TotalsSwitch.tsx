import { Link } from "@tanstack/react-router";
import { useId } from "react";
import type { JSX } from "react";

import type { CountInTotalsChoice } from "../inputs";
import { SavedSwitchRow } from "./saved-switch";

/**
 * Settings › Privacy's "Count my runs in anonymous totals" (D-108 D;
 * round 32, frames 1a and 1b, as round 38 #64 confirms and rewords them).
 *
 * - Totals count a broad climate zone derived from where a run was
 *   (D-120), so neither line says "where you ran".
 * - **The switch is U2's conditions pool too** (owner, 2026-10-12: fold U2
 *   into `count_in_totals`; round 38 retires U2's card). Off also leaves a
 *   runner's shared runs out of the in-app Same conditions block
 *   (`feed/consensus/consensus.ts`), at once, while the block still works for them —
 *   so both lines say so. One switch, one writer (`setCountInTotals`).
 */
export const TOTALS_LABEL = "Count my runs in anonymous totals";
export const TOTALS_ON =
  "Shared and private runs add their temperature, kit and verdict to the guides and reports. Shared runs also count in Same conditions, which other runners see. Never your name, notes, photos, when you ran, or anywhere more precise than a broad climate zone.";
export const TOTALS_OFF =
  "Off. Your runs leave the guides at the next rebuild, within a month. They leave Same conditions now, and it still works for you. Reports already published stay as they are.";

/**
 * An unconfirmed runner's lines (round 38 #61d). D-108 C counts confirmed
 * accounts only, so the confirmed ON line's claim would be untrue: the
 * same sentence, led by the condition, and an OFF with nothing leaving,
 * so no "next rebuild" or "now". They may still turn totals off, with no
 * confirm sheet (owner, 2026-10-11).
 */
export const TOTALS_ON_UNCONFIRMED =
  "Once you confirm your email, your runs add their temperature, kit and verdict to the guides and reports, and shared runs count in Same conditions. Never your name, notes, photos, when you ran, or anywhere more precise than a broad climate zone.";
export const TOTALS_OFF_UNCONFIRMED =
  "Off. Your runs won't count, even after you confirm your email.";

type TotalsSwitchProps = Readonly<{
  initial: boolean;
  /**
  Whether the runner's address is confirmed, which picks the lines.
  */
  isVerified: boolean;
  save: (input: { data: CountInTotalsChoice }) => Promise<unknown>;
  onSaved?: ((isCounted: boolean) => void) | undefined;
  /**
  The screen's one status region, when the screen has one (`SwitchStatus`).
  */
  onAnnounce?: ((status: string) => void) | undefined;
}>;

/**
 * The switch itself: the same `ToggleField` the sharing default uses
 * (round 32: "the switch uses the same component as Share new runs"),
 * saved on toggle with no confirm ("off is a normal choice, not a loss").
 *
 * **Not optimistic** (§4a): the box keeps its old state until the save
 * lands, and a failed save leaves it there under a `Not changed` band
 * with Try again. The sub-line follows the saved state, so it never says
 * something the server has not agreed to.
 *
 * `onSaved` tells a caller that shows the setting elsewhere — A3's
 * private line — what it now is.
 *
 * A switch at its row's right (D-185, R54·166.3), and "Saved." once the
 * save lands: into Privacy's one status region through `onAnnounce`, or
 * its own region in A3's sheet, where nothing else speaks.
 *
 * "How the guides are made" opens `/how-it-works#totals` (#523; the
 * design-deltas open queue's item 61).
 */
export function TotalsSwitch(props: TotalsSwitchProps): JSX.Element {
  const hintId = useId();
  return (
    <div data-part="totals-optout" className="flex flex-col gap-2">
      <SavedSwitchRow
        name="countInTotals"
        label={TOTALS_LABEL}
        initial={props.initial}
        describedBy={hintId}
        save={(countInTotals) => props.save({ data: { countInTotals } })}
        onSaved={props.onSaved}
        onAnnounce={props.onAnnounce}
      >
        {(isOn) => (
          <p id={hintId} className="m-0 text-small text-muted">
            {totalsLine(isOn, props.isVerified)}
          </p>
        )}
      </SavedSwitchRow>
      <Link
        to="/how-it-works"
        hash="totals"
        className="target self-start text-small text-ink underline underline-offset-4"
      >
        How the guides are made
      </Link>
    </div>
  );
}

/**
The sub-line for the saved state, in the confirmed or unconfirmed words.
*/
function totalsLine(isOn: boolean, isVerified: boolean): string {
  if (isVerified) return isOn ? TOTALS_ON : TOTALS_OFF;
  return isOn ? TOTALS_ON_UNCONFIRMED : TOTALS_OFF_UNCONFIRMED;
}
