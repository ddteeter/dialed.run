/**
 * A delete that works a large set of rows down a batch at a time, so no
 * one statement has to delete them all and each stays well inside D1's
 * time for a query.
 *
 * `pass` sends one statement that deletes at most `batch` rows and
 * answers how many it deleted. Passes run while each deletes a full
 * batch, and at most `passes` of them, so a backlog larger than that is
 * left for a later firing and the call always ends. Answers how many
 * statements it sent, for a caller sharing one bound across several
 * deletes.
 */
export async function deleteInBatches(
  pass: () => Promise<number>,
  batch: number,
  passes: number,
): Promise<number> {
  let sent = 0;
  let deleted = batch;
  while (deleted === batch && sent < passes) {
    sent += 1;
    deleted = await pass();
  }
  return sent;
}
