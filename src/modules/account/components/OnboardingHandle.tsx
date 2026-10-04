import type { JSX } from "react";

import {
  ControlFailureBand,
  PendingLabel,
  inFlight,
  useControlAction,
} from "../../../ui";
import { HANDLE_COPY } from "../handle-copy";
import type { HandleClaim, RenameNotice } from "../username";
import { HandleForm } from "./HandleForm";
import { HandleStep } from "./HandleStep";

/**
 * "Keep @runner_4821 for now" (round 27 #16): the re-pick is dismissed and
 * the placeholder stays; Settings › Username works as usual afterwards. A
 * control outside the form, so `useControlAction`'s pending label and
 * band.
 */
function KeepPlaceholder({
  current,
  keep,
  onKept,
}: Readonly<{
  current: string;
  keep: () => Promise<unknown>;
  onKept: () => void;
}>): JSX.Element {
  const keeping = useControlAction<[]>({
    kicker: "Not kept",
    action: keep,
    onSuccess: onKept,
  });
  return (
    <div className="flex flex-col gap-4">
      <ControlFailureBand
        failure={keeping.failure}
        onRetry={keeping.retry}
        retryRef={keeping.retryRef}
      />
      <button
        type="button"
        {...inFlight(keeping.pending)}
        onClick={() => {
          void keeping.run();
        }}
        className="target cursor-pointer self-center border-none bg-transparent p-0 text-body font-semibold text-ink underline underline-offset-4"
      >
        <PendingLabel
          label={`Keep @${current} for now`}
          pendingLabel="Keeping"
          pending={keeping.pending}
        />
      </button>
    </div>
  );
}

/**
 * O0 at `/onboarding/handle` (round 26 #7), in one of its two forms: the
 * first pick, which goes on to O1; or, with a `notice`, the re-pick a
 * moderator's rename owes (ACC-12; round 27 #16) — Save username or Keep
 * the placeholder, either of which ends it, then home.
 */
export function OnboardingHandle({
  notice,
  claim,
  keep,
  onFirstHandle,
  onRepicked,
}: Readonly<{
  notice: RenameNotice | undefined;
  claim: (input: { data: { username: string } }) => Promise<HandleClaim>;
  keep: () => Promise<unknown>;
  /**
  After the first pick: on to O1.
  */
  onFirstHandle: () => void;
  /**
  After Save username or Keep: home.
  */
  onRepicked: () => void;
}>): JSX.Element {
  return (
    <HandleStep notice={notice}>
      {notice === undefined ? (
        <HandleForm
          claim={claim}
          submitLabel="Next"
          pendingLabel="Checking"
          successMessage="Handle saved."
          onClaimed={onFirstHandle}
        />
      ) : (
        <>
          <HandleForm
            claim={claim}
            hint={HANDLE_COPY.repickHint}
            submitLabel="Save username"
            pendingLabel="Saving"
            successMessage="Username saved."
            onClaimed={onRepicked}
          />
          <KeepPlaceholder
            current={notice.current}
            keep={keep}
            onKept={onRepicked}
          />
        </>
      )}
    </HandleStep>
  );
}
