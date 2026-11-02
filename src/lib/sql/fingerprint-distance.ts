/**
 * How many bits a stored photo fingerprint is from one or more given ones,
 * as SQL (D-142, design 146): what lets a `WHERE` and a `LIMIT` apply to a
 * Hamming distance SQLite has no operator for. Shared by the takedown
 * review's copy search (`safety/photo-matches.ts`) and the upload's check
 * against removed images (`feed/photos.ts`, D-147).
 *
 * Every fingerprint given here is spelt into the SQL, so each caller
 * parses what it passes through `fingerprintSchema` first.
 */
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { HEX_DIGITS, digitDistances } from "../photo-fingerprint";

/**
 * The distance from a stored fingerprint to the nearest of the subject's.
 *
 * `min` with one argument is SQLite's aggregate, which would fold every
 * row into one; the trailing 64 — more bits than a fingerprint has, so
 * never the answer — keeps it the scalar `min` however many there are.
 */
export function nearestOf(column: SQLiteColumn, own: readonly string[]): SQL {
  const each = own.map((fingerprint) => distanceSql(column, fingerprint));
  return sql`min(${sql.join(each, COMMA)}, 64)`;
}

/**
 * How many bits a stored fingerprint sets, as SQL: its distance from the
 * fingerprint that sets none. What lets an `INSERT … SELECT` keep only the
 * distinctive ones (design 164), where no value passes through code.
 */
export function bitsSetSql(column: SQLiteColumn): SQL {
  return distanceSql(column, NO_BITS);
}

const NO_BITS = "0".repeat(16);

const COMMA = sql`, `;
const PLUS = sql` + `;

/**
 * A string literal, inlined. Only ever given digits (see `distanceSql`),
 * so there is no quote in it to escape.
 */
function quoted(digits: string): SQL {
  return sql.raw(`'${digits}'`);
}

const HEX = quoted(HEX_DIGITS);

/**
 * The bits between `column` and `fingerprint`, as SQL: per digit, the
 * stored digit's entry in that digit's `digitDistances` string. `instr`
 * finds the stored digit's place in `HEX_DIGITS`, 1-based as `substr`
 * counts.
 *
 * **Inlined, not bound**, because D1 allows 100 bound parameters a query
 * and a four-photo kit would need 192. What is inlined is digits only:
 * `fingerprint` was parsed by `fingerprintSchema` on the way in,
 * `digitDistances` returns 16 of 0–4, and `HEX_DIGITS` is a constant.
 */
function distanceSql(column: SQLiteColumn, fingerprint: string): SQL {
  const digits = Array.from({ length: fingerprint.length }, (_, index) => {
    const lookup = quoted(digitDistances(fingerprint.charAt(index)));
    const place = sql.raw(String(index + 1));
    return sql`substr(${lookup}, instr(${HEX}, substr(${column}, ${place}, 1)), 1)`;
  });
  return sql`(${sql.join(digits, PLUS)})`;
}
