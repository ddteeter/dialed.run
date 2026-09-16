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
  // No `authorId !== undefined` in front of this. `viewerId` is known
  // defined by the line above, so an absent author can never equal it —
  // the extra check was a condition no input could make false on its own.
  if (subject.authorId === viewerId) return undefined;

  function close(): void {
    setIsOpen(false);
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
        // One closer for both. `ReportSheet` calls `onFiled` and then
        // `onClose` on success, and this component has nothing to do with
        // the report once it has gone — so two handlers here were two
        // spellings of "shut the sheet", the second of which nothing
        // could observe. A screen that wants to refresh after a report
        // takes that up with `ReportSheet` directly.
        onClose={close}
        subject={subject}
        // A block needs somebody to block. An entry report names the
        // entry, not its author, so the checkbox is offered only where
        // the subject IS a person — the same rule `fileReport` enforces
        // on the write side.
        canBlock={subject.type === "profile" && subject.authorId !== undefined}
        fileReport={fileReport}
        onFiled={close}
      />
    </>
  );
}
