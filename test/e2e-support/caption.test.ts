import { describe, expect, it } from "vitest";

import {
  AFINFO,
  FFMPEG_CANDIDATES,
  SAY,
  STRIP_HEIGHT,
  captionPage,
  cuesSchema,
  durationMs,
  forSpeech,
  muxArgs,
  sayArgs,
  speechKey,
} from "../../e2e/support/caption";
import type { Scene } from "../../e2e/support/caption";

/**
 * The pure half of demo narration (design 180). `demo.ts` and
 * `scripts/demo-mux.ts` spawn `say`, ffprobe, Chromium and ffmpeg, so
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

describe("cuesSchema", () => {
  it("accepts what demo.ts writes", () => {
    const cues = [{ text: "The Desk", startMs: 0, audio: "/c/a.aiff" }];
    expect(cuesSchema.parse(cues)).toEqual(cues);
  });

  it.each([
    ["an empty caption", { text: "", startMs: 0, audio: "/a" }],
    ["a negative start", { text: "x", startMs: -1, audio: "/a" }],
    ["a fractional start", { text: "x", startMs: 1.5, audio: "/a" }],
    ["no audio", { text: "x", startMs: 0, audio: "" }],
  ])("rejects %s", (_name, cue) => {
    expect(cuesSchema.safeParse([cue]).success).toBe(false);
  });
});

describe("captionPage", () => {
  it("escapes the caption, so a spec's text cannot break the page", () => {
    const page = captionPage('the 7" <b>shorts</b> & co', "data:x");
    expect(page).toContain(
      "<p>the 7&quot; &lt;b&gt;shorts&lt;/b&gt; &amp; co</p>",
    );
  });

  it("sizes the page to the strip and loads the font it is given", () => {
    const page = captionPage("x", "data:font/woff2;base64,AAAA");
    expect(page).toContain(`width: 1280px; height: ${String(STRIP_HEIGHT)}px;`);
    expect(page).toContain("src: url(data:font/woff2;base64,AAAA)");
  });
});

describe("muxArgs", () => {
  const scenes: Scene[] = [
    { startMs: 1200, audio: "/c/a.aiff", caption: "/r/caption-0.png" },
    { startMs: 6050, audio: "/c/b.aiff", caption: "/r/caption-1.png" },
  ];
  const args = muxArgs("/r/video.webm", scenes, "/r/demo.mp4");
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

  it("adds the strip above the frame, so no caption covers the app", () => {
    expect(graph[0]).toBe(
      `[0:v]pad=1280:${String(720 + STRIP_HEIGHT)}:0:${String(STRIP_HEIGHT)}:color=0x0c0c0c[v0]`,
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
      "/r/demo.mp4",
    ]);
  });

  it("with no lines, pads and transcodes, and maps no audio", () => {
    const silent = muxArgs("/r/video.webm", [], "/r/demo.mp4");
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
    ]);
  });
});
