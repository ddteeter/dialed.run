import { useState } from "react";
import type { JSX, ReactNode } from "react";

import type { z } from "zod";

import { isoDayOf } from "../../../lib/contracts/age";
import { monthDayLabel } from "../../../lib/dates";
import { nowSeconds } from "../../../lib/now";
import {
  Bracketed,
  FormStatus,
  ListSection,
  Mono,
  TextField,
  useFormSubmit,
} from "../../../ui";
import type {
  CaseOverOutcome,
  CopyrightHoldSummary,
  CounterNoticeOutcome,
  CourtActionOutcome,
} from "../copyright-holds";
import {
  copyrightHoldInput,
  counterNoticeInputFor,
  RECEIVED_ON_COPY,
} from "../inputs";
import { DeskForm } from "./DeskForm";
import { useSettled } from "./use-settled";

type HoldAct<R, V = { holdId: string }> = (input: { data: V }) => Promise<R>;

/**
The Desk's four actions on a hold, each a server function the route wires.
*/
interface HoldActs {
  readonly counterNotice: HoldAct<
    CounterNoticeOutcome,
    { holdId: string; receivedOn: string }
  >;
  readonly courtAction: HoldAct<CourtActionOutcome>;
  readonly caseOverDelete: HoldAct<CaseOverOutcome>;
  readonly caseOverRestore: HoldAct<CaseOverOutcome>;
}

/**
 * Review's copyright holds (D-130, design 149; round 39 #73): what a
 * copyright takedown is keeping hidden, soonest deletion first, with the
 * runner's strikes and the notice it answered. "Counter-notice received"
 * takes RECEIVED ON, the day it arrived, and records the day the material
 * comes back; once it is recorded, "Court action filed" cancels that and
 * holds it until the case ends (D-146), when "Case over: delete" or "Case
 * over: restore" settles it, each confirmed in place since neither can be
 * undone. A settled row leaves the list, and the list says what it did.
 */
export function CopyrightHolds({
  holds,
  ...acts
}: Readonly<{ holds: readonly CopyrightHoldSummary[] } & HoldActs>):
  JSX.Element | undefined {
  const { remaining, settle } = useSettled(holds, (hold) => hold.id);
  // What a settled row answered: the row has gone, so the list says it.
  const [said, setSaid] = useState("");
  if (holds.length === 0) return undefined;
  return (
    <div data-part="copyright-holds" className="flex flex-col gap-2">
      <FormStatus>{said}</FormStatus>
      {said === "" ? undefined : (
        <p data-part="holds-said" className="m-0 text-body">
          {said}
        </p>
      )}
      <ListSection
        title={`Copyright holds · ${String(remaining.length)}`}
        items={remaining}
      >
        {(hold) => (
          <HoldRow
            key={hold.id}
            hold={hold}
            onSettled={(sentence) => {
              setSaid(sentence);
              settle(hold.id);
            }}
            {...acts}
          />
        )}
      </ListSection>
    </div>
  );
}

/**
Where the hold stands, in a line: what the sweep will do, and when.
*/
export function holdState(hold: CopyrightHoldSummary): string {
  if (hold.courtActionAt !== null) {
    return `court action ${monthDayLabel(hold.courtActionAt)}: held until the case is over`;
  }
  if (hold.restoreAt !== null) {
    return `counter-notice received: back ${monthDayLabel(hold.restoreAt)}`;
  }
  return `no counter-notice: deleted ${monthDayLabel(hold.purgeAt)}`;
}

const COUNTER_NOTICE: Readonly<
  Record<CounterNoticeOutcome["outcome"], string>
> = {
  recorded: "Counter-notice recorded.",
  already: "A counter-notice is already recorded.",
  before_hidden: RECEIVED_ON_COPY.beforeHidden,
  gone: "This hold is settled: put back or deleted.",
};

const COURT_ACTION: Readonly<Record<CourtActionOutcome["outcome"], string>> = {
  recorded: "Court action recorded. It stays hidden until the case is over.",
  already: "A court action is already recorded.",
  no_counter_notice: "Record the counter-notice first.",
  gone: "This hold is settled: put back or deleted.",
};

/**
 * Each end of a case: its press, the confirm that replaces the pair
 * (round 39 #73), the confirm's button, and what it answers.
 */
