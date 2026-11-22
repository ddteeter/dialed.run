/**
 * The Worker's place stamps (`place-stamp.ts`), under its auth secret.
 */
import { env } from "../../env";
import { placeStamps, type PlaceStamps } from "./place-stamp";

export function placeStampsFromEnv(): PlaceStamps {
  return placeStamps(env.BETTER_AUTH_SECRET);
}
