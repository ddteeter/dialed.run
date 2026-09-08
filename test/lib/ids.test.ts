import { describe, expect, it } from "vitest";

import { newUlid, ulidSchema } from "../../src/lib/ids";

/**
 * `ulidSchema` is the gate every entity id crosses — every server function
 * validates one, and a client-generated idempotency key is checked against
 * it before it is trusted as a UNIQUE key.
 *
 * Mutation testing found nothing pinned its anchors. `^` and `$` could both
 * be dropped and the whole suite still passed, because every id anyone had
 * ever tested was a well-formed ULID and nothing exercised a value with
 * junk on either end.
 */

describe("ulidSchema", () => {
  it("accepts a real ULID", () => {
    const id = newUlid();
    expect(ulidSchema.parse(id)).toBe(id);
    expect(id).toHaveLength(26);
  });

  it("is anchored at both ends", () => {
    // Without `^` a value with a prefix parses; without `$`, a suffix. Both
    // matter here: the schema guards ids that are interpolated into R2 keys
    // and compared against UNIQUE columns.
    const id = newUlid();
    expect(ulidSchema.safeParse(`x${id}`).success).toBe(false);
    expect(ulidSchema.safeParse(`${id}x`).success).toBe(false);
    expect(ulidSchema.safeParse(` ${id} `).success).toBe(false);
  });

  it("rejects the letters Crockford base32 leaves out", () => {
    // I, L, O and U are excluded on purpose — they are the characters
    // people misread as 1, 1, 0 and V.
    const body = "0123456789ABCDEFGHJKMNPQRS";
    expect(ulidSchema.safeParse(body).success).toBe(true);
    for (const bad of ["I", "L", "O", "U"]) {
      expect(
        ulidSchema.safeParse(bad + body.slice(1)).success,
        `${bad} should not be a ULID character`,
      ).toBe(false);
    }
  });

  it("rejects the wrong length, either way", () => {
    const id = newUlid();
    expect(ulidSchema.safeParse(id.slice(0, 25)).success).toBe(false);
    expect(ulidSchema.safeParse(`${id}Z`).success).toBe(false);
    expect(ulidSchema.safeParse("").success).toBe(false);
  });

  it("says what was wrong", () => {
    // The message is the one a form shows: copy rules mean it has to be
    // the schema's, not a component's.
    const result = ulidSchema.safeParse("nope");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("not a ULID");
  });

  it("mints ids whose timestamp prefix advances with time", async () => {
    // The reason for ULIDs over UUIDs: the first 10 characters are a
    // millisecond timestamp, so ids sort roughly by creation.
    //
    // "Roughly" is exact: `ulid()` is not monotonic *within* a
    // millisecond — the remaining 16 characters are random, so two ids
    // minted in the same tick sort arbitrarily. Nothing here depends on
    // that (feeds order by `created_at`), but it is worth knowing before
    // someone reaches for id order as a tiebreak. `monotonicFactory` is
    // what to use if that day comes.
    const first = newUlid();
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = newUlid();
    expect(first.slice(0, 10) < second.slice(0, 10)).toBe(true);
  });
});
