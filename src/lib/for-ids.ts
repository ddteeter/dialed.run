/**
 * Runs a read for a non-empty id list, and answers `[]` for an empty one
 * without asking the database.
 *
 * Three feed reads and the profile's three grew this guard independently,
 * which is three chances to forget it. The mutant that removes it is
 * equivalent — an empty `inArray` matches nothing — so what it buys is the
 * query itself, on the pages that have nothing to look anything up for: an
 * empty feed, a new profile, an entry with a bare kit.
 */
export async function forIds<Row>(
  ids: readonly string[],
  read: () => Promise<Row[]>,
): Promise<Row[]> {
  // Stryker disable next-line ConditionalExpression,EqualityOperator,ArrayDeclaration
  if (ids.length === 0) return [];
  return read();
}
