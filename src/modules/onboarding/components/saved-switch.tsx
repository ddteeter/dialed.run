import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";

import {
  ControlFailureBand,
  FormStatus,
  ToggleField,
  useControlAction,
} from "../../../ui";
import type { ControlAction, FieldProps } from "../../../ui";

/**
 * What a switch that saves as it changes says once the save lands
 * (D-185; R54·166.3: "a 'Saved' status is announced"). The period is every
 * other status's.
 */
export const SAVED_STATUS = "Saved.";

/**
 * A settings switch's save: `useControlAction`, not optimistic (§4a), with
 * the kicker every such switch takes (`Not changed`), and a status that
 * says "Saved." on success as well as the cause on failure. The hook
 * itself only speaks on failure, since most controls (Useful, Follow)
 * show their outcome; a switch's outcome is only its own position, so it
 * is said.
 *
 * The status clears as each attempt starts, so a second save that lands
 * is announced again rather than left as the same words.
 */
export function useSavedSwitch<TArgs extends unknown[]>({
  action,
  onSuccess,
}: Readonly<{
  action: (...args: TArgs) => Promise<unknown>;
  onSuccess?: ((...args: TArgs) => void) | undefined;
}>): ControlAction<TArgs> {
  const [isSaved, setIsSaved] = useState(false);
  const control = useControlAction<TArgs>({
    action,
    kicker: "Not changed",
    onSuccess: (...args) => {
      setIsSaved(true);
      onSuccess?.(...args);
    },
  });
  return {
    ...control,
    run: (...args) => {
      setIsSaved(false);
      return control.run(...args);
    },
    status: isSaved ? SAVED_STATUS : control.status,
  };
}

/**
 * Where a switch's status goes. A screen has one status region
 * (Accessibility Contract rule 08): Privacy holds it for its form and its
 * switches together and passes `onAnnounce`, as W3's blur does
 * (`PhotoBlur`'s `onAnnounce`). A switch alone on its surface (A3's sheet,
 * Notifications) has no region above it, so it draws its own.
 */
export function SwitchStatus({
  status,
  onAnnounce,
}: Readonly<{
  status: string;
  onAnnounce: ((status: string) => void) | undefined;
}>): JSX.Element | undefined {
  useAnnounced(status, onAnnounce);
  return onAnnounce === undefined ? (
    <FormStatus>{status}</FormStatus>
  ) : undefined;
}

/**
 * Hands a status up to the screen's one region each time it changes, and
 * never as it mounts. A mount has said nothing yet, and NEW RUNS remounts
 * when the profile switch saves (it is keyed by the profile's state), so
 * forwarding its first, empty status would wipe the switch's "Saved."
 * from the region before it is heard.
 *
 * From an effect, not during render: setting the page's state while a
 * child renders is the one thing React will not have.
 */
function useAnnounced(
  status: string,
  onAnnounce: ((status: string) => void) | undefined,
): void {
  const said = useRef(status);
  useEffect(() => {
    if (status === said.current) return;
    said.current = status;
    onAnnounce?.(status);
  }, [status, onAnnounce]);
}

type SavedSwitchRowProps = Readonly<{
  name: string;
  label: string;
  initial: boolean;
  describedBy: string;
  save: (isOn: boolean) => Promise<unknown>;
  /**
  Tells a caller that shows the setting elsewhere what it now is.
  */
  onSaved?: ((isOn: boolean) => void) | undefined;
  /**
  The screen's one status region, when the screen has one.
  */
  onAnnounce?: ((status: string) => void) | undefined;
  children?: ((isOn: boolean) => ReactNode) | undefined;
}>;

/**
 * One setting that saves as it switches (D-185): its status, the switch
 * at its row's right, whatever describes it (`children`, given the saved
 * position), and `Not changed` under them when a save fails. Not
 * optimistic (§4a): the switch moves when the save lands, and the words
 * beneath follow the saved state, never one the server has not agreed to.
 *
 * `describedBy` names what describes the switch: the line `children`
 * draws (anonymous totals), or a line the caller draws above it
 * (Notifications' "when").
 */
export function SavedSwitchRow(props: SavedSwitchRowProps): JSX.Element {
  const [isOn, setIsOn] = useState(props.initial);
  // The saved value can arrive after the first render: Back to a settings
  // page draws the route's cached data, then its reload. The switch
  // follows the newer saved value rather than keeping the first one.
  const [savedInitial, setSavedInitial] = useState(props.initial);
  if (props.initial !== savedInitial) {
    setSavedInitial(props.initial);
    setIsOn(props.initial);
  }
  const control = useSavedSwitch<[boolean]>({
    action: props.save,
    onSuccess: (next) => {
      setIsOn(next);
      props.onSaved?.(next);
    },
  });
  return (
    <>
      <SwitchStatus status={control.status} onAnnounce={props.onAnnounce} />
      <ToggleField
        name={props.name}
        label={props.label}
        isSwitch
        field={toggleFieldProps(props.describedBy, control.pending)}
        isOn={isOn}
        onChange={(next) => {
          void control.run(next);
        }}
      />
      {props.children?.(isOn)}
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
    </>
  );
}

/**
 * A saved-on-toggle switch's field props: described by its sub-line,
 * read-only while its save is in flight, and never invalid — it has no
 * validation, so its input handler has nothing to clear. Every saved
 * switch shares it: `SavedSwitchRow` and the PUBLIC PROFILE pair.
 */
export function toggleFieldProps(
  hintId: string,
  isPending: boolean,
): (name: string) => FieldProps {
  return (name) => ({
    name,
    readOnly: isPending,
    "aria-invalid": undefined,
    "aria-describedby": hintId,
    onInput: noop,
  });
}

/**
 * The switch has no validation to clear: `FieldProps` asks for an input
 * handler, and a saved-on-toggle box has nothing for it to do.
 */
function noop(): void {
  // Nothing to clear.
}
