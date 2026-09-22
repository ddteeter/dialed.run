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
  // Design's round-13 table names this control's rest label "Drop a .FIT,
  // .gpx, or .tcx file" and its in-flight label "[ Reading ]". The drawn
  // copy is kept as the rest label, because it carries the accepted
  // formats and copy is the artboard's domain. The well itself is
  // `ui/FileWell` — one pattern, shared with F's photo well, which the
  // clone detector insisted on once the two became identical. Its
  // `error` prop carries the failure line, so the paragraph that used to
  // sit beside this call is the well's, not this step's.
  return (
    <FlowStep step={LOG_FLOW.intake}>
      <FileWell
        label="Drop a .FIT, .gpx, or .tcx file"
        pendingLabel="Reading"
        pending={isUploading}
        accept=".fit,.gpx,.tcx"
        hint={<span className="text-micro text-muted">up to 25 MB</span>}
        error={error}
        onFiles={(files) => {
          void onChange(files);
        }}
      />
    </FlowStep>
  );
}
