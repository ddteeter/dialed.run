import { useId } from "react";
import type { JSX } from "react";

import { ControlFailureBand, ToggleField, useControlAction } from "../../../ui";
import type { PublicProfileChoice } from "../inputs";
import type { PublicProfileState } from "../public-profile";
import { toggleFieldProps } from "./TotalsSwitch";

/**
 * Settings › Privacy's PUBLIC PROFILE group (D-149; round 41 #86b), in the
 * board's words. It saves as you switch, like ANONYMOUS TOTALS, and is
 * not optimistic either (§4a): a switch keeps its saved state until the
 * save lands, and a failed save leaves it under a `Not changed` band.
 */
export const PUBLIC_PROFILE_LABEL = "Public profile";
export const SHOW_CLOSET_LABEL = "Show my closet";
export const SHOW_CLOSET_LINE =
  "Pieces in use, shoe mileage and retired pieces, on your public profile. Never notes or flags.";

/**
 * The status after turning the profile off while PUBLIC was the default:
 * the default moved to SHARED with it (D-149).
 */
export const DEFAULT_MOVED_LINE = "New runs now default to Shared.";

/**
 * Where the profile is, as the lines name it: `app.dialed.run/@{handle}`.
 * A runner who has not claimed a handle yet has no address to name, so
 * the lines say "your profile" there.
 */
function profileAddress(handle: string | undefined): string {
  return handle === undefined ? "your profile" : `app.dialed.run/@${handle}`;
}

/**
The "Public profile" switch's sub-line, on or off.
*/
export function publicProfileLine(
  isOn: boolean,
  handle: string | undefined,
): string {
  const address = profileAddress(handle);
  return isOn
    ? `Anyone can see your public runs at ${address}. No sign-in.`
    : `Off. Anyone signed out who opens ${address} sees nothing. Public runs still open from their own links.`;
}

/**
 * The two switches. "Show my closet" shows only while the profile is on;
 * its value is kept while it is hidden (the writer leaves it alone).
 *
 * Turning the profile on is seen by anyone, so the server wants a
 * confirmed address, and its refusal opens the root's "Confirm your email
 * first" with the switch as it was.
 *
 * `onSaved` hands the saved state up, because the page shows it in two
 * more places: NEW RUNS' PUBLIC row, and the default it may have moved.
 * The caller says when that happened (`notice`).
 */
export function PublicProfileSwitches({
  publicProfile,
  publicCloset,
  handle,
  notice,
  save,
  onSaved,
}: Readonly<{
  publicProfile: boolean;
  publicCloset: boolean;
  handle: string | undefined;
  notice: string | undefined;
  save: (input: { data: PublicProfileChoice }) => Promise<PublicProfileState>;
  onSaved: (state: PublicProfileState) => void;
}>): JSX.Element {
  const control = useControlAction<[PublicProfileChoice]>({
    action: async (choice) => {
      onSaved(await save({ data: choice }));
    },
    kicker: "Not changed",
  });
  return (
    <div data-part="public-profile" className="flex flex-col gap-4">
      <SavedSwitch
        copy={{
          name: "publicProfile",
          label: PUBLIC_PROFILE_LABEL,
          line: publicProfileLine(publicProfile, handle),
        }}
        isOn={publicProfile}
        isPending={control.pending}
        onToggle={(next) => {
          void control.run({ publicProfile: next });
        }}
      />
      {publicProfile ? (
        <SavedSwitch
          copy={{
            name: "publicCloset",
            label: SHOW_CLOSET_LABEL,
            line: SHOW_CLOSET_LINE,
          }}
          isOn={publicCloset}
          isPending={control.pending}
          onToggle={(next) => {
            void control.run({ publicCloset: next });
          }}
        />
      ) : undefined}
      {notice === undefined ? undefined : (
        <p className="m-0 text-small text-ink">{notice}</p>
      )}
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </div>
  );
}

/**
 * One of the group's switches and the line beneath it, which is its
 * description.
 */
function SavedSwitch({
  copy,
  isOn,
  isPending,
  onToggle,
}: Readonly<{
  copy: SwitchCopy;
  isOn: boolean;
  isPending: boolean;
  onToggle: (isOn: boolean) => void;
}>): JSX.Element {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <ToggleField
        name={copy.name}
        label={copy.label}
        field={toggleFieldProps(hintId, isPending)}
        isOn={isOn}
        onChange={onToggle}
      />
      <p id={hintId} className="m-0 text-small text-muted">
        {copy.line}
      </p>
    </div>
  );
}

/**
A switch's field name, label and the line beneath it.
*/
interface SwitchCopy {
  name: string;
  label: string;
  line: string;
}
