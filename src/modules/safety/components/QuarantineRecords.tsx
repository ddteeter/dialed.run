import { useState } from "react";
import type { JSX } from "react";

import { monthDayLabel } from "../../../lib/dates";
import {
  Bracketed,
  ListSection,
  Mono,
  TextField,
  useFormSubmit,
} from "../../../ui";
import { ncmecReportInput } from "../inputs";
import type { QuarantineSummary, recordNcmecReport } from "../quarantine";
import { DeskForm } from "./DeskForm";

type RecordReport = (input: {
  data: { recordId: string; reportId?: string | undefined };
}) => ReturnType<typeof recordNcmecReport>;

/**
 * The day and its year, "Sep 10 2026": the quarantine's dates sit a year
 * either side of today. No comma, as a mono label is a row of cells.
 *
 * Built here rather than in `lib/dates.ts` on purpose. That file is
 * imported across the suite, so any edit to it puts all 87 of its mutants
 * on the push gate: measured at 9.4 GB peak and 16 minutes for this one
 * helper, which OOMs the CI runner. Both halves are UTC, which is `monthDayLabel`'s default with no
 * zone and what the Desk shows.
 */
function yearDayLabel(epochSeconds: number): string {
  const year = new Date(epochSeconds * 1000).getUTCFullYear();
  return `${monthDayLabel(epochSeconds)} ${String(year)}`;
}

/**
 * Review's quarantine (C12): what is held for NCMEC, newest first, and
 * whether each has been reported. Recording the report starts the year
 * the law asks it be kept from the report (18 U.S.C. §2258A(h)(1)), so
 * the row says when it may go. Undesigned: existing parts and placeholder
 * words (design deltas).
 */
export function QuarantineRecords({
  records,
  recordReport,
}: Readonly<{
  records: readonly QuarantineSummary[];
  recordReport: RecordReport;
}>): JSX.Element | undefined {
  return (
    <ListSection
      title={`Quarantine · ${String(records.length)}`}
      items={records}
    >
      {(record) => (
        <QuarantineRow
          key={record.id}
          record={record}
          recordReport={recordReport}
        />
      )}
    </ListSection>
  );
}

function QuarantineRow({
  record,
  recordReport,
}: Readonly<{
  record: QuarantineSummary;
  recordReport: RecordReport;
}>): JSX.Element {
  // The row as the last recording left it, so a report shows at once.
  const [held, setHeld] = useState(record);
  const [isGone, setIsGone] = useState(false);
  const [reportId, setReportId] = useState(record.ncmecReportId ?? "");
  const form = useFormSubmit({
    schema: ncmecReportInput,
    action: (values) => recordReport({ data: values }),
    successMessage: "Report recorded.",
    refusal: {
      matches: (result) => result.outcome === "gone",
      answer: () => {
        setIsGone(true);
      },
    },
    // Only a recording reaches here: `gone` is answered above.
    onSuccess: (result) => {
      setHeld({ ...held, ...result });
    },
  });
  return (
    <li
      data-part="quarantine-record"
      className="flex flex-col gap-3 border-b border-hairline py-4"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-body font-semibold text-ink">
          {held.subjectType}
        </span>
        <span data-part="quarantined-at" className="text-ink uppercase">
          <Mono step="xs">Held {yearDayLabel(held.quarantinedAt)}</Mono>
        </span>
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-micro text-quiet">
          <Mono step="xs">Uploader {held.uploaderId}</Mono>
        </span>
        <span data-part="retain-until" className="text-micro text-ink">
          <Mono step="xs">Kept until {yearDayLabel(held.retainUntil)}</Mono>
        </span>
        <span data-part="ncmec" className="text-micro text-ink">
          <Bracketed>
            {held.ncmecReportedAt === null
              ? "not reported to NCMEC"
              : `reported to NCMEC ${yearDayLabel(held.ncmecReportedAt)}`}
          </Bracketed>
          {held.ncmecReportId === null ? undefined : (
            <Mono step="xs"> · {held.ncmecReportId}</Mono>
          )}
        </span>
      </span>
      {isGone ? (
        <span className="text-body">
          This record is gone: its year was up.
        </span>
      ) : (
        <DeskForm
          form={form}
          className="flex flex-col gap-4"
          onSubmit={() => {
            void form.submit({ recordId: held.id, reportId });
          }}
          submit={{
            label: "Record the NCMEC report",
            pendingLabel: "Recording",
          }}
        >
          <TextField
            name="reportId"
            label="CyberTipline report number"
            hint="Optional. Record it once the report is filed; it is then kept a year from now."
            value={reportId}
            onChange={setReportId}
            field={form.field}
            error={form.fieldErrors.reportId}
          />
        </DeskForm>
      )}
    </li>
  );
}
