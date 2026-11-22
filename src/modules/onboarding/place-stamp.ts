/**
 * The stamp Find puts on the place the provider found, and the check the
 * place writers make before they store one: a place is saved only as the
 * provider named it, never as text a request chose.
 *
 * Keyed by the auth secret under its own purpose label, as the
 * unsubscribe link is: a stamp can never be read as anything else that
 * secret signs. A stamp names the place and nothing else, so it can be
 * reused only for that same place.
 *
 * Reads no binding, so the e2e suite's stand-in for Find can stamp its
 * answer as the server would (`place-stamp-env.ts` is the Worker's).
 */
import type { ResolvedPlace } from "../../lib/contracts";
import { hmacKey } from "../../lib/hmac-key";

/**
The key's purpose label. Changing it refuses every stamp Find has given.
*/
const PURPOSE = "dialed.run place stamp v1";

const encoder = new TextEncoder();

function message(place: ResolvedPlace): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    `${PURPOSE}|${JSON.stringify([place.address, place.lat, place.lng])}`,
  );
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The stamp's bytes, or nothing for a string that is not a SHA-256's
 * worth of hex.
 */
function fromHex(stamp: string): Uint8Array<ArrayBuffer> | undefined {
  return /^[\da-f]{64}$/u.test(stamp)
    ? Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(stamp.slice(index * 2, index * 2 + 2), 16),
      )
    : undefined;
}

export interface PlaceStamps {
  /**
  The stamp for a place the provider found.
  */
  readonly stamp: (place: ResolvedPlace) => Promise<string>;
  /**
   * Whether `stamp` is this place's. Compared by `verify`, which is
   * constant-time.
   */
  readonly verifyStamp: (
    place: ResolvedPlace,
    stamp: string,
  ) => Promise<boolean>;
}

/**
 * Stamps under `secret`. With no secret nothing is stamped and nothing is
 * taken (fail closed); auth does not start without one anyway.
 */
export function placeStamps(secret: string | undefined): PlaceStamps {
  const isKeyed = secret !== undefined && secret !== "";
  return {
    stamp: async (place) => {
      if (!isKeyed) return "";
      const key = await hmacKey(secret, ["sign"]);
      return toHex(await crypto.subtle.sign("HMAC", key, message(place)));
    },
    verifyStamp: async (place, stamp) => {
      const signature = fromHex(stamp);
      if (!isKeyed || signature === undefined) return false;
      const key = await hmacKey(secret, ["verify"]);
      return crypto.subtle.verify("HMAC", key, signature, message(place));
    },
  };
}
