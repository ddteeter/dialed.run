import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Bracketed, Mono, Skeleton } from "../../../ui";
import {
  POLL_BUDGET_MS,
  hasStalledImport,
  importPollIntervalMs,
} from "../import-polling";
import type { ImportRow } from "../imports";

/**
 * The status query, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires it and this renders. The prop's shape is the server
 * function's own, so the route passes it with no wrapper.
 */
export interface ImportStatusProps {
  importId: string;
  getStatus: (input: {
    data: { importId: string };
  }) => Promise<ImportRow | undefined>;
}

function ImportStatusInner({
  importId,
  getStatus,
}: Readonly<ImportStatusProps>) {
  // A timer, not a clock read at render time.
  //
  // The stall message used to be `hasStalledImport(status, Date.now() -
  // startedWatchingAt)`, evaluated while rendering — and it could never
  // fire. react-query shares structure between polls, so an import whose
  // row stops changing produces no new data, no re-render, and nothing to
  // re-read the clock with. A stuck import is exactly the case where the
  // row stops changing, so the message was unreachable in the one
  // situation it exists for.
  const [budgetSpent, setBudgetSpent] = useState(false);
  // Two equivalent mutants in here, both about the cleanup rather than the
  // timer. React 18 no longer warns on a state update after unmount, so
  // dropping the `clearTimeout` leaves a stray timer and changes nothing
  // any test can see; and stryker's replacement dependency array is a
  // constant, so it is exactly as stable as `[]` and the effect still runs
  // once. The cleanup stays because a timer outliving its component is a
  // leak whether or not it is observable.
  // Stryker disable BlockStatement,ArrayDeclaration,CallExpression
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setBudgetSpent(true);
    }, POLL_BUDGET_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, []);
  // Stryker restore BlockStatement,ArrayDeclaration,CallExpression
  const query = useQuery({
    // Equivalent mutants on the key: this component makes its own
    // `QueryClient` (below), so nothing else ever shares the cache and no
    // two keys can collide. The shape is for readability in devtools.
    // Stryker disable next-line ArrayDeclaration,StringLiteral
    queryKey: ["runs", "import", importId],
    queryFn: async () => getStatus({ data: { importId } }),
    // 0 is returned straight through: react-query only schedules for a
    // positive number, so translating 0 into `false` was a no-op dressed
    // up as a conversion — and a branch no test could distinguish.
    refetchInterval: (q) =>
      importPollIntervalMs(q.state.data?.status, q.state.dataUpdateCount),
  });

  if (query.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }
  // Equivalent mutants on the second operand: react-query rejects an
  // `undefined` result as an error rather than as data, so a missing row
  // arrives here through `isError` and the absent-data case is never the
  // reachable one. The check stays because `data` is typed
  // `ImportRow | undefined` and this is what narrows it.
  // Stryker disable next-line LogicalOperator,ConditionalExpression
  if (query.isError || query.data === undefined) {
    return (
      <p className="text-sm font-semibold text-pink">
        We lost track of that import. Try uploading again.
      </p>
    );
  }

  const importRow = query.data;
  if (hasStalledImport(importRow.status, budgetSpent ? POLL_BUDGET_MS : 0)) {
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
  getStatus,
}: Readonly<ImportStatusProps>) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <ImportStatusInner importId={importId} getStatus={getStatus} />
    </QueryClientProvider>
  );
}
