/**
 * The emailed data export's rows (task 126, ACC-10; D-79; round 27 #13):
 * asking for one, what Settings › Account says about it, the DLQ's
 * "failed", and the download the email links to. The ZIP itself is
 * `export-build.ts`'s; the hourly clean-up `export-sweep.ts`'s.
 *
 * **`data_exports.status` is the reconciliation marker** (law 8c): the row
 * is written before the queue send, a lost send leaves it `pending`, and
 * the sweep re-sends it. So nothing here retries (law 3).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import { dataExports } from "../../db/schema-core";
import {
  EXPORT_EVERY_S,
  EXPORT_LINK_TTL_S,
  exportTokenSchema,
  type ExportRowState,
} from "../../lib/contracts/data-export";
import { newUlid } from "../../lib/ids";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import type { ExportJob } from "./export-queue";

type Db = ReturnType<typeof drizzle>;
type Report = (error: unknown, context: Record<string, string>) => void;
type ExportRow = typeof dataExports.$inferSelect;

/**
 * The states a build is under way in. The partial unique index
 * `data_exports_in_flight` holds a runner to one row in them.
 */
export const IN_FLIGHT = ["pending", "building"] as const;

/**
 * Where a runner's ZIPs are staged in `IMPORTS`: beside `imports/`, never
 * inside it, so nothing that cleans up run files can reach an export.
 */
export function exportPrefixFor(userId: string): string {
  return `exports/${userId}/`;
}

interface ExportKeyParts {
  readonly userId: string;
  readonly id: string;
  readonly claimId: string | null;
}

/**
 * One build's ZIP: `exports/{userId}/{exportId}/{claimId}.zip`. Keyed by
 * the claim, so two builds of one export never write the same object, and
 * a build whose claim was taken over deletes only what it wrote. A row
 * never claimed has no ZIP, and says so.
 */
export function exportKeyFor(
  row: ExportKeyParts & { readonly claimId: string },
): string;
export function exportKeyFor(row: ExportKeyParts): string | undefined;
export function exportKeyFor(row: ExportKeyParts): string | undefined {
  if (row.claimId === null) return undefined;
  return `${exportPrefixFor(row.userId)}${row.id}/${row.claimId}.zip`;
}

/**
128 random bits, as the lower-case hex `exportTokenSchema` reads.
*/
export function newLinkToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function latestExport(
  db: Db,
  userId: string,
): Promise<ExportRow | undefined> {
  const [latest] = await db
    .select()
    .from(dataExports)
    .where(eq(dataExports.userId, userId))
    .orderBy(desc(dataExports.requestedAt), desc(dataExports.id))
    .limit(1);
  return latest;
}

/**
 * Whether a new request may make an export: always after a failure, never
 * while one is in flight, and otherwise once a day has passed since the
 * last (round 27 #13, "One export a day").
 */
export function canRequest(
  latest: ExportRow | undefined,
  now: number,
): boolean {
  if (latest === undefined || latest.status === "failed") return true;
  if ((IN_FLIGHT as readonly string[]).includes(latest.status)) return false;
  return now - latest.requestedAt >= EXPORT_EVERY_S;
}

/**
 * What the row shows for the runner's latest export. A copy is offered
 * for download on the day it was asked for — the day a new one cannot be
 * — and after that the row offers a fresh one; the emailed link still
 * works until it expires.
 */
export function rowState(
  latest: ExportRow | undefined,
  now: number,
): ExportRowState {
  if (latest === undefined) return { state: "idle" };
  if (latest.status === "failed") return { state: "failed" };
  if ((IN_FLIGHT as readonly string[]).includes(latest.status)) {
    return { state: "preparing" };
  }
  if (
    latest.status === "ready" &&
    latest.expiresAt !== null &&
    !canRequest(latest, now)
  ) {
    return {
      state: "ready",
      token: latest.linkToken,
      expiresAt: latest.expiresAt,
    };
  }
  return { state: "idle" };
}

export async function exportRowState(
  db: Db,
  userId: string,
  now: number,
): Promise<ExportRowState> {
  return rowState(await latestExport(db, userId), now);
}

/**
 * The one thing asked of `EXPORTS_QUEUE` here: the `account_export` job,
 * in `exportsQueueMessageSchema`'s shape (its wire format).
 */
export interface ExportQueue {
  readonly send: (message: Readonly<ExportJob>) => Promise<unknown>;
}

export interface ExportEffects {
  readonly queue: ExportQueue;
  readonly report: Report;
}

