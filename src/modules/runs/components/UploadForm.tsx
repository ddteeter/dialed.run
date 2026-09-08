import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { startFileImport } from "../functions";

export function UploadForm() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [isUploading, setIsUploading] = useState(false);

  async function onChange() {
    const file = inputRef.current?.files?.[0];
    if (file === undefined) return;
    setError(undefined);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const { importId } = await startFileImport({ data: formData });
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
          ref={inputRef}
          type="file"
          accept=".fit,.gpx,.tcx"
          disabled={isUploading}
          className="sr-only"
          onChange={() => {
            void onChange();
          }}
        />
      </label>
      {error === undefined ? undefined : (
        <p className="text-sm font-semibold text-pink">{error}</p>
      )}
    </div>
  );
}
