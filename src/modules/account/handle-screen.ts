/**
 * The considered half of a handle's word check (task 126; owner,
 * 2026-09-27): OpenAI's omni-moderation, asked once at claim time. The
 * instant half is the vendored list (`lib/contracts/profanity.ts`), which runs
 * first and is all there is when this cannot answer.
 *
 * **Fails open, to the list** (law 5). Claiming a handle is the primary
 * action and this check is secondary, so no key, a slow or failed call,
 * and an answer that does not parse all let the handle through and report
 * why — a moderator can still rename a handle the list missed (ACC-12).
 *
 * Its own request rather than `modules/safety`'s: safety screens images
 * only, and its `classifyImage` sends an image part and reads image
 * categories. The model is safety's, read from its barrel, so the two
 * never drift onto different ones.
 */
import { z } from "zod";

import { env } from "../../env";
import { MODERATION_MODEL } from "../safety";

const MODERATIONS_URL = "https://api.openai.com/v1/moderations";

/**
 * A runner is waiting on Next, so this is shorter than law 4's default:
 * past five seconds the list alone is the better answer.
 */
const TIMEOUT_MS = 5000;

/**
The part of OpenAI's answer this reads: its own verdict.
*/
const resultSchema = z.object({ flagged: z.boolean() });
const answerSchema = z.object({ results: z.array(resultSchema).min(1) });

/**
 * `flagged`, `clear`, or `unknown` when the check could not answer — which
 * the claim treats as `clear`.
 */
export type HandleScreenVerdict = "flagged" | "clear" | "unknown";

export type ScreenHandle = (handle: string) => Promise<HandleScreenVerdict>;

/**
 * The handle as words: `big_mood` is asked about as "big mood", which is
 * how a person reads it and how the model scores it best.
 */
function asWords(handle: string): string {
  return handle.replaceAll("_", " ");
}

function moderationBody(handle: string): string {
  return JSON.stringify({ model: MODERATION_MODEL, input: asWords(handle) });
}

/**
 * The check against one key, with the fetch and the report handed in so a
 * test reaches every branch without the network. `apiKey` undefined is a
 * deployment without OpenAI, which is `unknown` without a call or a
 * report — the same state the photo screen treats as supported.
 */
export async function screenHandle(
  handle: string,
  {
    apiKey,
    fetchImpl = fetch,
    report,
  }: Readonly<{
    apiKey: string | undefined;
    fetchImpl?: typeof fetch;
    report: (error: unknown, context: Record<string, string>) => void;
  }>,
): Promise<HandleScreenVerdict> {
  if (apiKey === undefined || apiKey === "") return "unknown";
  try {
    const response = await fetchImpl(MODERATIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: moderationBody(handle),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`moderation ${String(response.status)}`);
    }
    const { results } = answerSchema.parse(await response.json());
    return results.some((result) => result.flagged) ? "flagged" : "clear";
  } catch (error: unknown) {
    // Never the handle in the report: it is what a runner typed, and the
    // surface is enough to act on (law 7).
    report(error, { surface: "handle-screen" });
    return "unknown";
  }
}

/**
 * The check against the deployed key, for the claim's server function.
 */
export function handleScreenFromEnv(
  report: (error: unknown, context: Record<string, string>) => void,
): ScreenHandle {
  return (handle) =>
    screenHandle(handle, { apiKey: env.OPENAI_API_KEY, report });
}
