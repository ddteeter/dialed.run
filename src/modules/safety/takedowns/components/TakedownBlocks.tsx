import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../../lib/dates";
import {
  Bracketed,
  ListSection,
  Mono,
  QUIET_PILL,
  useFormSubmit,
  useReturnFocus,
} from "../../../../ui";
import { unblockRequesterInput } from "../../inputs";
import type { TakedownBlockListed, UnblockResult } from "../takedown-blocks";
import { ACTION_BAR, RECORD_PANEL } from "../../components/DeskForm";
import { QuestionInPlace } from "./RemovalRequests";

type Unblock = (input: {
  data: { key: string };
}) => Promise<{ outcome: UnblockResult }>;

const KIND_WORD = { email: "address", ip: "network" } as const;

/**
 * Review's Blocked section (design 137): each block Block and decline all
 * made on `/takedown`, newest first, and its Unblock. Undesigned: the
 * Desk's record rows and the removal requests' question in place. Not
 * drawn while nothing is blocked.
 */
export function TakedownBlocks({
  blocks,
  unblock,
}: Readonly<{
  blocks: readonly TakedownBlockListed[];
  unblock: Unblock;
}>): JSX.Element {
  return (
    <ListSection title="Blocked" items={blocks} hasCards>
      {(block) => <BlockRow key={block.key} block={block} unblock={unblock} />}
    </ListSection>
  );
}

/**
 * What a block is known by: an address by itself, a network by the
 * address on the request it was blocked from, when that is still kept.
 */
function blockNamed(block: TakedownBlockListed): string {
  const when = `blocked ${monthDayLabel(block.createdAt)}`;
  if (block.kind === "email") return `${block.key} · ${when}`;
  return block.address === undefined
    ? when
    : `from a request by ${block.address} · ${when}`;
}

function BlockRow({
  block,
  unblock,
}: Readonly<{ block: TakedownBlockListed; unblock: Unblock }>): JSX.Element {
  const [isAsking, setIsAsking] = useState(false);
  const [said, setSaid] = useState<string | undefined>();
  const askedFrom = useReturnFocus();
  return (
    <li data-part="takedown-block" className={RECORD_PANEL}>
      <span className="text-micro text-ink wrap-anywhere">
        <Bracketed step="xs">{KIND_WORD[block.kind]}</Bracketed>
        <Mono step="xs">{blockNamed(block)}</Mono>
      </span>
      {said !== undefined && (
        <p role="status" className="m-0 text-body">
          {said}
        </p>
      )}
      {said === undefined && isAsking && (
        <UnblockQuestion
          block={block}
          unblock={unblock}
          onAnswered={setSaid}
          onCancel={() => {
            setIsAsking(false);
            askedFrom.restore();
          }}
        />
      )}
      {!isAsking && (
        <div className={ACTION_BAR}>
          <button
            ref={askedFrom.ref}
            type="button"
            className={`target ${QUIET_PILL}`}
            onClick={() => {
              setIsAsking(true);
            }}
          >
            Unblock
          </button>
        </div>
      )}
    </li>
  );
}

/**
What Unblock's answer says, in the row's place.
*/
function unblockedSaid(result: { outcome: UnblockResult }): string {
  return result.outcome === "unblocked"
    ? "Unblocked."
    : "That block is already lifted.";
}

function UnblockQuestion({
  block,
  unblock,
  onAnswered,
  onCancel,
}: Readonly<{
  block: TakedownBlockListed;
  unblock: Unblock;
  onAnswered: (said: string) => void;
  onCancel: () => void;
}>): JSX.Element {
  const form = useFormSubmit({
    carry: "page",
    schema: unblockRequesterInput,
    action: (values) => unblock({ data: values }),
    successMessage: unblockedSaid,
    onSuccess: (result) => {
      onAnswered(unblockedSaid(result));
    },
  });
  return (
    <QuestionInPlace
      form={form}
      dataPart="unblock"
      onSubmit={() => {
        void form.submit({ key: block.key });
      }}
      answer={{
        label: "Unblock",
        pendingLabel: "Unblocking",
        onCancel,
        cancelHasFocus: true,
      }}
    >
      <p className="m-0 text-body">
        {`Unblock this ${KIND_WORD[block.kind]}? What it files next hides and alerts as usual.`}
      </p>
    </QuestionInPlace>
  );
}
