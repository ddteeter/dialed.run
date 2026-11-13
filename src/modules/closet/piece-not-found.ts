/**
 * Round 55 · 185: a piece that isn't there is named, in the column of the
 * page it replaces (the piece's, MEASURE.column), and the way out is the
 * closet rather than the feed. X1 (`NotFoundState`) draws it; the routes
 * hand it this, since a module reaches auth only through its index, which
 * reads the environment.
 */
export const PIECE_NOT_FOUND = {
  sentence: "That piece isn't in your closet. It may have been deleted.",
  to: "/closet",
  label: "Go to your closet",
  width: "column",
} as const;
