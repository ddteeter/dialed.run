import { describe, expect, it } from "vitest";

import {
  AFINFO,
  FFMPEG_CANDIDATES,
  SAY,
  STRIP_HEIGHT,
  captionPage,
  durationMs,
  forSpeech,
  muxArgs,
  recordAt,
  recordingSchema,
  sayArgs,
  speechKey,
} from "../../e2e/support/caption";
import type { Scene, Take } from "../../e2e/support/caption";

/**
 * The pure half of demo narration (design 180). `demo.ts` and
 * `scripts/demo-mux.ts` spawn `say`, afinfo, Chromium and ffmpeg, so
 * every decision they make lives in `caption.ts`, where these reach it.
 */
describe("forSpeech", () => {
  it("reads a caption's · as a pause rather than running through it", () => {
    expect(forSpeech("T1 · what we collect, then Strava's button")).toBe(
      "T1, what we collect, then Strava's button",
    );
  });

  it("collapses the spacing around every ·, however the spec typed it", () => {
    expect(forSpeech("a·b  ·   c · d")).toBe("a, b, c, d");
  });

  it("leaves a caption without one as written, trimmed", () => {
    expect(forSpeech("  The Desk  ")).toBe("The Desk");
  });
});

describe("speechKey", () => {
  it("is stable for the same line, so a re-record reuses it", () => {
    expect(speechKey("The Desk")).toBe(speechKey("The Desk"));
  });

  it("differs between lines, so two never share a rendering", () => {
    expect(speechKey("The Desk")).not.toBe(speechKey("The Closet"));
  });

  it("covers the rate, so a new rate does not reuse the old speed", () => {
    // sha256("280\nThe Desk"), first 16 hex digits: the rate is hashed
    // with the line, so changing it moves every key.
    expect(speechKey("The Desk")).toBe("335a3f46a406f910");
  });
});

describe("sayArgs", () => {
  it("speaks at 280 wpm into the file, with the system voice", () => {
    const args = sayArgs("The Desk", "/c/a.aiff");
    expect(args).toEqual([
      "-r",
      "280",
      "-o",
      "/c/a.aiff",
      "The Desk [[slnc 400]]",
    ]);
    // No -v: naming a voice is what loses the Siri one.
    expect(args).not.toContain("-v");
  });
});

describe("the tools' paths", () => {
  it("are fixed system and Homebrew paths, never a PATH lookup", () => {
    expect(SAY).toBe("/usr/bin/say");
    expect(AFINFO).toBe("/usr/bin/afinfo");
    expect(FFMPEG_CANDIDATES).toEqual([
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
    ]);
  });
});

describe("durationMs", () => {
  it("reads afinfo's estimated seconds as whole milliseconds", () => {
    const afinfo = [
      "File:           /c/a.aiff",
      "File type ID:   AIFF",
      "estimated duration: 5.610658 sec",
      "audio bytes: 247430",
    ].join("\n");
    expect(durationMs(afinfo)).toBe(5611);
  });

  it("throws on an answer without a positive duration", () => {
    expect(() => durationMs("File type ID:   AIFF")).toThrow(/number/iu);
    expect(() => durationMs("estimated duration: 0 sec")).toThrow(/>0/u);
    expect(() => durationMs("estimated duration: . sec")).toThrow(/number/iu);
  });
});

describe("recordAt", () => {
  const phone = { width: 390, height: 844 };

  it("sizes the video to the viewport while recording", () => {
    expect(recordAt(phone, true)).toEqual({
      viewport: phone,
      video: { mode: "on", size: phone },
    });
  });

  it("records nothing otherwise, at the same viewport", () => {
    expect(recordAt(phone, false)).toEqual({ viewport: phone, video: "off" });
  });
});

describe("recordingSchema", () => {
  const recording = {
    frame: { width: 1280, height: 720 },
    endMs: 9000,
    cues: [{ text: "The Desk", startMs: 0, audio: "/c/a.aiff" }],
  };

  it("accepts what demo.ts writes", () => {
    expect(recordingSchema.parse(recording)).toEqual(recording);
  });

  const cue = recording.cues[0];
  it.each([
    ["an empty caption", { ...recording, cues: [{ ...cue, text: "" }] }],
    ["a negative start", { ...recording, cues: [{ ...cue, startMs: -1 }] }],
    ["a fractional start", { ...recording, cues: [{ ...cue, startMs: 1.5 }] }],
    ["no audio", { ...recording, cues: [{ ...cue, audio: "" }] }],
    ["no length", { ...recording, endMs: 0 }],
    ["a fractional length", { ...recording, endMs: 1.5 }],
    ["a zero-width frame", { ...recording, frame: { width: 0, height: 720 } }],
    [
      "a zero-height frame",
      { ...recording, frame: { width: 1280, height: 0 } },
    ],
    [
      "a fractional frame",
      { ...recording, frame: { width: 1.5, height: 720 } },
    ],
    [
      "a fractional height",
      { ...recording, frame: { width: 1280, height: 7.5 } },
    ],
  ])("rejects %s", (_name, bad) => {
    expect(recordingSchema.safeParse(bad).success).toBe(false);
  });
});