/**
 * "Get a copy": one export row and its queue message, or nothing new —
 * and either way, what the row shows now.
 *
 * Idempotent (law 8b): a repeat of the key answers what the first call
 * made. Two requests that race past the reads are settled by the table's
 * unique indexes (the key, and one in flight a runner), so the second
 * insert makes nothing and reads back the first's.
 */
export async function requestExport(
  db: Db,
  request: Readonly<{ userId: string; idempotencyKey: string }>,
  effects: ExportEffects,
  now: number,
): Promise<ExportRowState> {
  const { userId, idempotencyKey } = request;
  const repeat = await firstRowWhere(
    db,
    dataExports,
    and(
      eq(dataExports.userId, userId),
      eq(dataExports.idempotencyKey, idempotencyKey),
    ),
  );
  if (repeat !== undefined) return rowState(repeat, now);
  const latest = await latestExport(db, userId);
  if (!canRequest(latest, now)) return rowState(latest, now);
  const exportId = newUlid();
  const made = await db
    .insert(dataExports)
    .values({
      id: exportId,
      userId,
      idempotencyKey,
      linkToken: newLinkToken(),
      status: "pending",
      requestedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: dataExports.id });
  if (made.length === 0) return exportRowState(db, userId, now);
  // Two systems (law 8c): the row is written, and a send that fails here
  // leaves it `pending` for the hourly sweep to re-send. The runner is
  // told it is being prepared, which stays true.
  try {
    await effects.queue.send({ type: "account_export", exportId });
  } catch (error) {
    effects.report(error, { surface: "account-export-send", exportId, userId });
  }
  return { state: "preparing" };
}

/**
 * The DLQ's word, once retries are spent (law 6): the export is `failed`,
 * which the row turns into "Your export didn't work. Try again." Only from
 * a build still in flight — a redelivered dead letter for an export that
 * did finish changes nothing. Sentry gets the ids, never a file.
 */
export async function failExport(
  db: Db,
  exportId: string,
  report: Report,
): Promise<void> {
  const [failed] = await db
    .update(dataExports)
    .set({ status: "failed" })
    .where(
      and(eq(dataExports.id, exportId), inArray(dataExports.status, IN_FLIGHT)),
    )
    .returning({ userId: dataExports.userId });
  report(new Error("account export dead-lettered"), {
    surface: "account-export",
    exportId,
    userId: failed?.userId ?? "unknown",
  });
}

/**
Settings › Account, where the export row is.
*/
const ACCOUNT_PAGE = "/account/sign-in";

/**
 * Where every refused download goes: the export row, told the link is dead
 * (round 28 #15) — the same words for an expired link and someone else's,
 * so nothing about the other account shows.
 */
const DEAD_LINK_PAGE = `${ACCOUNT_PAGE}?export=expired`;

function redirectTo(location: string): Response {
  return new Response(undefined, { status: 302, headers: { location } });
}

/**
 * `GET /account/export/{token}`, the email's "Download export": the ZIP,
 * for its owner, signed in, until it expires.
 *
 * Signed out, the runner is sent to log in and then to Settings ›
 * Account, where the row offers the download — log-in's way back is a
 * client navigation, which cannot land on a file. Anything else that is
 * not their live export (a bad token, someone else's, an expired or
 * unfinished one) goes to the same row, which offers what there is.
 */
export async function exportFileResponse(
  db: Db,
  request: Readonly<{ token: string; userId: string | undefined }>,
  bucket: Pick<R2Bucket, "get">,
  now: number,
): Promise<Response> {
  if (request.userId === undefined) {
    return redirectTo(
      `/auth/login?redirect=${encodeURIComponent(ACCOUNT_PAGE)}`,
    );
  }
  const token = exportTokenSchema.safeParse(request.token);
  if (!token.success) return redirectTo(DEAD_LINK_PAGE);
  const row = await firstRowWhere(
    db,
    dataExports,
    and(
      eq(dataExports.linkToken, token.data),
      eq(dataExports.userId, request.userId),
      eq(dataExports.status, "ready"),
    ),
  );
  if (row?.expiresAt == undefined || row.expiresAt <= now) {
    return redirectTo(DEAD_LINK_PAGE);
  }
  const key = exportKeyFor(row);
  if (key === undefined) return redirectTo(DEAD_LINK_PAGE);
  const object = await bucket.get(key);
  if (object === null) return redirectTo(DEAD_LINK_PAGE);
  // The day it was made: a ready export expires a fixed time after.
  const madeAt = row.expiresAt - EXPORT_LINK_TTL_S;
  const day = new Date(madeAt * 1000).toISOString().slice(0, 10);
  return new Response(object.body, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="dialed-run-export-${day}.zip"`,
      "content-length": String(object.size),
      "cache-control": "private, no-store",
    },
  });
}
