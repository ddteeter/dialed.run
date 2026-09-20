import { Link } from "@tanstack/react-router";

import { Bracketed, Mono } from "../../../ui";
import type { RunRow } from "../service";

/**
 * Normal case in the source; <Bracketed> uppercases it in CSS, so a screen
 * reader announces "Conditions attached" rather than spelling it out.
 */
function weatherBadge(run: RunRow): string {
  if (run.indoor) return "Indoor";
  switch (run.weatherStatus) {
    case "attached": {
      return "Conditions attached";
    }
    case "manual": {
      return "Manual temp";
    }
    case "failed": {
      return "Unavailable";
    }
    case "pending": {
      return "Pending";
    }
    default: {
      return "None";
    }
  }
}

export function RunList({ runs }: Readonly<{ runs: readonly RunRow[] }>) {
  if (runs.length === 0) {
    return (
      <p className="text-quiet">
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
            className="row-press flex flex-col gap-1 rounded-card border border-hairline bg-panel px-4 py-3 no-underline"
          >
            <span className="font-semibold">{run.title}</span>
            <Mono className="text-quiet">
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
