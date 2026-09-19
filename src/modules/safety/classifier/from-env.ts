/**
 * The production classifier, assembled from the environment.
 *
 * Mirrors `modules/enrichment/model/from-env.ts`: the module that knows
 * about `env` is a thin seam, and everything with behaviour in it
 * (`./moderation`) takes the key as an argument so the eval on a laptop
 * and the Worker run the same code.
 *
 * **Absent key returns `undefined`, and that is a supported state** (law
 * 5). No `OPENAI_API_KEY` means no classifier, which means photos stay
 * `pending`: their owners see them, the public does not, and the
 * `screening-retry` cron picks them all up on the first firing after the
 * key exists. Nothing is lost and nothing fails — the app simply runs with
 * public photo visibility paused, which is the right way round for a
 * safety gate that cannot reach its upstream.
 */
import { env } from "../../../env";
import type { Classify } from "../screening";

import { classifyImage } from "./moderation";

export function classifierFromEnv(): Classify | undefined {
  const apiKey: unknown = env.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey === "") return undefined;
  return (params) => classifyImage({ ...params, apiKey });
}
