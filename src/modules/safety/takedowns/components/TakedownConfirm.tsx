import type { JSX } from "react";

import {
  ConfirmRequestPanel,
  UnmatchedRequestLink,
  useConfirmRequest,
} from "../../../../ui/ConfirmRequest";
import { SignedOutReceipt } from "../../../../ui/SignedOutPanel";
import { takedownConfirmInput } from "../../inputs";
import type { TakedownConfirmResult } from "../takedown-requests";
import { ElsewhereHelp } from "../../components/ElsewhereHelp";

type Confirm = (input: {
  data: { token: string };
}) => Promise<{ outcome: TakedownConfirmResult }>;

/**
 * `/takedown/confirm` (design 137): a request past the requester cap
 * waits for this before it hides anything, asking before it confirms
 * (`ConfirmRequestPanel`). Placeholder words (design deltas).
 */
export function TakedownConfirm({
  token,
  confirm,
}: Readonly<{ token: string | undefined; confirm: Confirm }>): JSX.Element {
  const { form, outcome } = useConfirmRequest({
    schema: takedownConfirmInput,
    confirm,
    outcomeOf: (result) => result.outcome,
  });

  if (token === undefined || outcome === "not_found") {
    return <UnmatchedRequestLink />;
  }
  if (outcome !== undefined) {
    // The receipt takes the panel's title (R55·181).
    return (
      <SignedOutReceipt
        kicker="Request confirmed"
        title={
          outcome === "decided"
            ? "We've already decided"
            : "We have your request"
        }
      >
        <p className="m-0 text-body">
          {outcome === "decided"
            ? "We've emailed you what we decided."
            : "We'll decide within 48 hours and email you either way."}
        </p>
        {/* DONE only (round 41 #85): a decided request has had its
            answer, and the other sites are for one still open. */}
        {outcome === "decided" ? undefined : <ElsewhereHelp />}
      </SignedOutReceipt>
    );
  }
  return (
    <ConfirmRequestPanel
      form={form}
      onSubmit={() => {
        void form.submit({ token });
      }}
    >
      <p className="m-0 text-body">
        Confirm that you asked us to remove an image. Then we hide it while we
        look.
      </p>
    </ConfirmRequestPanel>
  );
}
