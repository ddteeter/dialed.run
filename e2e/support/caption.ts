/**
 * The pure half of demo narration: what the voice says, how fast, what the
 * caption strip looks like, and the ffmpeg graph that lays both over the
 * recording (design 180, step 1).
 *
 * Split out of `demo.ts` and `scripts/demo-mux.ts` so it can be tested.
 * Those two spawn `say`, `afinfo`, Chromium and ffmpeg, which vitest cannot
 * observe, so they are negated in `stryker.conf.json`. Every decision they
 * make lives here instead, where it is mutated like anything else. Same
 * move the architecture makes for routes: the untestable file keeps the
 * wiring, and the decisions move next door.
 *
 * **The caption never enters the recorded page.** It used to be an
 * `html::after` rule, which kept it out of the DOM (so a narrated
 * assertion could not be satisfied by its own narration) but painted it
 * over the app's top bar. Now it is a PNG overlaid in a strip ffmpeg adds
 * above the frame, after recording, so both properties hold by
 * construction: nothing is painted into the app, and nothing covers it.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Words per minute for `say -r`. About 1.4× the system voice's default,
 * the owner's pick after hearing 280 and 320 (2026-11-06).
 */
const SPEECH_RATE_WPM = 280;

/**
 * Silence rendered after each line, so consecutive lines do not run
 * together. aperture-ally settled on the same figure for the same voice.
 */
const TAIL_SILENCE_MS = 400;

/**
 * The recorded viewport, and the strip ffmpeg adds above it. Mirrors the
 * `demo` project's `video.size` in `playwright.config.ts`, which this file
 * cannot import (the config reads the environment at module scope).
 */
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
export const STRIP_HEIGHT = 104;

/**
 * One narrated line: the caption shown, when it began relative to the
 * start of the recording, and the rendered audio.
 */
export interface Cue {
  readonly text: string;
  readonly startMs: number;
  readonly audio: string;
}

/**
 * `cues.json`, which `demo.ts` writes beside `video.webm` and the mux step
 * reads back: a file on disk, so it is parsed rather than trusted.
 */
export const cuesSchema = z.array(
  z.object({
    text: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    audio: z.string().min(1),
  }),
);

/**
 * What the voice reads when a spec gives no spoken form. A caption is set
 * for the eye, and `·` is the one separator the specs use that the voice
 * would otherwise run straight through; a spec with anything harder (an
 * ID like "D-87", a measurement) passes its own `say`.
 */
export function forSpeech(text: string): string {
  return text
    .split("·")
    .map((part) => part.trim())
    .join(", ");
}

/**
 * The cache key for a rendered line. The rate is part of it, so changing
 * the rate re-renders everything rather than mixing two speeds.
 */
