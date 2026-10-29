import { useId } from "react";
import type { JSX, Ref } from "react";

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
 * The "Public profile" switch's sub-line, on or off, naming where the
 * profile is: `app.dialed.run/@{handle}`. There is no switch without a
 * handle (round 42 #92), so there is always an address to name.
 */
export function publicProfileLine(isOn: boolean, handle: string): string {
  const address = `app.dialed.run/@${handle}`;
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
 *
 * `isJustShown` is the switch arriving after the runner picked a username
 * in the sheet (round 42 #92): the sheet and its press are gone, so focus
 * lands on the switch they unlocked rather than on the page.
 */
export function PublicProfileSwitches({
  publicProfile,
  publicCloset,
  handle,
  notice,
  isJustShown = false,
  save,
  onSaved,
}: Readonly<{
  publicProfile: boolean;
  publicCloset: boolean;
  handle: string;
  notice: string | undefined;
  isJustShown?: boolean | undefined;
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
        inputRef={isJustShown ? focusSwitch : undefined}
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
"Public profile" takes focus as it arrives; nothing as it leaves.
*/
function focusSwitch(input: HTMLInputElement | null): void {
  input?.focus();
}

/**
 * One of the group's switches and the line beneath it, which is its
 * description.
 */
function SavedSwitch(
  props: Readonly<{
    copy: SwitchCopy;
    isOn: boolean;
    isPending: boolean;
    onToggle: (isOn: boolean) => void;
    inputRef?: Ref<HTMLInputElement> | undefined;
  }>,
): JSX.Element {
  const hintId = useId();
  return (
    <div className="flex flex-col gap-2">
      <ToggleField
        inputRef={props.inputRef}
        name={props.copy.name}
        label={props.copy.label}
        field={toggleFieldProps(hintId, props.isPending)}
        isOn={props.isOn}
        onChange={props.onToggle}
      />
      <p id={hintId} className="m-0 text-small text-muted">
        {props.copy.line}
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
