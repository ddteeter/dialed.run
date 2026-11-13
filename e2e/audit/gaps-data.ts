/**
 * The gaps seed's data (design 205): `./data/gaps.json`, zod-parsed once
 * when the module loads. Declarations only; what the rows mean is
 * `gaps-plan.ts`'s, which is under the mutation ratchet.
 */
import { z } from "zod";

import { table } from "./table";

import gapsJson from "./data/gaps.json";

const text = z.string();
const num = z.number();
const runner = z.strictObject({ id: text, handle: text });
const blocked = runner.extend({ city: text.nullable() });
const place = z.strictObject({ lat: num, lng: num });
const match = z.strictObject({
  fingerprint: text,
  near: z.array(text).min(1),
  copies: z.int(),
});
const held = z.strictObject({
  requesterEmail: z.email(),
  signature: text,
  description: text,
});
const confirm = held.extend({ location: text });
const valve = held.omit({ description: true });
const takedowns = z.strictObject({ held, confirm, valve });

export const gaps = table(gapsJson, {
  empty: runner,
  onboarding: runner,
  nowhere: place,
  operator: text,
  origin: text,
  blocked: z.array(blocked),
  match,
  takedowns,
  holdReason: text,
  ncmecReportId: text,
});

export const EMPTY_ID = gaps.empty.id;
export const EMPTY_HANDLE = gaps.empty.handle;
export const ONBOARD_ID = gaps.onboarding.id;
export const ONBOARD_HANDLE = gaps.onboarding.handle;
/**
Where the brand-new runner stands: nothing else seeds this place.
*/
export const NOWHERE = gaps.nowhere;
export const BLOCKED = gaps.blocked;
