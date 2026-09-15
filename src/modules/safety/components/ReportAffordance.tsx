import type { JSX } from "react";
import { useState } from "react";

import { ReportSheet, type ReportSubject } from "./ReportSheet";

/**
 * The "Report" control and the sheet it opens, as one thing a route can
 * hand to a screen it does not own.
 *
 * **Why this exists at all is a boundary, not a preference.** W1 belongs
 * on entries and profiles, which live in `modules/feed` — and
 * dependency-cruiser forbids one module's component deep-importing
 * another's, while the `modules/safety` barrel reaches D1 and would drag
 * drizzle into the client bundle if a component pulled it. So the route
 * composes this and passes it down as a node, and `EntryDetail` renders
 * whatever it is given without knowing what a report is.
 *
 * **The decisions live here rather than in the route**, because a route
 * may not branch (`server-functions-are-glue`) and a decision there is
 * one no test can reach. There are two: whether to offer reporting at
 * all, and whether to offer the block alongside it.
 */
export function ReportAffordance({
  subject,
  viewerId,
  fileReport,
}: Readonly<{
  subject: ReportSubject;
  /**
  Absent when signed out.
  */
  viewerId?: string | undefined;
  fileReport: Parameters<typeof ReportSheet>[0]["fileReport"];
}>): JSX.Element | undefined {
  const [isOpen, setIsOpen] = useState(false);

  // Signed out, or looking at your own: no report control. Reporting your
  // own entry does nothing, and offering it reads as a bug — while a
  // signed-out reporter has no identity for the distinct-reporter count
  // to be counted against, which is the rule the whole threshold rests on.
  if (viewerId === undefined) return undefined;
  if (subject.authorId !== undefined && subject.authorId === viewerId) {
    return undefined;
  }

  return (
    <>
      <button
        type="button"
        className="text-xs font-semibold uppercase tracking-wide text-night/60"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Report
      </button>
      <ReportSheet
        open={isOpen}
        onClose={() => {
          setIsOpen(false);
        }}
        subject={subject}
        // A block needs somebody to block. An entry report names the
        // entry, not its author, so the checkbox is offered only where
        // the subject IS a person — the same rule `fileReport` enforces
        // on the write side.
        canBlock={subject.type === "profile" && subject.authorId !== undefined}
        fileReport={fileReport}
        onFiled={() => {
          setIsOpen(false);
        }}
      />
    </>
  );
}
