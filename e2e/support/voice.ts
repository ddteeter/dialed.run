/**
 * The voice engines a recording can speak with (design 180): macOS `say`
 * by default, and two hosted engines for a release-quality take
 * (owner, 2026-11-06: "occasionally, perhaps once every major release").
 *
 * Pure, like `caption.ts`: which engine, what to ask it, and where its
 * answer is cached. `demo.ts` makes the request and writes the file.
 *
 * `DEMO_VOICE=openai|elevenlabs` picks a hosted engine for one run;
 * `DEMO_VOICE_ID` and `DEMO_VOICE_MODEL` override its voice and model.
 * The key comes from `OPENAI_API_KEY` or `ELEVENLABS_API_KEY` in the
 * shell, never from a file: for example
 * `OPENAI_API_KEY=$(security find-generic-password -s openai -w)`.
 * Only narration text leaves the machine.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { SPEECH_RATES } from "./caption";
import type { Pace } from "./caption";

/**
 * How each pace should sound, for an engine that takes direction in
 * words (OpenAI's `instructions`). `say` and ElevenLabs's convert
 * endpoint take none, and ignore it. Part of the cache key, so editing a
 * direction re-renders its lines.
 */
export const DIRECTIONS: Readonly<Record<Pace, string>> = {
  review:
    "Brisk and neutral, like a teammate giving a status update: an even, quick pace and no flourish.",
  walkthrough:
    "Warm, clear and unhurried, like a product owner showing their own product to a stakeholder: natural emphasis, and a short pause between sentences.",
};

/**
 * A pace's speed relative to an engine's natural one: the `say` rates'
 * ratio, so review stays about 1.4x a walkthrough on every engine.
 */
export function relativeSpeed(pace: Pace): number {
  return SPEECH_RATES[pace] / SPEECH_RATES.walkthrough;
}

/**
 * ElevenLabs documents `speed` without a range; third-party clients of
 * it cap at 1.2, so review pace is clamped there rather than refused.
 */
const ELEVENLABS_MAX_SPEED = 1.2;

const engineSchema = z.discriminatedUnion("engine", [
  z.object({ engine: z.literal("say") }),
  z.object({
    engine: z.literal("openai"),
    // The one model that takes `instructions`; OpenAI recommends marin
    // or cedar "for best quality" (docs read 2026-11-06). It is listed to
    // shut down 2027-01-06: set DEMO_VOICE_MODEL to its successor.
    model: z.string().min(1).default("gpt-4o-mini-tts"),
    voice: z.string().min(1).default("marin"),
  }),
  z.object({
    engine: z.literal("elevenlabs"),
    // "Most stable on long-form generations" (docs, 2026-11-06).
    model: z.string().min(1).default("eleven_multilingual_v2"),
    // No default: list voices with GET /v2/voices?category=premade.
    voice: z
      .string({
        error:
          "DEMO_VOICE=elevenlabs needs DEMO_VOICE_ID: list voices with GET https://api.elevenlabs.io/v2/voices?category=premade",
      })
      .min(1),
  }),
]);

export type Engine = z.infer<typeof engineSchema>;
export type HostedEngine = Exclude<Engine, { engine: "say" }>;

/**
 * An unset and an empty variable mean the same: use the default.
 */
function blank(value: string | undefined): string | undefined {
  return value === "" ? undefined : value;
}

/**
 * The engine a run speaks with, from its environment: `say` unless
 * `DEMO_VOICE` names another. Parsed, so a typo or a missing voice id
 * stops the run before anything is recorded.
 */
export function engineFrom(
  env: Readonly<Record<string, string | undefined>>,
): Engine {
  return engineSchema.parse({
    engine: blank(env.DEMO_VOICE) ?? "say",
    model: blank(env.DEMO_VOICE_MODEL),
    voice: blank(env.DEMO_VOICE_ID),
  });
}

/**
 * The shell variable holding a hosted engine's key.
 */
export function keyVariable(engine: HostedEngine): string {
  return engine.engine === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY";
}

/**
 * Silence to hold after a hosted engine's line. `say` renders its own
 * (`[[slnc 400]]`); a hosted engine's audio stops at the last word, so
 * the scene holds this much longer, or consecutive lines run together.
 */
export const HOSTED_TAIL_MS = 400;

/**
 * One request for one line: everything but the network.
 */
export interface SpeechRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /**
  What the engine answers with, which `afinfo` and ffmpeg both read.
  */
  readonly extension: "wav" | "mp3";
}

export function speechRequest(
  engine: HostedEngine,
  spoken: string,
  pace: Pace,
  apiKey: string,
): SpeechRequest {
  if (engine.engine === "openai") {
    return {
      url: "https://api.openai.com/v1/audio/speech",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: engine.model,
        voice: engine.voice,
        input: spoken,
        instructions: DIRECTIONS[pace],
        speed: relativeSpeed(pace),
        response_format: "wav",
      }),
      extension: "wav",
    };
  }
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(engine.voice)}?output_format=mp3_44100_128`,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: spoken,
      model_id: engine.model,
      voice_settings: {
        speed: Math.min(relativeSpeed(pace), ELEVENLABS_MAX_SPEED),
      },
    }),
    extension: "mp3",
  };
}

/**
 * The cached file's name for a hosted engine's line: the engine, then a
 * hash of everything that changes the audio (model, voice, pace and its
 * direction, the words), so a change to any of them re-renders and two
 * engines never share a file.
 */
export function hostedFileName(
  engine: HostedEngine,
  spoken: string,
  pace: Pace,
  extension: SpeechRequest["extension"],
): string {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        engine.engine,
        engine.model,
        engine.voice,
        pace,
        DIRECTIONS[pace],
        spoken,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  return `${engine.engine}-${key}.${extension}`;
}
