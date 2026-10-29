import { useState } from "react";
import type { JSX, ReactNode } from "react";

import { Icon, Sheet } from "../../../ui";

/**
 * Settings › Privacy's PUBLIC PROFILE group before the runner has a
 * handle (round 42 #92): no switch, because the address is the handle.
 * The line says so, and "Pick a username" opens the username form in a
 * sheet; once it saves, the group becomes round 41 #86b's switch.
 */
export const NO_HANDLE_LINE =
  "A public profile lives at your username. Pick one first.";

/**
 * The username form the sheet holds — `account`'s, with Settings ›
 * Username's words — built by the route, which may reach both modules.
 * `onClaimed` is handed the handle the runner now holds.
 */
export type PickUsernameForm = (
  onClaimed: (username: string) => void,
) => ReactNode;

/**
 * The line, the press and the sheet. `onClaimed` runs once the handle is
 * saved, and the sheet closes with it.
 */
export function NoHandleYet({
  pickUsername,
  onClaimed,
}: Readonly<{
  pickUsername: PickUsernameForm;
  onClaimed: (username: string) => void;
}>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const close = (): void => {
    setIsOpen(false);
  };
  return (
    <div data-part="no-handle" className="flex flex-col gap-3">
      <p className="m-0 text-body">{NO_HANDLE_LINE}</p>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setIsOpen(true);
        }}
        className="target cursor-pointer self-start rounded-pill border border-hairline bg-transparent px-5 text-body font-semibold text-ink"
      >
        Pick a username
      </button>
      <Sheet open={isOpen} onClose={close} label="Username">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="m-0 text-lead font-semibold">Username</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="target inline-flex cursor-pointer items-center justify-center border-none bg-transparent p-0 text-ink"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          {isOpen
            ? pickUsername((username) => {
                close();
                onClaimed(username);
              })
            : undefined}
        </div>
      </Sheet>
    </div>
  );
}
