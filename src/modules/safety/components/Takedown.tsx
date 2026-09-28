import { useState } from "react";
import type { JSX } from "react";

import {
  ChoiceField,
  NO_CHOICE,
  SubmitButton,
  TextField,
  useFormSubmit,
} from "../../../ui";
import { takedownInput } from "../inputs";
import { DeskForm } from "./DeskForm";

type Subject = "entry" | "photo";

type TakeDown = (input: {
  data: { subjectType: Subject; subjectId: string; notice: string };
}) => Promise<{ outcome: "removed" | "not_found" }>;

const SUBJECT_LABELS: Readonly<Record<Subject, string>> = {
  photo: "A photo",
  entry: "A whole entry",
};

/**
What the operator is told once the Desk has answered.
*/
export function takedownMessage(outcome: "removed" | "not_found"): string {
  return outcome === "removed"
    ? "Taken down. The runner has been told, and the notice is on record."
    : "Nothing has that id. Check it against the notice.";
}

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
        action={
          <SubmitButton
            label="Take it down"
            pendingLabel="Taking it down"
            pending={form.pending}
          />
        }
      >
        <ChoiceField<Subject>
          name="subjectType"
          label="What it is"
          options={["photo", "entry"]}
          optionLabels={SUBJECT_LABELS}
          value={subjectType ?? NO_CHOICE}
          onChange={(picked) => {
            setSubjectType(
              takedownInput.shape.subjectType.safeParse(picked).data,
            );
          }}
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
