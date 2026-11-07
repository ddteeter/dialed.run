import { useId, useRef, useState } from "react";
import type { JSX } from "react";

import { THEME_CHOICES } from "../lib/contracts";
import type { ThemeChoice } from "../lib/contracts";
import { applyTheme } from "../lib/browser/theme";
import { ChoiceList, FailureBand } from "./form";
import type { FieldProps } from "./use-form-submit";

/**
 * U1 › Display › Theme (R48·133, design 185).
 *
 * "Three-way segmented control, a radiogroup with arrow keys (three short
 * options, so not the 104 select): SYSTEM / LIGHT / DARK. Changes the page
 * at once and saves at once, with no Save." So the group is
 * `ChoiceList`'s three-column chips — native radios, which is where the
 * arrow keys come from — and a change puts the theme on the page before it
 * asks the server anything.
 *
 * "If saving fails, the page keeps the theme and the row's message band
 * shows 'Couldn't save. This device will keep it.'" It keeps it because
 * the device already has it (`applyTheme` cached it), so the failure is
 * about the account alone, and Try again sends the same choice.
 *
 * **Saves run one after another**, so a quick System → Dark → Light ends
 * with Light stored: two requests in flight could land in either order.
 */
export const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export const THEME_SAVE_KICKER = "Couldn't save.";
export const THEME_SAVE_MESSAGE = "This device will keep it.";

type SaveTheme = (input: { data: { theme: ThemeChoice } }) => Promise<unknown>;

/**
 * The one chain every save joins, and the latest choice's outcome. A
 * failure is only shown for the choice still on screen: an older save
 * that failed after a newer one was made says nothing about the newer.
 */
function useThemeSave(save: SaveTheme): {
  failed: boolean;
  store: (theme: ThemeChoice) => void;
} {
  const [failed, setFailed] = useState(false);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef<ThemeChoice | undefined>(undefined);
  const store = (theme: ThemeChoice): void => {
    latest.current = theme;
    const previous = chain.current;
    chain.current = (async () => {
      await previous;
      try {
        await save({ data: { theme } });
        if (latest.current === theme) setFailed(false);
      } catch {
        if (latest.current === theme) setFailed(true);
      }
    })();
  };
  return { failed, store };
}

/**
 * `field()`'s `onInput` clears a form's stale error as a person types. A
 * choice that saves at once has no form and no stale error to clear.
 */
function ignoreInput(): void {
  // Nothing to clear: the band is the save's, and the next save decides it.
}

export function ThemeSwitch({
  initial,
  save,
}: Readonly<{
  /**
  The account's choice, as the settings page loaded it.
  */
  initial: ThemeChoice;
  save: SaveTheme;
}>): JSX.Element {
  const [choice, setChoice] = useState(initial);
  const { failed, store } = useThemeSave(save);
  const bandId = useId();
  const field = (name: string): FieldProps => ({
    name,
    readOnly: false,
    "aria-invalid": undefined,
    "aria-describedby": failed ? bandId : undefined,
    onInput: ignoreInput,
  });
  return (
    <div data-part="theme-row" className="flex flex-col gap-2">
      <ChoiceList
        name="theme"
        legend="Theme"
        options={THEME_CHOICES}
        optionLabels={THEME_LABELS}
        layout="chip-grid"
        value={choice}
        field={field}
        onChange={(next) => {
          setChoice(next);
          applyTheme(next);
          store(next);
        }}
      />
      {failed ? (
        <div id={bandId}>
          <FailureBand
            kicker={THEME_SAVE_KICKER}
            message={THEME_SAVE_MESSAGE}
            part="control-failure"
            onRetry={() => {
              store(choice);
            }}
          />
        </div>
      ) : undefined}
    </div>
  );
}
