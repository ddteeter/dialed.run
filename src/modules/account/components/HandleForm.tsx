import { useState } from "react";
import type { SyntheticEvent, JSX } from "react";

import type { CarriedForm } from "../../../lib/carried-form";
import { normalizeUsername, usernameInput } from "../../../lib/contracts";
import {
  describedByFor,
  FormField,
  FormFailureBand,
  FormStatus,
  Spoken,
  SubmitButton,
  useFormSubmit,
} from "../../../ui";
import { HANDLE_COPY, takenMessage } from "../handle-copy";
import type { HandleClaim } from "../username";

/**
 * The server's refusal, shaped the way `useFormSubmit` lands a field issue:
 * the fix is in the field, so it is the field's yellow and not the form's
 * band ("The server rule arrives through the field (§3)").
 */
class HandleTaken extends Error {
  readonly issues: readonly { path: string[]; message: string }[];

  constructor(message: string) {
    super(message);
    this.issues = [{ path: ["username"], message }];
  }
}

/**
 * The "@" drawn inside the field box, ahead of what is typed — a mark on
 * the control, never part of the value. `normalizeUsername` is what strips
 * one back out if a runner pastes it in.
 */
function AtMark(): JSX.Element {
  return (
    <span aria-hidden="true" className="shrink-0 text-body text-muted">
      @
    </span>
  );
}

/**
 * The field's hint: the rule, said in words (`HANDLE_COPY.rule`), then
 * why it matters unless this is the re-pick, which says the rule alone.
 */
function HandleHint({
  isRuleOnly,
}: Readonly<{ isRuleOnly: boolean }>): JSX.Element {
  return (
    <>
      <Spoken {...HANDLE_COPY.rule} />
      {isRuleOnly ? undefined : ` ${HANDLE_COPY.ruleReason}`}
    </>
  );
}

/**
 * The handle field and its one submit — O0 and Settings › Username are
 * this form with different words on the button (round 26 #7: "Settings ›
 * Username uses the same field and rule").
 *
 * **Checked on Next, not while typing**: the schema runs at submit, and
 * the server says taken or not only then. **Lowercased as typed**, so what
 * the runner sees is what is stored. The "@" sits in the box, before the
 * input, and is not part of the value.
 */
export function HandleForm({
  initial = "",
  isRuleOnly = false,
  claim,
  submitLabel,
  pendingLabel,
  successMessage,
  onClaimed,
  carry,
}: Readonly<{
  initial?: string | undefined;
  /**
  The re-pick's shorter hint, the rule alone; O0's and Settings' by default.
  */
  isRuleOnly?: boolean | undefined;
  claim: (input: { data: { username: string } }) => Promise<HandleClaim>;
  submitLabel: string;
  pendingLabel: string;
  successMessage: string;
  /**
   * Where the form goes next, handed the handle now held. A prop, because
   * the contract is announce-then-move.
   */
  onClaimed?: ((username: string) => void) | undefined;
  /**
   * Au7's noun, should the session lapse (D-155): Settings › Username is
   * a settings form, O0 is not one of the three and carries the page.
   */
  carry: CarriedForm;
}>): JSX.Element {
  const onSuccess =
    onClaimed ??
    (() => {
      // Settings › Username stays on its page: the status says it saved.
    });
  const [typed, setTyped] = useState(initial);
  const form = useFormSubmit({
    schema: usernameInput,
    action: async (values) => {
      const result = await claim({ data: values });
      if (result.kind === "taken") {
        throw new HandleTaken(takenMessage(result.username, result.suggestion));
      }
      return result.username;
    },
    successMessage,
    onSuccess,
    carry,
    // No summary labels: the summary appears only for two or more failing
    // fields, and this form has one (SharingForm's reasoning).
    labels: {},
  });

  /**
   * The browser's own submit is prevented and what travels is the typed,
   * lowercased handle — a named handler (rather than an inline `onSubmit`)
   * because `typed` is closed over here and nowhere else needs it.
   */
  function submitTyped(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    void form.submit({ username: typed });
  }

  const error = form.fieldErrors.username;
  const hint = <HandleHint isRuleOnly={isRuleOnly} />;
  const field = form.field("username");

  return (
    <form
      noValidate
      ref={form.formRef}
      className="flex flex-col gap-6"
      onSubmit={submitTyped}
    >
      <FormStatus>{form.status}</FormStatus>
      <FormField
        name="username"
        label={HANDLE_COPY.label}
        hint={hint}
        error={error}
      >
        <AtMark />
        <input
          {...field}
          // Its hint or its message, whichever shows: `field`'s own
          // pointer is only ever that message's id, so it is not passed on.
          aria-describedby={describedByFor("username", { hint, error })}
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(event) => {
            setTyped(normalizeUsername(event.target.value));
          }}
          className="w-full border-none bg-transparent"
        />
      </FormField>
      <FormFailureBand
        failure={form.failure}
        onRetry={form.retry}
        retryRef={form.retryRef}
      />
      <SubmitButton
        label={submitLabel}
        pendingLabel={pendingLabel}
        pending={form.pending}
      />
    </form>
  );
}
