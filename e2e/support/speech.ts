/**
 * Speaks one line: renders it with the run's voice engine (`voice.ts`),
 * caches the file, and says how long a shot must hold for it. Shared by
 * the PR demo's `scene()` (`demo.ts`, design 180) and the diagram
 * recorder (`scripts/diagram-record.ts`, design 229) since #851.
 *
 * The decisions (which engine, what to ask it, the file names, `say`'s
 * arguments, reading `afinfo`) are in `voice.ts` and `caption.ts`. This
 * file makes the calls, through `SpeechTools`, so its tests run in the
 * `node` project with stand-ins for `say`, `afinfo`, `security` and the
 * network.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { AFINFO, SAY, durationMs, sayArgs, speechKey } from "./caption";
import type { Pace } from "./caption";
import {
  HOSTED_TAIL_MS,
  engineFrom,
  hostedFileName,
  keyVariable,
  keychainService,
  speechRequest,
} from "./voice";
import type { HostedEngine } from "./voice";

/**
 * A line, rendered: its file, and how long a shot holds for it (the
 * audio, then the silence after it).
 */
export interface SpokenLine {
  readonly audio: string;
  readonly holdMs: number;
}

/**
 * Everything outside this process that speaking a line touches.
 * `localTools()` is the real set.
 */
export interface SpeechTools {
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
  Runs a program at a fixed path. Awaited, never synchronous: Playwright
  records the video in this process, so a synchronous call stalls it, and
  the narration drifted up to seven seconds behind the picture (measured
  2026-11-06, first recording of new lines).
  */
  readonly run: (
    file: string,
    args: readonly string[],
  ) => Promise<{ readonly stdout: string }>;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /**
  Where `say`'s renders are kept: inside `node_modules`, since they are
  free to make again.
  */
  readonly sayCache: string;
  /**
  Where a hosted engine's renders are kept: outside the repo and
  `node_modules`, because they cost money and `npm ci` would throw them
  away.
  */
  readonly hostedCache: string;
}

export function localTools(): SpeechTools {
  return {
    env: process.env,
    run: promisify(execFile),
    fetch,
    sayCache: path.resolve("node_modules/.cache/demo-voice"),
    hostedCache: path.join(homedir(), ".cache", "dialed-voice"),
  };
}

/**
 * Where macOS keeps `security`: a fixed path, never a PATH lookup.
 */
const SECURITY = "/usr/bin/security";

/**
 * How long a hosted engine may take over one line before the run fails.
 */
const HOSTED_TIMEOUT_MS = 120_000;

/**
 * A hosted engine's key: its shell variable, else its Keychain item.
 * Never logged, and never part of an error message.
 */
async function keyFor(
  tools: SpeechTools,
  chosen: HostedEngine,
): Promise<string> {
  const variable = keyVariable(chosen);
  const fromShell = tools.env[variable] ?? "";
  if (fromShell !== "") return fromShell;
  const service = keychainService(chosen);
  try {
    const { stdout } = await tools.run(SECURITY, [
      "find-generic-password",
      "-s",
      service,
      "-w",
    ]);
    return stdout.trim();
  } catch {
    throw new Error(
      `DEMO_VOICE=${chosen.engine} needs ${variable} in the shell, or a Keychain item: security add-generic-password -a "$USER" -s ${service} -w`,
    );
  }
}

async function hosted(
  tools: SpeechTools,
  chosen: HostedEngine,
  spoken: string,
  pace: Pace,
): Promise<string> {
  const apiKey = await keyFor(tools, chosen);
  const request = speechRequest(chosen, spoken, pace, apiKey);
  const file = path.join(
    tools.hostedCache,
    hostedFileName(chosen, spoken, pace, request.extension),
  );
  if (existsSync(file)) return file;
  const response = await tools.fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(HOSTED_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `${chosen.engine} answered ${String(response.status)}: ${detail.slice(0, 300)}`,
    );
  }
  mkdirSync(tools.hostedCache, { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  return file;
}

async function said(
  tools: SpeechTools,
  spoken: string,
  pace: Pace,
): Promise<string> {
  mkdirSync(tools.sayCache, { recursive: true });
  const file = path.join(tools.sayCache, `${speechKey(spoken, pace)}.aiff`);
  if (!existsSync(file)) await tools.run(SAY, sayArgs(spoken, file, pace));
  return file;
}

/**
 * A speaker for one run: `say` unless `DEMO_VOICE` names a hosted engine.
 * The engine is read here, once, so a bad setting fails before anything
 * is recorded. Each line is rendered, or an earlier rendering reused.
 */
export function speaker(
  tools: SpeechTools,
): (spoken: string, pace: Pace) => Promise<SpokenLine> {
  const engine = engineFrom(tools.env);
  return async (spoken, pace) => {
    const isSay = engine.engine === "say";
    const audio = isSay
      ? await said(tools, spoken, pace)
      : await hosted(tools, engine, spoken, pace);
    const { stdout } = await tools.run(AFINFO, [audio]);
    const tailMs = isSay ? 0 : HOSTED_TAIL_MS;
    return { audio, holdMs: durationMs(stdout) + tailMs };
  };
}
