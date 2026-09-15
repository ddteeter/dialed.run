/**
 * The OpenAI moderation call, as the eval makes it.
 *
 * Deliberately a near-copy of what `modules/safety/classifier/openai.ts`
 * will do, rather than an import of it: that module reads `env` bindings
 * and this runs on a laptop. The shapes that matter — the request body and
 * the parsed response — are the same, so a threshold read off this report
 * means the same thing in production.
 */
import { z } from "zod";

/**
 * Only the categories that accept image input. The other five
 * (`harassment`, `hate`, `illicit`, and `sexual/minors`) are text-only, so
 * an image scores 0 on them by construction and reporting those zeros
 * would suggest a coverage this does not have.
 *
 * **`sexual/minors` being text-only is the important absence.** Images of
 * minors are not covered by this model at all; that is Cloudflare's CSAM
 * scanning tool, configured in the dashboard (packet §Explicitly configured
 * outside this lane). The two are complements.
 */
export const imageCategories = [
  "sexual",
  "violence",
  "violence/graphic",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
] as const;

export type ImageCategory = (typeof imageCategories)[number];

/**
 * The response, parsed rather than cast (CLAUDE.md trust boundaries).
 *
 * `category_scores` is read as an open record rather than a fixed set of
 * keys: OpenAI adds categories over time, and one we do not know about
 * should be ignored rather than fail the parse and lose the photo's score.
 */
const moderationResultSchema = z.object({
  flagged: z.boolean(),
  category_scores: z.record(z.string(), z.number()),
});

const moderationResponseSchema = z.object({
  results: z.array(moderationResultSchema).min(1),
});

export interface ModerationResult {
  /**
  The model's own boolean, which the eval reports but does not trust.
  */
  flagged: boolean;
  /**
  Score per image-capable category, 0–1.
  */
  scores: Record<ImageCategory, number>;
}

/**
 * Classifies one image.
 *
 * The image goes as a base64 data URL rather than a public link: the photos
 * are local files, and in production they are R2 objects behind an
 * authenticated route, so a URL OpenAI could fetch is not a thing this app
 * has. 10 MB is our upload cap and 20 MB is theirs, so base64's ~33%
 * inflation still fits.
 */
export async function classifyImage(
  bytes: Uint8Array,
  contentType: string,
  apiKey: string,
): Promise<ModerationResult> {
  const dataUrl = `data:${contentType};base64,${base64Of(bytes)}`;

  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "omni-moderation-latest",
      input: [{ type: "image_url", image_url: { url: dataUrl } }],
    }),
    // Law 4: every outbound fetch gets a timeout. Here it keeps one wedged
    // request from stalling a twenty-photo run.
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `moderation ${String(response.status)}: ${await response.text()}`,
    );
  }

  const parsed = moderationResponseSchema.parse(await response.json());
  const [result] = parsed.results;
  if (!result) throw new Error("moderation returned no results");

  return {
    flagged: result.flagged,
    scores: Object.fromEntries(
      imageCategories.map((category) => [
        category,
        result.category_scores[category] ?? 0,
      ]),
    ) as Record<ImageCategory, number>,
  };
}

/**
 * Base64 without Node's Buffer, so this file reads the same as the Worker
 * version will. Chunked because spreading a multi-megabyte array into
 * `String.fromCharCode` overflows the call stack.
 */
function base64Of(bytes: Uint8Array): string {
  const CHUNK = 0x80_00;
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    // fromCodePoint, not fromCharCode: identical for the 0-255 values a
    // byte array holds, and it is the one the lint rule prefers.
    binary += String.fromCodePoint(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}
