import { createContext, useContext } from "react";
import type { JSX, ReactNode } from "react";

/**
 * The bell `Layout` was given, for the screen to seat on the phone.
 *
 * A context rather than a prop, because the seat is inside the screen and
 * the bell is the shell's: `Layout` holds it (it came from
 * `modules/notifications`, which `ui/` may not import), and the screen's
 * first row is several components down. Undefined outside a belled
 * `Layout`, which is where `PhoneBell` draws nothing.
 */
const BellContext = createContext<ReactNode>(undefined);

export const BellProvider = BellContext.Provider;

/**
 * Design 169.1: on the phone the bell is the last thing on the screen's
 * own first row — right of the title and after any title action, or on a
 * sub-page in the back link's row — in a 44 target 12 from the right
 * edge. The empty row it used to have above the screen is gone.
 *
 * `-mr-3` is the 12: the screen's gutter is 24, so the target reaches half
 * into it and the glyph, centred in the target, ends on the gutter like
 * every line below it. From 720 up the bell lives only in the top bar's
 * fixed slot (169.2), so this seat is `wide:hidden`.
 *
 * `Page` seats it for every screen with a title or a back link. A screen
 * that draws its own first row puts one at that row's end.
 */
export function PhoneBell(): JSX.Element | undefined {
  const bell = useContext(BellContext);
  if (bell === undefined) return undefined;
  return (
    <div
      data-slot="notification-bell"
      className="-mr-3 flex shrink-0 wide:hidden"
    >
      {bell}
    </div>
  );
}
