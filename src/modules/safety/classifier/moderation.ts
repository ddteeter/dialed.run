/**
 * The moderation classifier's wire format and its threshold rule.
 *
 * **Everything here is pure**, and that is the point: it reads no bindings,
 * so the eval script on a laptop and the Worker in production run the same
 * code rather than two copies that drift. The earlier draft of this lane
 * had the eval carrying "a deliberate near-copy" of the request and the
 * parse — which the duplication gate would have caught, and which would
 * have meant a threshold measured against one implementation and enforced
 * by another.
 *
 * The key is an argument for the same reason. `./openai.ts` reads it from
 * `env`; the eval reads it from `.dev.vars`. Neither fact belongs here.
 */
import { z } from "zod";

/**
 * Only the categories that accept image input.
 *
 * The other five — `harassment`, `harassment/threatening`, `hate`,
 * `illicit`, and `sexual/minors` — are **text-only**, so an image scores 0
 * on them by construction. Reporting those zeros would imply a coverage
 * this does not have.
 *
 * **`sexual/minors` being text-only is the important absence.** Images of
 * minors are not covered by this model at all. That is Cloudflare's CSAM
 * scanning tool, configured in the dashboard (packet §"Explicitly
 * configured outside this lane"), and the two are complements rather than
 * alternatives. Nothing in this module should ever be described as
 * covering it.
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
export type CategoryScores = Record<ImageCategory, number>;

export const MODERATION_MODEL = "omni-moderation-latest";

/**
 * Per-category thresholds.
 *
 * **Provisional until `npm run eval:photos` has run** — the packet requires
 * that measurement before launch, and these numbers are a starting point
 * for it to move, not a result. They are deliberately high: the documented
 * failure mode of this model is over-sensitivity, with revealing swimwear
 * and underwear inside `sexual`, which is ordinary running kit. A false
 * flag hides a runner's own photo from everyone, so the cost of being
 * slightly loose here is borne by the review queue and the cost of being
 * tight is borne by a runner who did nothing wrong.
 *
 * Per-category rather than one number, because the model's own `flagged`
 * boolean bundles categories whose base rates on running photos are
 * nothing alike.
 */
export const thresholds: CategoryScores = {
  sexual: 0.9,
  violence: 0.9,
  "violence/graphic": 0.8,
  "self-harm": 0.8,
  "self-harm/intent": 0.8,
  "self-harm/instructions": 0.8,
};

/**
 * The floor of the middle band: high enough to be worth a person's eye,
 * too low to hide a runner's photo over.
 *
 * **Why a band at all** (owner's call on PR #73). Two thresholds and one
 * gap between them: under the floor is published and nobody is troubled,
 * over `thresholds` is hidden and queued, and in between the photo *stays
 * visible* and a reviewer looks at it anyway. The middle band buys
 * calibration without charging a runner for our uncertainty — which is the
 * whole reason `thresholds` above sits as high as it does. A reviewer
 * agreeing or disagreeing with a borderline score is exactly the signal
 * `npm run eval:photos` cannot produce, because the eval only ever sees
 * photos we chose.
 *
 * Half of each category's threshold, uniformly, and that is a starting
 * point rather than a result — the same standing as `thresholds` and
 * subject to the same measurement. Derived rather than written out so the
 * two cannot drift into an order that makes no sense (a floor above its own
 * threshold would put every flagged photo in the review band and hide
 * nothing); `test/safety/moderation.test.ts` pins that ordering.
 */
export const reviewFloors: CategoryScores = Object.fromEntries(
  imageCategories.map((category) => [category, thresholds[category] / 2]),
) as CategoryScores;

const moderationResultSchema = z.object({
  flagged: z.boolean(),
  category_scores: z.record(z.string(), z.number()),
});

const moderationResponseSchema = z.object({
  // No `.min(1)`: the guard in `classifyImage` already refuses an empty
  // list, and it has to — `.min(1)` narrows nothing at the type level, so
  // the element still needs checking. Two rules for one fact meant
  // neither could be tested, because zod rejected the empty list before
  // the guard could see it.
  results: z.array(moderationResultSchema),
});

