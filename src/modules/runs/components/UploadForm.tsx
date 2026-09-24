import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { JSX } from "react";
import { useState } from "react";

import type { Units } from "../../../lib/contracts";
import { newUlid } from "../../../lib/ids";
import {
  classifyFailure,
  FileWell,
  FlowStep,
  FormFailureBand,
  LOG_FLOW,
} from "../../../ui";
import type { FormFailure } from "../../../ui";
import {
  STALL_AFTER_MS,
  importPollIntervalMs,
  isReading,
} from "../import-polling";
import type { ImportOutcome } from "../imports";
import { checkUpload, parseFailureSentence } from "../upload-limits";
import { DuplicateCard, ParsedCard } from "./ParsedCard";
import type { Retime } from "./ParsedCard";

/**
 * The server functions, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires the server functions and this renders. The shapes are
 * the server functions' own, so the route passes them with no wrapper.
 */
export interface UploadFormProps {
  upload: (input: { data: FormData }) => Promise<{ importId: string }>;
  getOutcome: (input: {
    data: { importId: string };
  }) => Promise<ImportOutcome | undefined>;
  retime: Retime;
  units: Units;
}

/**
 * The sentence a slow read gets (round 22): *"Our end is slow. Your file is
 * fine."* — under the form's own "Nothing saved" kicker, with Try again.
 *
 * Its kind is the classifier's, not a literal: a read our end has not
 * finished is our end's failure, which is what `classifyFailure` calls
 * anything that is neither a dropped connection nor a lost session. The
 * band reads only the sentence, so a hand-typed kind would be a value no
 * screen shows and no test could hold.
 */
const STALLED: FormFailure = {
  ...classifyFailure(undefined),
  message: "Our end is slow. Your file is fine.",
};

/**
 * A file on its way: the file, and the key its sending is retried under
 * (law 8b) — minted once per choice of file, so a retry after a dropped
 * connection is the same upload and not a second one.
 */
interface Attempt {
  file: File;
  key: string;
}

/**
A second go with the same file, as a new upload.
*/
function freshAttempt(file: File): Attempt {
  return { file, key: newUlid() };
}

/**
An upload the server accepted: the import it made, and the attempt behind it.
*/
interface Watched {
  importId: string;
  attempt: Attempt;
}

/**
 * The drop zone, in whichever of its states the step is in. One well —
 * `ui/FileWell`, shared with every photo — so only the words are A1's.
 */
function DropZone({
  filename,
  pending,
  error,
  onFiles,
}: Readonly<{
  filename: string;
  pending: boolean;
  error: string | undefined;
  onFiles: (files: FileList | null) => void;
}>): JSX.Element {
  return (
    <FileWell
      part="drop-zone"
      copy={{
        kicker: "GPX / TCX / FIT",
        label: "Drop a file, or browse",
        overLabel: "Let go to read it",
        pendingLabel: `Reading ${filename}`,
        hint: "From your watch export or any tracking app.",
      }}
      pending={pending}
      accept=".fit,.gpx,.tcx"
      error={error}
      onFiles={onFiles}
    />
  );
}

/**
 * A1 — upload and auto-conditions — **in place** (round 22: *"`/runs/
 * import/$id` goes. A1 never navigates while parsing; every outcome …
 * shows in A1"*).
 *
 * - **Pending** is the drop zone's own title, breathing: `[ Reading
 *   MORNING_RUN.GPX ]`.
 * - **Done** is the parsed card and its conditions, where the well was.
 * - **Duplicate** is a receipt in the card's place.
 * - **Parse failed** is a field failure on the well — the fix is another
 *   file — in one of three sentences; dropping a new file clears it.
 * - **Stalled** (over 20 s reading) is the form's failure band, and Try
 *   again sends the file again.
 *
 * A dropped connection while sending is the form's band too, never the
 * well's: *"A network drop during upload is a form failure on the form's
 * own band, not here — the well returns to rest."*
 */
export function UploadForm(props: Readonly<UploadFormProps>): JSX.Element {
  // TanStack Query scoped to this one polling fragment — a loader cannot
  // serve a status that changes on the server after the page renders
  // (CLAUDE.md client-state rule).
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <FlowStep step={LOG_FLOW.intake}>
        <div className="flex flex-col gap-3">
          <UploadFlow {...props} />
        </div>
      </FlowStep>
    </QueryClientProvider>
  );
}

