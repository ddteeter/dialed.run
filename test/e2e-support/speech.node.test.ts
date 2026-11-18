/**
 * `e2e/support/speech.ts` renders and caches a spoken line for the PR demo
 * and the diagram recorder (#851). It writes files, so it runs in the
 * `node` project, against a scratch folder, with stand-ins for `say`,
 * `afinfo`, `security` and the network.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AFINFO, SAY, sayArgs, speechKey } from "../../e2e/support/caption";
import { localTools, speaker } from "../../e2e/support/speech";
import type { SpeechTools } from "../../e2e/support/speech";
import {
  HOSTED_TAIL_MS,
  hostedFileName,
  speechRequest,
} from "../../e2e/support/voice";
import type { HostedEngine } from "../../e2e/support/voice";

const SECURITY = "/usr/bin/security";
const AFINFO_OUT = "File: x\nestimated duration: 1.250000 sec\n";

interface Ran {
  readonly file: string;
  readonly args: readonly string[];
}

interface Fetched {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * Tools over a fresh scratch folder. Both caches sit two levels below it,
 * so a render that did not make its folder (recursively) fails to write.
 * `say` writes the file it is asked for; `security` answers `keychain`,
 * or fails when it is undefined.
 */
function scratchTools(
  options: {
    readonly env?: Record<string, string>;
    readonly keychain?: string;
    readonly answer?: () => Response;
  } = {},
) {
  const root = mkdtempSync(path.join(tmpdir(), "speech-"));
  const ran: Ran[] = [];
  const fetched: Fetched[] = [];
  const tools: SpeechTools = {
    env: options.env ?? {},
    run: (file, args) => {
      ran.push({ file, args });
      if (file === SAY) writeFileSync(args[3] ?? "", "aiff");
      if (file === SECURITY && options.keychain === undefined) {
        return Promise.reject(new Error("item not found"));
      }
      const stdout = file === AFINFO ? AFINFO_OUT : (options.keychain ?? "");
      return Promise.resolve({ stdout });
    },
    fetch: (url, init) => {
      fetched.push({ url, init });
      const answer =
        options.answer ?? (() => new Response(new Uint8Array([7, 8, 9])));
      return Promise.resolve(answer());
    },
    sayCache: path.join(root, "say", "cache"),
    hostedCache: path.join(root, "hosted", "cache"),
  };
  return { tools, ran, fetched };
}

const OPENAI: HostedEngine = {
  engine: "openai",
  model: "gpt-4o-mini-tts",
  voice: "marin",
};

describe("speaker with say", () => {
  it("renders a line into the say cache and holds for its length", async () => {
    const { tools, ran } = scratchTools();
    const line = await speaker(tools)("Stores the raw file.", "review");
    const file = path.join(
      tools.sayCache,
      `${speechKey("Stores the raw file.", "review")}.aiff`,
    );
    expect(line).toEqual({ audio: file, holdMs: 1250 });
    expect(ran).toEqual([
      { file: SAY, args: sayArgs("Stores the raw file.", file, "review") },
      { file: AFINFO, args: [file] },
    ]);
    expect(existsSync(file)).toBe(true);
  });

  it("reuses an earlier rendering, and renders again at another pace", async () => {
    const { tools, ran } = scratchTools();
    const speak = speaker(tools);
    await speak("Asks.", "review");
    await speak("Asks.", "review");
    await speak("Asks.", "walkthrough");
    expect(ran.map((call) => call.file)).toEqual([
      SAY,
      AFINFO,
      AFINFO,
      SAY,
      AFINFO,
    ]);
    const slower = `${speechKey("Asks.", "walkthrough")}.aiff`;
    const file = path.join(tools.sayCache, slower);
    expect(ran[3]?.args).toEqual(sayArgs("Asks.", file, "walkthrough"));
  });

  it("reads the engine once, when made, so a bad setting fails first", () => {
    const { tools, ran } = scratchTools({ env: { DEMO_VOICE: "siri" } });
    expect(() => speaker(tools)).toThrow();
    expect(ran).toEqual([]);
  });
});

describe("speaker with a hosted engine", () => {
  it("asks the engine once, keeps its answer, and holds for the tail too", async () => {
    const { tools, ran, fetched } = scratchTools({
      env: { DEMO_VOICE: "openai", OPENAI_API_KEY: "sk-shell" },
    });
    const speak = speaker(tools);
    const first = await speak("Asks.", "review");
    const again = await speak("Asks.", "review");
    const request = speechRequest(OPENAI, "Asks.", "review", "sk-shell");
    const file = path.join(
      tools.hostedCache,
      hostedFileName(OPENAI, "Asks.", "review", request.extension),
    );
    expect(first).toEqual({ audio: file, holdMs: 1250 + HOSTED_TAIL_MS });
    expect(again).toEqual(first);
    expect([...readFileSync(file)]).toEqual([7, 8, 9]);
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.url).toBe(request.url);
    const { signal, ...rest } = fetched[0]?.init ?? {};
    expect(rest).toEqual({
      method: "POST",
      headers: request.headers,
      body: request.body,
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(ran).toEqual([
      { file: AFINFO, args: [file] },
      { file: AFINFO, args: [file] },
    ]);
  });

  it("takes the key from the Keychain when the shell has none", async () => {
    for (const env of [
      { DEMO_VOICE: "elevenlabs" },
      { DEMO_VOICE: "elevenlabs", ELEVENLABS_API_KEY: "" },
    ]) {
      const { tools, ran, fetched } = scratchTools({
        env,
        keychain: "  xi-key\n",
      });
      await speaker(tools)("Asks.", "review");
      expect(ran[0]).toEqual({
        file: SECURITY,
        args: ["find-generic-password", "-s", "dialed-demo-elevenlabs", "-w"],
      });
      expect(fetched[0]?.init.headers).toEqual({
        "xi-api-key": "xi-key",
        "Content-Type": "application/json",
      });
    }
  });

  it("says how to store a key when there is none, without fetching", async () => {
    const { tools, fetched } = scratchTools({ env: { DEMO_VOICE: "openai" } });
    await expect(speaker(tools)("Asks.", "review")).rejects.toThrow(
      new Error(
        'DEMO_VOICE=openai needs OPENAI_API_KEY in the shell, or a Keychain item: security add-generic-password -a "$USER" -s dialed-demo-openai -w',
      ),
    );
    expect(fetched).toEqual([]);
  });

  it("fails on a refusal with its status and the start of its body, caching nothing", async () => {
    const { tools } = scratchTools({
      env: { DEMO_VOICE: "openai", OPENAI_API_KEY: "sk-shell" },
      answer: () => new Response(`${"x".repeat(300)}TAIL`, { status: 429 }),
    });
    await expect(speaker(tools)("Asks.", "review")).rejects.toThrow(
      new Error(`openai answered 429: ${"x".repeat(300)}`),
    );
    expect(existsSync(tools.hostedCache)).toBe(false);
  });
});

describe("localTools", () => {
  it("is this machine: its environment, network, programs and caches", async () => {
    const tools = localTools();
    expect(tools.env).toBe(process.env);
    expect(tools.fetch).toBe(fetch);
    expect(tools.sayCache).toBe(path.resolve("node_modules/.cache/demo-voice"));
    expect(tools.hostedCache).toBe(
      path.join(homedir(), ".cache", "dialed-voice"),
    );
    expect(await tools.run("/bin/echo", ["spoken"])).toMatchObject({
      stdout: "spoken\n",
    });
  });
});
