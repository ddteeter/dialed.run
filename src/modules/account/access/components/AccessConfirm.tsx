import type { JSX } from "react";

import {
  ConfirmRequestPanel,
  UnmatchedRequestLink,
  useConfirmRequest,
} from "../../../../ui/ConfirmRequest";
import { accessConfirmInput } from "../../inputs";
import type { AccessConfirmResult } from "../access";
import { OnTheList } from "./RequestAccess";

type Confirm = (input: {
  data: { token: string };
}) => Promise<AccessConfirmResult>;

/**
 * `/account/confirm-access` (owner, 2026-11-21): an access request's
 * confirm link, asking before it confirms (`ConfirmRequestPanel`); the
 * button's answer is Au5's "You're on the list", as the ask was placed.
 */
export function AccessConfirm({
  token,
  confirm,
}: Readonly<{ token: string | undefined; confirm: Confirm }>): JSX.Element {
  const { form, outcome } = useConfirmRequest({
    schema: accessConfirmInput,
    confirm,
    outcomeOf: (result: AccessConfirmResult) => result,
  });

  if (token === undefined || outcome?.status === "not_found") {
    return <UnmatchedRequestLink />;
  }
  if (outcome !== undefined) {
    return (
      <OnTheList
        email={outcome.email}
        isFromBlockedRegion={outcome.isFromBlockedRegion}
      />
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
        Confirm that you asked to join dialed.run. Then you&apos;re on the list.
      </p>
    </ConfirmRequestPanel>
  );
}
