import { useState } from "react";
import type { JSX } from "react";

import { TextField, useFormSubmit } from "../../../ui";
import { takedownInput } from "../inputs";
import { DeskForm, PickOne } from "./DeskForm";

type Subject = "entry" | "photo";

type Outcome = "removed" | "already_removed" | "not_found";

type TakeDown = (input: {
  data: { subjectType: Subject; subjectId: string; notice: string };
}) => Promise<{ outcome: Outcome }>;

const SUBJECT_LABELS: Readonly<Record<Subject, string>> = {
  photo: "A photo",
  entry: "A whole entry",
};

/**
What the operator is told once the Desk has answered.
*/
export function takedownMessage(outcome: Outcome): string {
  return MESSAGES[outcome];
}

const MESSAGES: Readonly<Record<Outcome, string>> = {
  removed: "Taken down. The runner has been told, and the notice is on record.",
  already_removed: "Already taken down. Nothing more was sent or recorded.",
  not_found: "Nothing has that id. Check it against the notice.",
};

/**
 * A copyright takedown (task 128 · SAF-6; §1.2): a named photo or entry,
 * and the notice it answers. The object is deleted, the row with it, and
 * the audit row keeps who did it, what came down and the notice — the
 * record a DMCA counter-notice is answered from.
 */
export function Takedown({
  takeDown,
}: Readonly<{ takeDown: TakeDown }>): JSX.Element {
  // Nothing chosen is `undefined`, which the schema refuses with its own
  // message; the select sees it as the "—" option's value.
  const [subjectType, setSubjectType] = useState<Subject | undefined>();
  const [subjectId, setSubjectId] = useState("");
  const [notice, setNotice] = useState("");
  const [said, setSaid] = useState("");
  const form = useFormSubmit({
    schema: takedownInput,
    action: (values) => takeDown({ data: values }),
    onSuccess: ({ outcome }) => {
      setSaid(takedownMessage(outcome));
    },
    successMessage: "Takedown sent.",
    labels: {
      subjectType: "What it is",
      subjectId: "Its id",
      notice: "The notice",
    },
  });

  return (
    <section aria-labelledby="desk-takedown" className="flex flex-col gap-6">
      <h2
        id="desk-takedown"
        className="m-0 font-display text-heading uppercase"
      >
        Takedown
      </h2>
      <DeskForm
        form={form}
        className="flex flex-col gap-4"
        onSubmit={() => {
          void form.submit({ subjectType, subjectId, notice });
        }}
        submit={{ label: "Take it down", pendingLabel: "Taking it down" }}
      >
        <PickOne<Subject>
          name="subjectType"
          label="What it is"
          options={["photo", "entry"]}
          optionLabels={SUBJECT_LABELS}
          schema={takedownInput.shape.subjectType}
          value={subjectType}
          onChange={setSubjectType}
          field={form.field}
          error={form.fieldErrors.subjectType}
        />
        <TextField
          name="subjectId"
          label="Its id"
          value={subjectId}
          onChange={setSubjectId}
          field={form.field}
          error={form.fieldErrors.subjectId}
          autoComplete="off"
        />
        <TextField
          name="notice"
          label="The notice"
          value={notice}
          onChange={setNotice}
          field={form.field}
          error={form.fieldErrors.notice}
          hint="Who sent it, and its reference."
          autoComplete="off"
        />
        {said === "" ? undefined : <p className="text-body">{said}</p>}
      </DeskForm>
    </section>
  );
}