function UploadFlow({
  upload,
  getOutcome,
  retime,
  units,
}: Readonly<UploadFormProps>): JSX.Element {
  const [sending, setSending] = useState<Attempt | undefined>();
  const [watching, setWatching] = useState<Watched | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const [failed, setFailed] = useState<
    { failure: FormFailure; attempt: Attempt } | undefined
  >();
  // The import that has been reading too long. Keyed by the import rather
  // than a flag, so a timer left over from an import the runner has moved
  // on from marks nothing: it names an import no longer on screen.
  const [stalledId, setStalledId] = useState<string | undefined>();

  async function send(attempt: Attempt): Promise<void> {
    // The guard the `disabled` attribute used to be: the well stays
    // reachable while it works (rule 07), so a second file mid-send has to
    // die here.
    if (sending !== undefined) return;
    setSending(attempt);
    setRefusal(undefined);
    setFailed(undefined);
    setWatching(undefined);
    try {
      const form = new FormData();
      form.set("file", attempt.file);
      form.set("idempotencyKey", attempt.key);
      const { importId } = await upload({ data: form });
      setWatching({ importId, attempt });
      // A timer, not a clock read at render time: an import whose row
      // stops changing produces no new data and no re-render, so a stall
      // worked out while rendering could never fire — the one case it
      // exists for. Started where the import begins rather than in an
      // effect, and never cleared: it names its import, so once the
      // runner has moved on it marks nothing.
      globalThis.setTimeout(() => {
        setStalledId(importId);
      }, STALL_AFTER_MS);
    } catch (error: unknown) {
      setFailed({ failure: classifyFailure(error), attempt });
    } finally {
      setSending(undefined);
    }
  }

  function onFiles(files: FileList | null): void {
    if (files === null) return;
    const file = files[0];
    if (file === undefined) return;
    const check = checkUpload(file);
    if (check.ok) {
      void send(freshAttempt(file));
      return;
    }
    setRefusal(check.problem);
    setWatching(undefined);
    setFailed(undefined);
  }

  if (watching !== undefined) {
    return (
      <ImportWatch
        // A new import is a new watch: its own poll, its own stall timer.
        key={watching.importId}
        watched={watching}
        isStalled={stalledId === watching.importId}
        config={{ getOutcome, retime, units }}
        actions={{
          onFiles,
          onResend: () => {
            void send(freshAttempt(watching.attempt.file));
          },
          onReplace: () => {
            setWatching(undefined);
          },
        }}
      />
    );
  }

  return (
    <>
      <DropZone
        filename={sending?.file.name ?? ""}
        pending={sending !== undefined}
        error={refusal}
        onFiles={onFiles}
      />
      {failed === undefined ? undefined : (
        <FormFailureBand
          failure={failed.failure}
          onRetry={() => {
            // The same key: a send that may have landed before the
            // connection dropped cannot become two uploads.
            void send(failed.attempt);
          }}
        />
      )}
    </>
  );
}

/**
 * The three parent-level values `ImportWatch` only ever forwards — to the
 * poll, or on to whichever card the outcome resolves to. Grouped so the
 * watch's own props name what it decides (the file, the stall, the
 * actions) apart from what it merely relays.
 */
type WatchConfig = Pick<UploadFormProps, "getOutcome" | "retime" | "units">;

/**
What the runner can do from a watched import: drop another file on the well,
send the same file again, or go back to the drop zone.
*/
interface WatchActions {
  onFiles: (files: FileList | null) => void;
  onResend: () => void;
  onReplace: () => void;
}

/**
 * One import, watched until it settles — and, when it does, the card that
 * replaces the well.
 */
function ImportWatch({
  watched,
  isStalled,
  config,
  actions,
}: Readonly<{
  watched: Watched;
  isStalled: boolean;
  config: WatchConfig;
  actions: WatchActions;
}>): JSX.Element {
  const { importId } = watched;
  const { file } = watched.attempt;
  const { getOutcome, retime, units } = config;
  const { onFiles, onResend, onReplace } = actions;
  const outcome = useQuery({
    // The import alone: the client is this form's own, so nothing else
    // shares its keys — and a new import must never be served the last
    // one's answer.
    queryKey: [importId],
    queryFn: async () => getOutcome({ data: { importId } }),
    refetchInterval: (query) =>
      importPollIntervalMs(query.state.data, query.state.dataUpdateCount),
  });
  const data = outcome.data;

  if (data?.run !== undefined && data.status === "done") {
    return (
      <ParsedCard
        filename={file.name}
        run={data.run}
        units={units}
        retime={retime}
        onRetimed={() => {
          void outcome.refetch();
        }}
        onReplace={onReplace}
      />
    );
  }
  if (data?.run !== undefined && data.status === "duplicate") {
    return (
      <DuplicateCard
        filename={file.name}
        run={data.run}
        units={units}
        onReplace={onReplace}
      />
    );
  }

  // Still reading — or a row we cannot see, which is waiting too, and
  // stalls like it.
  const isWaiting = data === undefined || isReading(data.status);
  return (
    <>
      <DropZone
        filename={file.name}
        pending={isWaiting && !isStalled}
        error={
          data?.status === "failed"
            ? parseFailureSentence(data.failureReason, file.name)
            : undefined
        }
        onFiles={onFiles}
      />
      <FormFailureBand
        failure={isWaiting && isStalled ? STALLED : undefined}
        onRetry={() => {
          // A new attempt: the first is still sitting in the queue, and
          // sending it again under its own key would only find it there.
          onResend();
        }}
      />
    </>
  );
}
