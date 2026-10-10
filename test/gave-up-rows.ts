import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gaveUp } from "../src/db/schema-core";
import { env } from "../src/env";
import type { GaveUpKind } from "../src/lib/contracts/gave-up";

/**
 * The Desk's Gave up row for one job, as the table holds it, or undefined
 * — for the writers' tests, which assert that a job landed there (R-119).
 */
export async function gaveUpRow(kind: GaveUpKind, subjectId: string) {
  const [row] = await drizzle(env.DIALED_CORE)
    .select()
    .from(gaveUp)
    .where(and(eq(gaveUp.kind, kind), eq(gaveUp.subjectId, subjectId)));
  return row;
}