const CASE_OVER = {
  delete: {
    press: "Case over: delete",
    confirm: "Delete it for good? It can't be put back.",
    yes: "Delete it",
    sentences: {
      recorded: "Case over. It is deleted.",
      not_held: "Record the court action first.",
      gone: "This hold is settled: put back or deleted.",
    },
  },
  restore: {
    press: "Case over: restore",
    confirm: "Put it back where it was?",
    yes: "Put it back",
    sentences: {
      recorded: "Case over. It is back.",
      not_held: "Record the court action first.",
      gone: "This hold is settled: put back or deleted.",
    },
  },
} as const satisfies Record<
  string,
  {
    press: string;
    confirm: string;
    yes: string;
    sentences: Readonly<Record<CaseOverOutcome["outcome"], string>>;
  }
>;

type CaseEnd = keyof typeof CASE_OVER;

const CASE_ENDS: readonly CaseEnd[] = ["delete", "restore"];

/**
A press that asks before it acts: as the Desk's submit, but it submits nothing.
*/
const PRESS_CLASS =
  "target grid min-h-13 cursor-pointer place-items-center rounded-card border-none bg-action px-6 py-4 font-display text-body uppercase text-ink";

/**
The confirm's way out, quieter than the press it answers.
*/
const NOT_YET_CLASS =
  "target grid min-h-13 cursor-pointer place-items-center rounded-card border border-hairline bg-transparent px-6 py-4 text-body font-semibold text-ink";

function HoldRow({
  hold,
  onSettled,
  counterNotice,
  courtAction,
  caseOverDelete,
  caseOverRestore,
}: Readonly<
  {
    hold: CopyrightHoldSummary;
    onSettled: (sentence: string) => void;
  } & HoldActs
>): JSX.Element {
  // The row as the last action left it, so a recording shows at once.
  const [held, setHeld] = useState(hold);
  const [said, setSaid] = useState("");
  const recorded = (result: object): void => {
    setHeld({ ...held, ...result });
  };
  return (
    <li
      data-part="copyright-hold"
      className="flex flex-col gap-3 border-b border-hairline py-4"
    >
      <HoldFacts held={held} />
      {nextAction(held, {
        counter: (
          <CounterNotice
            held={held}
            act={counterNotice}
            onRecorded={recorded}
            onSaid={setSaid}
          />
        ),
        court: (
          <HoldAction
            values={{ holdId: held.id }}
            schema={copyrightHoldInput}
            label="Court action filed"
            sentences={COURT_ACTION}
            act={courtAction}
            onRecorded={recorded}
            onSaid={setSaid}
          />
        ),
        caseOver: (
          <CaseOver
            holdId={held.id}
            acts={{ delete: caseOverDelete, restore: caseOverRestore }}
            onSettled={onSettled}
            onSaid={setSaid}
          />
        ),
      })}
      {said === "" ? undefined : (
        <p data-part="hold-said" className="text-body">
          {said}
        </p>
      )}
    </li>
  );
}

/**
What is held and why: the subject, its hide, whose it is, the notice, the clock.
*/
function HoldFacts({
  held,
}: Readonly<{ held: CopyrightHoldSummary }>): JSX.Element {
  return (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold text-ink">
          {held.subjectType} <Mono step="xs">{held.subjectId}</Mono>
        </span>
        <span data-part="hidden-at" className="text-ink uppercase">
          <Mono step="xs">Hidden {monthDayLabel(held.hiddenAt)}</Mono>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span data-part="owner" className="text-micro text-quiet">
          <Mono step="xs">
            Owner {held.ownerId} · strikes {String(held.strikes)}
          </Mono>
        </span>
        <span data-part="notice" className="text-micro text-ink">
          {held.notice}
        </span>
        <span data-part="hold-state" className="text-micro text-ink">
          <Bracketed>{holdState(held)}</Bracketed>
        </span>
      </span>
    </>
  );
}

/**
 * What a hold still takes: the counter-notice until there is one, then
 * the court action until there is one, then the two ways a case ends
 * (D-146).
 */
function nextAction(
  held: CopyrightHoldSummary,
  actions: Readonly<{
    counter: JSX.Element;
    court: JSX.Element;
    caseOver: JSX.Element;
  }>,
): JSX.Element {
  if (held.counterNoticeAt === null) return actions.counter;
  if (held.courtActionAt === null) return actions.court;
  return actions.caseOver;
}

/**
 * "Counter-notice received" with RECEIVED ON (round 39 #73): today by
 * default, by the Desk's UTC clock, and refused before the hide or after
 * today, in the schema's own words.
 */