describe("captionPage", () => {
  it("escapes the caption, so a spec's text cannot break the page", () => {
    const page = captionPage('the 7" <b>shorts</b> & co', "data:x", 1280);
    expect(page).toContain(
      "<p>the 7&quot; &lt;b&gt;shorts&lt;/b&gt; &amp; co</p>",
    );
  });

  it("sizes the page to the frame's width and the strip, and loads the font", () => {
    const page = captionPage("x", "data:font/woff2;base64,AAAA", 390);
    expect(page).toContain(`width: 390px; height: ${String(STRIP_HEIGHT)}px;`);
    expect(page).toContain("src: url(data:font/woff2;base64,AAAA)");
  });
});

function sizes(page: string): {
  font: string | undefined;
  pad: string | undefined;
} {
  return {
    font: /font: 500 (\d+)px/u.exec(page)?.[1],
    pad: /padding: 0 (\d+)px/u.exec(page)?.[1],
  };
}

describe("captionPage's size", () => {
  it("is 22px on a desk frame, and on anything 600 wide or more", () => {
    expect(sizes(captionPage("x", "data:x", 1280))).toEqual({
      font: "22",
      pad: "32",
    });
    expect(sizes(captionPage("x", "data:x", 600))).toEqual({
      font: "22",
      pad: "32",
    });
  });

  it("is 16px on a phone frame, with half the margin", () => {
    expect(sizes(captionPage("x", "data:x", 599))).toEqual({
      font: "16",
      pad: "16",
    });
    expect(sizes(captionPage("x", "data:x", 390))).toEqual({
      font: "16",
      pad: "16",
    });
  });
});

describe("muxArgs", () => {
  const scenes: Scene[] = [
    { startMs: 1200, audio: "/c/a.aiff", caption: "/r/caption-0.png" },
    { startMs: 6050, audio: "/c/b.aiff", caption: "/r/caption-1.png" },
  ];
  const take: Take = { frame: { width: 390, height: 844 }, endMs: 9250 };
  const args = muxArgs("/r/video.webm", take, scenes, "/r/demo.mp4");
  const graph = (args.at(args.indexOf("-filter_complex") + 1) ?? "").split(";");

  it("takes the video, then every caption, then every line", () => {
    const inputs = args.filter((_arg, index) => args[index - 1] === "-i");
    expect(inputs).toEqual([
      "/r/video.webm",
      "/r/caption-0.png",
      "/r/caption-1.png",
      "/c/a.aiff",
      "/c/b.aiff",
    ]);
  });

  it("holds the last frame to the end, then adds the strip above it", () => {
    expect(graph[0]).toBe(
      `[0:v]tpad=stop_mode=clone:stop_duration=9.250,pad=390:${String(844 + STRIP_HEIGHT)}:0:${String(STRIP_HEIGHT)}:color=0x0c0c0c[v0]`,
    );
  });

  it("shows each caption until the next, and the last to the end", () => {
    expect(graph[1]).toBe(
      "[v0][1:v]overlay=0:0:enable='between(t,1.200,6.050)'[v1]",
    );
    expect(graph[2]).toBe("[v1][2:v]overlay=0:0:enable='gte(t,6.050)'[v2]");
  });

  it("starts each line where its caption does, and mixes them", () => {
    expect(graph[3]).toBe("[3:a]adelay=1200:all=1[a0]");
    expect(graph[4]).toBe("[4:a]adelay=6050:all=1[a1]");
    expect(graph[5]).toBe("[a0][a1]amix=inputs=2:normalize=0[aout]");
    expect(graph).toHaveLength(6);
  });

  it("maps the last overlay and the mix to H.264 and AAC", () => {
    expect(args.slice(0, 3)).toEqual(["-y", "-loglevel", "error"]);
    expect(args.slice(args.indexOf("-filter_complex") + 2)).toEqual([
      "-map",
      "[v2]",
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-t",
      "9.250",
      "/r/demo.mp4",
    ]);
  });

  it("with no lines, pads and transcodes, and maps no audio", () => {
    const silent = muxArgs("/r/video.webm", take, [], "/r/demo.mp4");
    expect(silent.at(silent.indexOf("-filter_complex") + 1)).toBe(graph[0]);
    expect(silent.slice(silent.indexOf("-filter_complex") + 2, -1)).toEqual([
      "-map",
      "[v0]",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-t",
      "9.250",
    ]);
  });
});
