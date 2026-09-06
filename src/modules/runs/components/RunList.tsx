import { Link } from "@tanstack/react-router";

import { Bracketed, Mono } from "../../../ui";
import type { RunRow } from "../service";

function weatherBadge(run: RunRow): string {
  if (run.indoor) return "INDOOR";
  switch (run.weatherStatus) {
    case "attached": {
      return "CONDITIONS ATTACHED";
    }
    case "manual": {
      return "MANUAL TEMP";
    }
    case "failed": {
      return "UNAVAILABLE";
    }
    case "pending": {
      return "PENDING";
    }
    default: {
      return "NONE";
    }
  }
}

export function RunList({ runs }: Readonly<{ runs: readonly RunRow[] }>) {
  if (runs.length === 0) {
    return (
      <p className="text-night/70">
        Drop in a GPX and we&rsquo;ll figure out the weather for you.
      </p>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {runs.map((run) => (
        <li key={run.id}>
          <Link
            to="/runs/$runId"
            params={{ runId: run.id }}
            className="flex flex-col gap-1 rounded-md border border-night/15 bg-white px-4 py-3 no-underline"
          >
            <span className="font-semibold text-night">{run.title}</span>
            <Mono className="text-xs text-night/60">
              <Bracketed>{weatherBadge(run)}</Bracketed>
              {" · "}
              {(run.distanceM / 1000).toFixed(2)} KM
            </Mono>
          </Link>
        </li>
      ))}
    </ul>
  );
}
