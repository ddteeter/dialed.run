import type { JSX, ReactNode } from "react";

import { Mono } from "../../../ui";
import type { RenameNotice } from "../username";

/*
 * Its own file, apart from `HandleForm.tsx`, because Settings › Username
 * renders the form under `SettingsSubPage`'s own heading — and a screen has
 * one h1 (Accessibility Contract rule 04), which `one-h1-per-route` counts
 * file by file along the imports. For the same reason O0's two heads —
 * the first pick and a moderator's re-pick — are one heading here whose
 * words change, not two components with a heading each.
 */

/**
 * Why a moderator renamed the runner, in the sentence round 27 #16 draws:
 * the fixed list's reason ("Offensive or sexual") read mid-sentence.
 */
export function renamedLine(notice: RenameNotice): string {
  const reason = `${notice.reason.charAt(0).toLowerCase()}${notice.reason.slice(1)}`;
  return `@${notice.previous} broke the rules on names: ${reason}. For now you're @${notice.current}. Your runs and closet haven't changed.`;
}

/**
 * O0's head (round 26 #7): the step kicker over the question, "STEP 1 OF
 * 4 · What should runners call you?". The page's own heading, because the
 * kicker sits above it and `Page`'s `title` has nowhere to put one.
 *
 * With a `notice`, it is the re-pick a moderator's rename owes (ACC-12;
 * round 27 #16): "USERNAME CHANGED BY A MODERATOR · Pick a new username",
 * and the sentence saying what was taken and why.
 */
export function HandleStep({
  notice,
  children,
}: Readonly<{
  notice?: RenameNotice | undefined;
  children: ReactNode;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Mono
          step="xs"
          className={notice === undefined ? "text-muted" : "text-cold-text"}
        >
          {notice === undefined
            ? "Step 1 of 4"
            : "Username changed by a moderator"}
        </Mono>
        <h1 className="m-0 font-display text-display uppercase">
          {notice === undefined
            ? "What should runners call you?"
            : "Pick a new username"}
        </h1>
      </div>
      {notice === undefined ? undefined : (
        <p className="m-0 text-body">{renamedLine(notice)}</p>
      )}
      {children}
    </div>
  );
}
