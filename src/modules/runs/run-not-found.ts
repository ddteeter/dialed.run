/**
 * Round 55 · 185: a run that isn't there is named, in the column of the
 * page it replaces (run detail's, MEASURE.column), and the way out is the
 * runs list rather than the feed. X1 (`NotFoundState`) draws it; the route
 * hands it this, since a module reaches auth only through its index, which
 * reads the environment.
 */
export const RUN_NOT_FOUND = {
  sentence: "That run isn't in your runs. It may have been deleted.",
  to: "/runs",
  label: "Go to your runs",
  width: "column",
} as const;
