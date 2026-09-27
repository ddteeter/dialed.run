import { useCallback, useState } from "react";
import type { JSX } from "react";

import { PASSWORD_MIN_LENGTH } from "../../lib/contracts";
import { FormField } from "../../ui";
import type { FieldProps } from "../../ui";

/**
 * The password field: the Form Contract's field with a Show control
 * inside the box (Au1–Au7 all draw it).
 *
 * `FormField` rather than `TextField` because the box holds two things;
 * every attribute `TextField` would have set is set here from the same
 * `field()` helper, which is the part a hand-rolled field loses.
 *
 * `focusOnArrival` is Au7's *"focus in Password"*: the email is already
 * there, so the password is the one thing left to type.
 */
export function PasswordField({
  name = "password",
  label,
  value,
  onChange,
  field,
  error,
  hint,
  autoComplete,
  focusOnArrival = false,
}: Readonly<{
  /**
   * The field's name and id: `password` everywhere but Change password,
   * which asks for the current one too (ACC-7).
   */
  name?: string | undefined;
  label: string;
  value: string;
  onChange: (value: string) => void;
  field: (name: string) => FieldProps;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete: "current-password" | "new-password";
  focusOnArrival?: boolean | undefined;
}>): JSX.Element {
  const [isShown, setIsShown] = useState(false);
  // Arrival is once. An inline callback ref here was a new function on
  // every render, so React re-ran it on every keystroke anywhere on the
  // page and pulled the cursor out of Email into Password mid-word. Held
  // stable, React calls it when the input mounts (and hands it `null` on
  // the way out) — and again only if `focusOnArrival` itself changes.
  const focusOnArrivalRef = useCallback(
    (node: HTMLInputElement | null) => {
      if (focusOnArrival) node?.focus();
    },
    [focusOnArrival],
  );

  return (
    <FormField name={name} label={label} error={error} hint={hint}>
      <input
        {...field(name)}
        ref={focusOnArrivalRef}
        id={name}
        type={isShown ? "text" : "password"}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full border-none bg-transparent"
      />
      <button
        type="button"
        aria-controls={name}
        onClick={() => {
          setIsShown((shown) => !shown);
        }}
        className="target shrink-0 cursor-pointer border-none bg-transparent p-0 text-small font-semibold text-ink"
      >
        {isShown ? "Hide" : "Show"}
      </button>
    </FormField>
  );
}

/**
 * A password being set — sign-up's floor, said as its hint (round 26 #18:
 * "At least 10 characters."). Reset and Change password both ask for one.
 */
export function NewPasswordField({
  value,
  onChange,
  field,
  error,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  field: (name: string) => FieldProps;
  error?: string | undefined;
}>): JSX.Element {
  return (
    <PasswordField
      label="New password"
      autoComplete="new-password"
      value={value}
      onChange={onChange}
      field={field}
      error={error}
      hint={`At least ${String(PASSWORD_MIN_LENGTH)} characters.`}
    />
  );
}
