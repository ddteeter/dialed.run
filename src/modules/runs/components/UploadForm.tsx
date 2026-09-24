import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { FileWell, FlowStep, LOG_FLOW } from "../../../ui";

/**
 * The upload action, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires the server function and this renders. The shape is
 * the server function's own, so the route passes it with no wrapper.
 */
export interface UploadFormProps {
  upload: (input: { data: FormData }) => Promise<{ importId: string }>;
}

export function UploadForm({ upload }: Readonly<UploadFormProps>) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | undefined>();
  const [isUploading, setIsUploading] = useState(false);

  async function onChange(files: FileList | null) {
    // Equivalent mutant on the optional index: a `change` from a file
    // input always carries a `FileList`, empty when the picker was
    // dismissed. The `?.` is the compiler's, because the DOM types the
    // property as nullable for inputs that are not files at all.
    // Stryker disable next-line OptionalChaining
    const file = files?.[0];
    if (file === undefined) return;
    // The guard the `disabled` attribute used to be. `aria-disabled` on an
    // input does not stop the picker opening (rule 07 keeps it reachable
    // on purpose), so a second file chosen mid-upload has to die here.
    if (isUploading) return;
    setError(undefined);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const { importId } = await upload({ data: formData });
      await navigate({ to: "/runs/import/$importId", params: { importId } });
    } catch {
      setError("That didn't upload. Try again.");
    } finally {
      setIsUploading(false);
    }
  }

  // The ring is on the label, not the input. `sr-only` clips the input to
  // a 1px corner, so an outline on it is invisible — tabbing to this
  // control used to show nothing at all, which is rule 06's "never
  // removed" failing by construction rather than by an `outline-none`.
  //
  // The rest label and hint are A1's board as of round 19: "Drop a file,
  // or browse" / "From your watch export or any tracking app." They were
  // round 13's "Drop a .FIT, .gpx, or .tcx file" / "up to 25 MB" — which
  // the current board supersedes, and copy is the artboard's domain. The
  // board carries the accepted formats in a caption above the well; that
  // caption is A1's composition work in the 2026-09-22 reconciliation
  // report. The in-flight label "[ Reading ]" is unchanged. The well itself is
  // `ui/FileWell` — one pattern, shared with F's photo well, which the
  // clone detector insisted on once the two became identical. Its
  // `error` prop carries the failure line, so the paragraph that used to
  // sit beside this call is the well's, not this step's.
  return (
    <FlowStep step={LOG_FLOW.intake}>
      <FileWell
        part="drop-zone"
        copy={{
          kicker: "GPX / TCX / FIT",
          label: "Drop a file, or browse",
          overLabel: "Let go to read it",
          pendingLabel: "Reading",
          hint: "From your watch export or any tracking app.",
        }}
        pending={isUploading}
        accept=".fit,.gpx,.tcx"
        error={error}
        onFiles={(files) => {
          void onChange(files);
        }}
      />
    </FlowStep>
  );
}
