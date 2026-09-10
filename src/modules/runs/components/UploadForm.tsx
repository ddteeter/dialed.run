import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

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

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-night/30 bg-white px-6 py-10 text-center">
        <span className="font-semibold text-night">
          Drop a .FIT, .gpx, or .tcx file
        </span>
        <span className="text-xs text-night/50">up to 25 MB</span>
        <input
          type="file"
          accept=".fit,.gpx,.tcx"
          disabled={isUploading}
          className="sr-only"
          onChange={(event) => {
            void onChange(event.target.files);
          }}
        />
      </label>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
    </div>
  );
}