export interface ModerationResult {
  /**
  The model's own boolean. Recorded, never acted on — see `decide`.
  */
  flagged: boolean;
  scores: CategoryScores;
}

/**
 * Whether any category crossed its own threshold.
 *
 * **Not `result.flagged`.** That boolean is the model's policy, tuned for a
 * general-purpose chat product, and the packet's whole worry is that it
 * disagrees with ours about a sports bra. The scores are what we tune; the
 * boolean is stored beside them so the eval can report what trusting it
 * would have cost.
 */
export type ScreenDecision = "pass" | "review" | "flag";

export function decide(scores: CategoryScores): ScreenDecision {
  const isCrossed = imageCategories.some(
    (category) => scores[category] >= thresholds[category],
  );
  if (isCrossed) return "flag";
  // The middle band. Checked only after the block test, so a score over
  // its threshold is never merely "reviewed" — `flag` is the stronger
  // answer and wins wherever both are true.
  const isBorderline = imageCategories.some(
    (category) => scores[category] >= reviewFloors[category],
  );
  return isBorderline ? "review" : "pass";
}

/**
 * Classifies one image. Throws on a non-2xx or an unparseable body; the
 * caller decides what a failure means (law 5 — here it means the photo
 * stays `pending`, so its owner sees it and nobody else does).
 *
 * The image goes as a base64 data URL rather than a link. In production the
 * photos are R2 objects behind an authenticated route, so a URL OpenAI
 * could fetch is not a thing this app has. Our upload cap is 10 MB and
 * theirs is 20 MB, so base64's ~33% inflation still fits.
 */
export async function classifyImage(params: {
  bytes: Uint8Array;
  contentType: string;
  apiKey: string;
}): Promise<ModerationResult> {
  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODERATION_MODEL,
      input: [
        {
          type: "image_url",
          image_url: {
            url: `data:${params.contentType};base64,${base64Of(params.bytes)}`,
          },
        },
      ],
    }),
    // Law 4: every outbound fetch gets a timeout and a zod parse. A slow
    // upstream must never wedge a request or a cron sweep.
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new ModerationError(`moderation ${String(response.status)}`);
  }

  const parsed = moderationResponseSchema.parse(await response.json());
  const [result] = parsed.results;
  if (!result) throw new ModerationError("moderation returned no results");

  return {
    flagged: result.flagged,
    scores: scoresFrom(result.category_scores),
  };
}

export class ModerationError extends Error {}

/**
 * The image-capable categories, defaulted to 0.
 *
 * A category the response omits reads as 0 rather than failing the parse:
 * OpenAI adds categories over time and drops none, so a missing key is far
 * likelier to be a shape change than a signal, and losing a whole photo's
 * score over it would be the wrong trade.
 */
function scoresFrom(raw: Record<string, number>): CategoryScores {
  const entries = imageCategories.map(
    (category) => [category, raw[category] ?? 0] as const,
  );
  return Object.fromEntries(entries) as CategoryScores;
}

/**
 * Base64 without Node's Buffer, because this runs in workerd too.
 *
 * Chunked: spreading a multi-megabyte array into one `String.fromCodePoint`
 * call overflows the stack, and our cap is 10 MB.
 */
function base64Of(bytes: Uint8Array): string {
  const CHUNK = 0x80_00;
  // Counted rather than walked with a `<` on the byte length: `<` and
  // `<=` there produce the same string, because the extra pass takes an
  // empty subarray, so the comparison was a mutant no input could
  // distinguish. A chunk count has no such slack — one too few truncates
  // the photo and one too many appends nothing.
  const chunks = Array.from(
    { length: Math.ceil(bytes.length / CHUNK) },
    (_, index) =>
      String.fromCodePoint(
        ...bytes.subarray(index * CHUNK, (index + 1) * CHUNK),
      ),
  );
  return btoa(chunks.join(""));
}