export function speechKey(spoken: string): string {
  return createHash("sha256")
    .update(`${String(SPEECH_RATE_WPM)}\n${spoken}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * `say`'s arguments. **No `-v`**: bare `say` speaks the system voice chosen
 * in System Settings → Accessibility → Spoken Content, which can be a Siri
 * voice. Siri voices never appear in `say -v '?'`, so naming one is not
 * possible; leaving it out is how to get one.
 */
export function sayArgs(spoken: string, out: string): string[] {
  return [
    "-r",
    String(SPEECH_RATE_WPM),
    "-o",
    out,
    `${spoken} [[slnc ${String(TAIL_SILENCE_MS)}]]`,
  ];
}

/**
 * Where macOS keeps the two tools the voice needs: fixed system paths,
 * never a PATH lookup (sonarjs/no-os-command-from-path).
 */
export const SAY = "/usr/bin/say";
export const AFINFO = "/usr/bin/afinfo";

/**
 * Where Homebrew puts ffmpeg, on Apple silicon and then Intel. The mux
 * step takes the first that exists.
 */
export const FFMPEG_CANDIDATES = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
] as const;

/**
 * A rendered line's length, in whole milliseconds, from `afinfo`'s
 * "estimated duration: 5.610658 sec". It is another program's output, so
 * it is parsed: an answer without a positive duration throws here rather
 * than holding a scene for zero or NaN milliseconds.
 */
export function durationMs(afinfo: string): number {
  const seconds = /estimated duration: ([\d.]+) sec/u.exec(afinfo)?.[1];
  return Math.round(z.coerce.number().positive().parse(seconds) * 1000);
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/**
 * One caption as a standalone page, screenshotted to a PNG at the strip's
 * size. Mono, uppercase, pink rule beneath: it has to read as
 * instrumentation laid over the app, never as product chrome. Same pink as
 * the synthetic cursor, the other thing in a recording that is not the
 * product. 22px because the video is watched on a phone, where 1280 wide
 * renders at about a third of its size; two lines at most.
 *
 * `fontUrl` is IBM Plex Mono as a data URL, so the page needs no server.
 */
export function captionPage(text: string, fontUrl: string): string {
  const escaped = text.replaceAll(
    /[&<>"]/gu,
    (char) => HTML_ESCAPES[char] ?? char,
  );
  return `<!doctype html><html><head><style>
@font-face { font-family: "Caption Mono"; font-weight: 500; src: url(${fontUrl}) format("woff2"); }
html, body { margin: 0; width: ${String(FRAME_WIDTH)}px; height: ${String(STRIP_HEIGHT)}px; background: #0c0c0c; }
body { box-sizing: border-box; display: flex; align-items: center; padding: 0 32px; border-bottom: 3px solid rgba(255,45,135,0.9); }
p { margin: 0; color: #f5f5f0; font: 500 22px/1.4 "Caption Mono", ui-monospace, monospace; letter-spacing: 0.06em; text-transform: uppercase; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style></head><body><p>${escaped}</p></body></html>`;
}

/**
 * A cue ready to mux: its caption already rendered to `caption`.
 */
export interface Scene {
  readonly startMs: number;
  readonly audio: string;
  readonly caption: string;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/**
 * When scene `index`'s caption shows: from its start until the next one's,
 * and the last one until the end.
 */
function shownWhile(scene: Scene, next: Scene | undefined): string {
  const from = seconds(scene.startMs);
  return next === undefined
    ? `gte(t,${from})`
    : `between(t,${from},${seconds(next.startMs)})`;
}

/**
 * The filter graph: pad the frame with the strip above it, overlay each
 * caption while it is current, delay each line to its start and mix them.
 * Inputs are numbered video, then every caption, then every audio file.
 */
function filterGraph(scenes: readonly Scene[]): string {
  const count = scenes.length;
  const pad = `[0:v]pad=${String(FRAME_WIDTH)}:${String(FRAME_HEIGHT + STRIP_HEIGHT)}:0:${String(STRIP_HEIGHT)}:color=0x0c0c0c[v0]`;
  const overlays = scenes.map(
    (scene, index) =>
      `[v${String(index)}][${String(index + 1)}:v]overlay=0:0:enable='${shownWhile(scene, scenes.at(index + 1))}'[v${String(index + 1)}]`,
  );
  const delays = scenes.map(
    (scene, index) =>
      `[${String(count + 1 + index)}:a]adelay=${String(scene.startMs)}:all=1[a${String(index)}]`,
  );
  const labels = scenes.map((_scene, index) => `[a${String(index)}]`).join("");
  const mix =
    count === 0
      ? []
      : [`${labels}amix=inputs=${String(count)}:normalize=0[aout]`];
  return [pad, ...overlays, ...delays, ...mix].join(";");
}

/**
 * ffmpeg's arguments: the recording, captioned above the frame and voiced,
 * to H.264 + AAC. H.264 because Playwright's VP8 plays unreliably on iOS
 * Safari, and review here is phone-friendly by design.
 */
export function muxArgs(
  video: string,
  scenes: readonly Scene[],
  out: string,
): string[] {
  const audio =
    scenes.length === 0
      ? []
      : ["-map", "[aout]", "-c:a", "aac", "-b:a", "128k"];
  return [
    "-y",
    "-loglevel",
    "error",
    "-i",
    video,
    ...scenes.flatMap((scene) => ["-i", scene.caption]),
    ...scenes.flatMap((scene) => ["-i", scene.audio]),
    "-filter_complex",
    filterGraph(scenes),
    "-map",
    `[v${String(scenes.length)}]`,
    ...audio,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    out,
  ];
}