function CounterNotice({
  held,
  act,
  onRecorded,
  onSaid,
}: Readonly<{
  held: CopyrightHoldSummary;
  act: HoldActs["counterNotice"];
  onRecorded: (result: CounterNoticeOutcome) => void;
  onSaid: (sentence: string) => void;
}>): JSX.Element {
  const [receivedOn, setReceivedOn] = useState(() => isoDayOf(nowSeconds()));
  return (
    <HoldAction
      values={{ holdId: held.id, receivedOn }}
      schema={counterNoticeInputFor(held.hiddenAt)}
      label="Counter-notice received"
      sentences={COUNTER_NOTICE}
      act={act}
      onRecorded={onRecorded}
      onSaid={onSaid}
      fields={(form) => (
        <TextField
          name="receivedOn"
          label="Received on"
          type="date"
          value={receivedOn}
          onChange={setReceivedOn}
          field={form.field}
          error={form.fieldErrors.receivedOn}
        />
      )}
    />
  );
}

/**
 * The two ends of a case, and the confirm one press puts in their place
 * (round 39 #73). Not yet puts the pair back, with focus on the press
 * that asked; the confirm's button is the form that acts.
 */
function CaseOver({
  holdId,
  acts,
  onSettled,
  onSaid,
}: Readonly<{
  holdId: string;
  acts: Readonly<Record<CaseEnd, HoldAct<CaseOverOutcome>>>;
  onSettled: (sentence: string) => void;
  onSaid: (sentence: string) => void;
}>): JSX.Element {
  const [asking, setAsking] = useState<CaseEnd | undefined>();
  // The press Not yet came back from, which takes focus when drawn.
  const [back, setBack] = useState<CaseEnd | undefined>();
  if (asking === undefined) {
    return (
      <span data-part="case-over" className="flex flex-wrap gap-4">
        {CASE_ENDS.map((end) => (
          <button
            key={end}
            ref={end === back ? focusOn : undefined}
            type="button"
            className={PRESS_CLASS}
            onClick={() => {
              setAsking(end);
            }}
          >
            {CASE_OVER[end].press}
          </button>
        ))}
      </span>
    );
  }
  const end = CASE_OVER[asking];
  return (
    <div
      role="alertdialog"
      aria-label={end.confirm}
      data-part="case-over-confirm"
      className="flex flex-col gap-3 border-t border-hairline pt-3"
    >
      <p className="m-0 text-body text-ink">{end.confirm}</p>
      <HoldAction
        values={{ holdId }}
        schema={copyrightHoldInput}
        label={end.yes}
        sentences={end.sentences}
        act={acts[asking]}
        onRecorded={() => {
          onSettled(end.sentences.recorded);
        }}
        onSaid={onSaid}
        also={
          <button
            type="button"
            className={NOT_YET_CLASS}
            onClick={() => {
              setBack(asking);
              setAsking(undefined);
            }}
          >
            Not yet
          </button>
        }
      />
    </div>
  );
}

/**
 * Focus on the press Not yet returned to (round 39 #73), as the pair is
 * drawn again: the ref is attached to that one press only.
 */
function focusOn(element: HTMLButtonElement | null): void {
  element?.focus();
}

/**
 * One Desk action on a hold: a form with the hold and any fields it
 * takes, so it fails, retries and announces as every Desk form does.
 * Whatever it answered is `said` to the row, which keeps the sentence
 * after a recording has moved the row on to its next action.
 */
function HoldAction<
  V extends { holdId: string },
  K extends string,
  R extends { readonly outcome: K | "recorded" },
>({
  values,
  schema,
  label,
  sentences,
  act,
  onRecorded,
  onSaid,
  fields,
  also,
}: Readonly<{
  values: V;
  schema: z.ZodType<V>;
  label: string;
  sentences: Readonly<Record<K | "recorded", string>>;
  act: HoldAct<R, V>;
  onRecorded: (result: R) => void;
  onSaid: (sentence: string) => void;
  fields?: (
    form: Pick<ReturnType<typeof useFormSubmit>, "field" | "fieldErrors">,
  ) => ReactNode;
  also?: ReactNode;
}>): JSX.Element {
  const form = useFormSubmit({
    carry: "page",
    schema,
    action: (submitted: V) => act({ data: submitted }),
    successMessage: sentences.recorded,
    refusal: {
      matches: (result: R) => result.outcome !== "recorded",
      answer: (result: R) => {
        onSaid(sentences[result.outcome]);
      },
    },
    onSuccess: (result: R) => {
      onSaid(sentences.recorded);
      onRecorded(result);
    },
  });
  return (
    <DeskForm
      form={form}
      className="flex flex-col gap-4"
      onSubmit={() => {
        void form.submit(values);
      }}
      submit={{ label, pendingLabel: "Recording" }}
    >
      {fields?.(form)}
      {also}
    </DeskForm>
  );
}
