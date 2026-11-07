import { describe, expect, it } from "vitest";

import {
  DIRECTIONS,
  HOSTED_TAIL_MS,
  engineFrom,
  hostedFileName,
  keyVariable,
  keychainService,
  relativeSpeed,
  speechRequest,
} from "../../e2e/support/voice";
import type { HostedEngine } from "../../e2e/support/voice";

/**
 * The pure half of the voice engines (design 180). `demo.ts` makes the
 * request and writes the file; every decision about it is here.
 */
const openai: HostedEngine = {
  engine: "openai",
  model: "gpt-4o-mini-tts",
  voice: "marin",
};
const eleven: HostedEngine = {
  engine: "elevenlabs",
  model: "eleven_multilingual_v2",
  voice: "voice/1",
};

describe("engineFrom", () => {
  it("is say when nothing, or nothing but blanks, is set", () => {
    expect(engineFrom({})).toEqual({ engine: "say" });
    expect(
      engineFrom({ DEMO_VOICE: "", DEMO_VOICE_ID: "", DEMO_VOICE_MODEL: "" }),
    ).toEqual({ engine: "say" });
  });

  it("gives OpenAI its instructable model and recommended voice", () => {
    expect(engineFrom({ DEMO_VOICE: "openai" })).toEqual(openai);
    expect(
      engineFrom({
        DEMO_VOICE: "openai",
        DEMO_VOICE_ID: "",
        DEMO_VOICE_MODEL: "",
      }),
    ).toEqual(openai);
  });

  it("takes a voice and model from the environment over the defaults", () => {
    expect(
      engineFrom({
        DEMO_VOICE: "openai",
        DEMO_VOICE_ID: "cedar",
        DEMO_VOICE_MODEL: "next-tts",
      }),
    ).toEqual({ engine: "openai", model: "next-tts", voice: "cedar" });
  });

  it("gives ElevenLabs its long-form model, and the voice it is told", () => {
    expect(
      engineFrom({ DEMO_VOICE: "elevenlabs", DEMO_VOICE_ID: "voice/1" }),
    ).toEqual(eleven);
  });

  it("takes ElevenLabs's model from the environment too", () => {
    expect(
      engineFrom({
        DEMO_VOICE: "elevenlabs",
        DEMO_VOICE_ID: "voice/1",
        DEMO_VOICE_MODEL: "eleven_v3",
      }),
    ).toEqual({ ...eleven, model: "eleven_v3" });
  });

  it("stops the run on an unknown engine, or ElevenLabs with no voice", () => {
    expect(() => engineFrom({ DEMO_VOICE: "polly" })).toThrow();
    expect(() => engineFrom({ DEMO_VOICE: "elevenlabs" })).toThrow(
      /needs DEMO_VOICE_ID/u,
    );
    expect(() =>
      engineFrom({ DEMO_VOICE: "elevenlabs", DEMO_VOICE_ID: "" }),
    ).toThrow();
  });
});

describe("keyVariable", () => {
  it("names each engine's key", () => {
    expect(keyVariable(openai)).toBe("OPENAI_API_KEY");
    expect(keyVariable(eleven)).toBe("ELEVENLABS_API_KEY");
  });
});

describe("keychainService", () => {
  it("names one Keychain item per engine", () => {
    expect(keychainService(openai)).toBe("dialed-demo-openai");
    expect(keychainService(eleven)).toBe("dialed-demo-elevenlabs");
  });
});

describe("relativeSpeed", () => {
  it("keeps review 1.4x a walkthrough, as the say rates do", () => {
    expect(relativeSpeed("walkthrough")).toBe(1);
    expect(relativeSpeed("review")).toBeCloseTo(1.4, 10);
  });
});

describe("HOSTED_TAIL_MS", () => {
  it("is the silence say renders after a line", () => {
    expect(HOSTED_TAIL_MS).toBe(400);
  });
});

describe("speechRequest · OpenAI", () => {
  const request = speechRequest(openai, "The Desk", "walkthrough", "k-1");

  it("posts to the speech endpoint with the key as a bearer token", () => {
    expect(request.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(request.headers).toEqual({
      Authorization: "Bearer k-1",
      "Content-Type": "application/json",
    });
    expect(request.extension).toBe("wav");
  });

  it("asks for the line in the pace's direction and speed, as WAV", () => {
    expect(JSON.parse(request.body)).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "The Desk",
      instructions: DIRECTIONS.walkthrough,
      speed: 1,
      response_format: "wav",
    });
  });

  it("speaks review faster, in review's direction", () => {
    const review: unknown = JSON.parse(
      speechRequest(openai, "x", "review", "k").body,
    );
    expect(review).toMatchObject({
      instructions: DIRECTIONS.review,
      speed: 1.4,
    });
  });
});

describe("speechRequest · ElevenLabs", () => {
  const request = speechRequest(eleven, "The Desk", "walkthrough", "k-2");

  it("posts to the voice's convert endpoint for MP3, the key in its header", () => {
    expect(request.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128",
    );
    expect(request.headers).toEqual({
      "xi-api-key": "k-2",
      "Content-Type": "application/json",
    });
    expect(request.extension).toBe("mp3");
  });

  it("sends the line and model, at the pace's speed", () => {
    expect(JSON.parse(request.body)).toEqual({
      text: "The Desk",
      model_id: "eleven_multilingual_v2",
      voice_settings: { speed: 1 },
    });
  });

  it("clamps review's speed to 1.2 rather than have it refused", () => {
    const review: unknown = JSON.parse(
      speechRequest(eleven, "x", "review", "k").body,
    );
    expect(review).toMatchObject({ voice_settings: { speed: 1.2 } });
  });
});

describe("the directions", () => {
  it("say how each pace should sound", () => {
    expect(DIRECTIONS.review).toMatch(/^Brisk and neutral/u);
    expect(DIRECTIONS.walkthrough).toMatch(/^Warm, clear and unhurried/u);
  });
});

describe("hostedFileName", () => {
  const name = hostedFileName(openai, "The Desk", "walkthrough", "wav");

  it("names the engine and the format around a 16-digit key", () => {
    expect(name).toMatch(/^openai-[\da-f]{16}\.wav$/u);
    expect(hostedFileName(eleven, "The Desk", "walkthrough", "mp3")).toMatch(
      /^elevenlabs-[\da-f]{16}\.mp3$/u,
    );
  });

  it("is stable, so a re-record reuses a paid rendering", () => {
    expect(hostedFileName(openai, "The Desk", "walkthrough", "wav")).toBe(name);
  });

  it.each([
    [
      "the words",
      () => hostedFileName(openai, "The Closet", "walkthrough", "wav"),
    ],
    ["the pace", () => hostedFileName(openai, "The Desk", "review", "wav")],
    [
      "the voice",
      () =>
        hostedFileName(
          { ...openai, voice: "cedar" },
          "The Desk",
          "walkthrough",
          "wav",
        ),
    ],
    [
      "the model",
      () =>
        hostedFileName(
          { ...openai, model: "next" },
          "The Desk",
          "walkthrough",
          "wav",
        ),
    ],
  ])("changes with %s", (_what, other) => {
    expect(other()).not.toBe(name);
  });

  it("keys the engine too, not only its prefix", () => {
    const asEleven = hostedFileName(
      { engine: "elevenlabs", model: openai.model, voice: openai.voice },
      "The Desk",
      "walkthrough",
      "wav",
    );
    expect(asEleven.slice("elevenlabs-".length)).not.toBe(
      name.slice("openai-".length),
    );
  });
});
