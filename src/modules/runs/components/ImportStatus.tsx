import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Bracketed, Mono, Skeleton } from "../../../ui";
import { getImportStatusFn } from "../functions";
import { hasStalledImport, importPollIntervalMs } from "../import-polling";

function ImportStatusInner({
  importId,
}: Readonly<{
  importId: string;
}>) {
  // Fixed at mount: how long this tab has been watching, which is what the
  // stall message keys off.
  const [startedWatchingAt] = useState(() => Date.now());
  const query = useQuery({
    queryKey: ["runs", "import", importId],
    queryFn: async () => getImportStatusFn({ data: { importId } }),
    refetchInterval: (q) => {
      const delay = importPollIntervalMs(
        q.state.data?.status,
        q.state.dataUpdateCount,
      );
      return delay === 0 ? false : delay;
    },
  });

  if (query.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (query.isError || query.data === undefined) {
    return (
      <p className="text-sm font-semibold text-pink">
        We lost track of that import. Try uploading again.
      </p>
    );
  }

  const importRow = query.data;
  if (hasStalledImport(importRow.status, Date.now() - startedWatchingAt)) {
    return (
      <p className="text-sm text-night/70">
        This is taking longer than usual. We&rsquo;ll keep working on it —
        check back shortly.
      </p>
    );
  }
  switch (importRow.status) {
    case "pending":
    case "processing": {
      return (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Mono className="text-xs text-night/60">Reading your run…</Mono>
        </div>
      );
    }
    case "done": {
      return (
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-night">
            Your run is in. Add your kit next.
          </p>
          {importRow.runId === null ? undefined : (
            <Link
              to="/runs/$runId"
              params={{ runId: importRow.runId }}
              className="rounded-md bg-night px-4 py-2 text-center font-semibold text-chalk"
            >
              Open the run
            </Link>
          )}
        </div>
      );
    }
    case "duplicate": {
      return (
        <div className="flex flex-col gap-3">
          <p className="font-semibold text-night">
            Looks like you already logged this run.
          </p>
          {importRow.runId === null ? undefined : (
            <Link
              to="/runs/$runId"
              params={{ runId: importRow.runId }}
              className="rounded-md border border-night/20 px-4 py-2 text-center font-semibold text-night"
            >
              Open the existing run
            </Link>
          )}
        </div>
      );
    }
    case "failed": {
      return (
        <div className="flex flex-col gap-3">
          <Bracketed className="text-pink">Import failed</Bracketed>
          <p className="text-night/70">
            {importRow.failureReason ??
              "That file didn't parse. Try the original export from your watch."}
          </p>
          <Link
            to="/runs/new"
            className="rounded-md bg-night px-4 py-2 text-center font-semibold text-chalk"
          >
            Try another file
          </Link>
        </div>
      );
    }
  }
}

/**
TanStack Query scoped to this single polling fragment — a loader can't
serve a status that changes on the server after the page renders (CLAUDE.md
client-state rule; design doc 102, open question 2).
*/
export function ImportStatus({
  importId,
}: Readonly<{
  importId: string;
}>) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ImportStatusInner importId={importId} />
    </QueryClientProvider>
  );
}
