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
 * `/takedown/confirm` (design 137): every receipt's link proves its
 * request's address, and a request past the requester cap waits for it
 * before it hides anything. It asks before it confirms
 * (`ConfirmRequestPanel`). Placeholder words (design deltas).
 */
export function TakedownConfirm({
  token,
  isForAddress = false,
  confirm,
}: Readonly<{
  token: string | undefined;
  /**
  The receipt's link for a request that already acts, which proves its address and hides nothing.
  */
  isForAddress?: boolean;
  confirm: Confirm;
}>): JSX.Element {
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
        <p className="m-0 text-body">{receiptSaid(outcome, isForAddress)}</p>
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
        {isForAddress
          ? "Confirm that you asked us to remove an image at this address."
          : "Confirm that you asked us to remove an image. Then we hide it while we look."}
      </p>
    </ConfirmRequestPanel>
  );
}

/**
What the receipt says once the confirm is answered.
*/
function receiptSaid(
  outcome: TakedownConfirmResult,
  isForAddress: boolean,
): string {
  if (outcome === "decided") return "We've emailed you what we decided.";
  return isForAddress
    ? "Thanks, that's confirmed."
    : "We'll decide within 48 hours and email you either way.";
}
