import { ulid } from "ulidx";
import { z } from "zod";

declare const ulidBrand: unique symbol;

/**
ULID string (sortable). All entity ids are Ulids (docs/contracts.md).
*/
export type Ulid = string & { readonly [ulidBrand]: true };

export function newUlid(): Ulid {
  return ulid() as Ulid;
}

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "not a ULID")
  .transform((value) => value as Ulid);
