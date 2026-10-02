/**
 * A report waits for a confirmed address (round 26 #11; SAF-15, seam 7):
 * report is one of the things that "trusts the address".
 *
 * **Why its own file, outside the barrel.** It asks `account`'s
 * `isVerified`, and `account` reaches this module's barrel through `ops`
 * (`account` → `ops` → `ops/scheduled` → `safety`) — so a barrel file
 * importing `account` is an import cycle, which dependency-cruiser
 * refuses. Only `./functions` imports this, and nothing reaches that.
 */
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { isVerified } from "../account";
import {
  fileReport,
  type FileReportInput,
  type FileReportResult,
} from "./reports";

/**
 * A report filed, or refused because the reporter's address is not
 * confirmed yet. The refusal is an answer, not a failure: the screen opens
 * "Confirm your email first".
 */
export type FileReportOutcome =
  FileReportResult | { readonly status: "unverified" };

/**
 * Files a runner's report once their address is confirmed. The
 * distinct-reporter threshold counts accounts, and an address nobody has
 * confirmed costs nothing to make — three of them would be a takedown on
 * demand. Refused before anything is written, the block a report may
 * carry included.
 */
export async function fileConfirmedReport(
  input: FileReportInput,
): Promise<FileReportOutcome> {
  if (!(await isVerified(drizzle(env.DIALED_CORE), input.reporterId))) {
    return { status: "unverified" };
  }
  return fileReport(input);
}
