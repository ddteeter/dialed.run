import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";

import {
  CURRENT_PASSWORD_WRONG,
  DELETION_GRACE_S,
  DELETION_NEEDS_GOOGLE,
  currentPasswordLimited,
  accountDeletionInput,
  accountDeletionSchema,
} from "../../../lib/contracts";
import { clockLabel, deviceTimeZone, proseDayLabel } from "../../../lib/dates";
import { nowSeconds } from "../../../lib/now";
import {
  FieldMessage,
  FormFailureBand,
  FormStatus,
  Sheet,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import type { DeletionResult } from "../deletion";

/**
 * What `DeleteAccount` and its `DeleteSheet` both take: the sheet is the
 * confirm step, so every seam that reaches the server or the reauth flow is
 * theirs in common — only how the sheet opens and closes differs.
 */
interface DeleteAccountSeams {
  hasPassword: boolean;
  request: (input: {
    data: { currentPassword?: string | undefined };
  }) => Promise<DeletionResult>;
  /**
  "Continue with Google", for an account with no password (route-wired).
  */
  reauth: ReactNode;
  /**
  Where a scheduled deletion goes: signed out, to its date.
  */
  onScheduled: (purgeAfter: number) => Promise<void>;
}

/**
 * U1's last row, "Delete account" (ACC-9; round 27 #14): set apart by a
 * 2px rule, its title in the action colour, and a sheet that asks once
 * more — with the current password, or, for an account made with Google,
 * a fresh Google sign-in.
 */
export function DeleteAccount({
  hasPassword,
  request,
  reauth,
  isReturningFromGoogle,
  onScheduled,
}: Readonly<
  DeleteAccountSeams & {
    /**
    Back from that sign-in: the sheet opens again, ready to confirm.
    */
    isReturningFromGoogle: boolean;
  }
>): JSX.Element {
  const [isOpen, setIsOpen] = useState(isReturningFromGoogle);
  return (
    <section
      data-part="delete-account"
      className="flex flex-col border-t-2 border-ink pt-3"
    >
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        className="target flex cursor-pointer items-center justify-between gap-3 border-none bg-transparent p-0 py-3 text-left"
      >
        <span className="flex flex-col gap-1">
          <span className="text-body font-semibold text-action">
            Delete account
          </span>
          <span className="text-small text-muted">
            Deleted after 7 days. Log in before then to keep it.
          </span>
        </span>
        <span className="shrink-0 text-body text-ink">Delete</span>
      </button>
      {isOpen ? (
        <DeleteSheet
          hasPassword={hasPassword}
          request={request}
          reauth={reauth}
          onScheduled={onScheduled}
          onClose={() => {
            setIsOpen(false);
          }}
        />
      ) : undefined}
    </section>
  );
}

/**
 * A refusal the server gave, where `useFormSubmit` lands a field's issue
 * — as ChangeEmail does. Two fields can be refused: the current password,
 * and for an account with none the Google sign-in that stands in for it
 * (`REAUTH`). Either way the submission is over and nothing was
 * scheduled, so the status says "Nothing saved", never "scheduled".
 */
class Refused extends Error {
  readonly issues: readonly { path: string[]; message: string }[];
  constructor(field: string, message: string) {
    super(message);
    this.issues = [{ path: [field], message }];
  }
}

/**
 * The "field" a Google-only account proves itself with: the group that
 * holds "Continue with Google" (round 27 #14: "the field is replaced by
 * 'Continue with Google'"). Named, so the refusal focuses it.
 */
const REAUTH = "reauth";

function DeleteSheet({
  hasPassword,
  request,
  reauth,
  onScheduled,
  onClose,
}: Readonly<
  DeleteAccountSeams & {
    onClose: () => void;
  }
>): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [keep, setKeep] = useState<HTMLButtonElement | undefined>();
  // In UTC, as every other place that names this day does (`deletion.ts`'
  // `deletionDay`): the sheet and the email must not name different days.
  const day = proseDayLabel(nowSeconds() + DELETION_GRACE_S);
  const form = useFormSubmit({
    // An account with no password sends none; the field is asked for
    // only of one that has one.
    schema: hasPassword ? accountDeletionSchema : accountDeletionInput,
    action: async (values) => {
      const result = await request({ data: values });
      if (result.status === "wrong-password") {
        throw new Refused("currentPassword", CURRENT_PASSWORD_WRONG);
      }
      if (result.status === "password-limited") {
        const clock = clockLabel(result.until, deviceTimeZone());
        throw new Refused("currentPassword", currentPasswordLimited(clock));
      }
      if (result.status === "reauth") {
        throw new Refused(REAUTH, DELETION_NEEDS_GOOGLE);
      }
      return result;
    },
    successMessage: "Deletion scheduled.",
    onSuccess: async (result) => {
      await onScheduled(result.purgeAfter);
    },
  });

  // "Keep it" is focused, as every destructive confirm's safe answer is
  // (ConfirmSheet's pattern: state, so this runs once the button exists).
  useEffect(() => {
    keep?.focus();
  }, [keep]);

  return (
    <Sheet open onClose={onClose} label="Delete your account?">
      <form
        ref={form.formRef}
        noValidate
        data-part="sheet"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit(hasPassword ? { currentPassword } : {});
        }}
      >
        <FormStatus>{form.status}</FormStatus>
        <h2 className="m-0 font-display text-heading">Delete your account?</h2>
        <p className="m-0 text-body text-quiet">
          Your runs, closet, entries and photos go in 7 days. Shared runs leave
          the feed now. Log in before {day} to keep everything.
        </p>
        {hasPassword ? (
          <TextField
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            field={form.field}
            error={form.fieldErrors.currentPassword}
          />
        ) : undefined}
        {form.fieldErrors[REAUTH] === undefined ? undefined : (
          // A group, not a control: `tabIndex` lets the refusal's focus
          // land on it, with its message and the Google button inside.
          <fieldset
            name={REAUTH}
            tabIndex={-1}
            data-state="reauth"
            aria-describedby={`${REAUTH}-message`}
            className="m-0 flex flex-col gap-3 border-0 p-0"
          >
            <FieldMessage name={REAUTH} error={form.fieldErrors[REAUTH]} />
            {reauth}
          </fieldset>
        )}
        <FormFailureBand
          failure={form.failure}
          onRetry={form.retry}
          retryRef={form.retryRef}
        />
        <SubmitButton
          label="Delete my account"
          pendingLabel="Deleting"
          pending={form.pending}
        />
        <button
          type="button"
          ref={(node) => {
            setKeep(node ?? undefined);
          }}
          onClick={onClose}
          className="target w-full cursor-pointer rounded-pill border border-hairline bg-transparent px-4 py-4 text-lead font-semibold text-ink"
        >
          Keep it
        </button>
      </form>
    </Sheet>
  );
}
