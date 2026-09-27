import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { JSX } from "react";
import { useEffect, useState } from "react";

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
A new upload, under a key of its own. A retry of the same upload reuses its
attempt instead, key and all.
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
  // `gcTime: Infinity` schedules no garbage-collection timer. The default
  // leaves a five-minute one behind on every unmount, holding a cache that
  // nothing can reach once this client goes — and in the `ui` project,
  // firing into a torn-down window (see test/dom-setup.ts).
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
  );
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

/**
 * Before a file has become a run, the well is the whole screen: at the
 * desk it sits in the primary column's measure, and the rail is empty
 * (round 25: *"With no file yet, the rail is empty"*).
 */
const BEFORE_THE_RUN = "flex flex-col gap-3 desk:max-w-column";

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
  // A timer, not a clock read at render time: an import whose row stops
  // changing produces no new data and no re-render, so a stall worked out
  // while rendering could never fire — the one case it exists for. Keyed
  // on the watched object rather than its id, so a retry under the same
  // import gets twenty seconds of its own. Cleared when the runner moves
  // on or the form goes: it used to be left to fire, harmlessly in a
  // browser, but into a torn-down window in the `ui` tests.
  useEffect(() => {
    if (watching === undefined) return;
    const timer = globalThis.setTimeout(() => {
      setStalledId(watching.importId);
    }, STALL_AFTER_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [watching]);

  async function send(attempt: Attempt): Promise<void> {
    // The guard the `disabled` attribute used to be: the well stays
    // reachable while it works (rule 07), so a second file mid-send has to
    // die here.
    if (sending !== undefined) return;
    setSending(attempt);
    // A send starts its own twenty seconds: a retry of a stalled import
    // comes back to the same import, and must not arrive already stalled.
    setStalledId(undefined);
    setRefusal(undefined);
    setFailed(undefined);
    setWatching(undefined);
    try {
      const form = new FormData();
      form.set("file", attempt.file);
      form.set("idempotencyKey", attempt.key);
      const { importId } = await upload({ data: form });
      setWatching({ importId, attempt });
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
            // The same attempt, key and all (law 8b). The first import is
            // still in the queue: a new key would start a second parse of
            // the same file, and whichever landed second would come back
            // "Already logged" about the runner's own retry.
            void send(watching.attempt);
          },
          onReplace: () => {
            setWatching(undefined);
          },
        }}
      />
    );
  }

  return (
    <div className={BEFORE_THE_RUN}>
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
    </div>
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
    // Answers and failures both count against the budget: a poll that
    // errors is still a poll, and the budget is what stops a tab asking
    // forever.
    refetchInterval: (query) =>
      importPollIntervalMs(
        query.state.data,
        query.state.dataUpdateCount + query.state.errorUpdateCount,
      ),
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
    <div className={BEFORE_THE_RUN}>
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
        onRetry={onResend}
      />
    </div>
  );
}
