import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

/** The checked-out branch, read from git's own files rather than the `git`
 *  binary (shelling out to a PATH lookup trips sonarjs/no-os-command-from-path).
 *  In a worktree `.git` is a file pointing at the real gitdir, so both plain
 *  checkouts and lane worktrees resolve. */
function currentBranch(): string | undefined {
  try {
    let gitDir = path.join(process.cwd(), ".git");
    if (statSync(gitDir).isFile()) {
      const pointer = /^gitdir: (?<dir>.+)$/mu.exec(
        readFileSync(gitDir, "utf8"),
      )?.groups?.dir;
      if (pointer === undefined) return undefined;
      gitDir = path.resolve(path.dirname(gitDir), pointer.trim());
    }
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    return /^ref: refs\/heads\/(?<branch>.+)$/u.exec(head)?.groups?.branch;
  } catch {
    // Not a git checkout, or HEAD is unreadable — the caller falls back.
    return undefined;
  }
}

/** Lane worktrees run concurrently (docs/workflow.md §Fan-out). A shared port
 *  plus `reuseExistingServer` silently pointed one lane's tests at another
 *  lane's dev server, so each worktree gets its own: an explicit
 *  DIALED_E2E_PORT wins, else `lane/<N>-*` maps to 3000+N, else 3000 — which
 *  covers CI and any non-lane branch. */
function resolvePort(): number {
  const explicit = process.env.DIALED_E2E_PORT;
  if (explicit !== undefined && explicit !== "") return Number(explicit);

  const branch = currentBranch() ?? path.basename(process.cwd());
  const lane = /^(?:lane\/|dialed-)(?<number>\d+)(?:-|$)/u.exec(branch)?.groups
    ?.number;
  return lane === undefined ? 3000 : 3000 + Number(lane);
}

const port = resolvePort();

/**
 * Milliseconds of pacing between demo actions, and the switch that decides
 * whether a video is recorded at all. 0 (the default, and what CI gets)
 * means full speed and no video. `npm run demo` sets it.
 */
const demoSlowMo = Number(process.env.DEMO_SLOWMO ?? 0);

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${String(port)}` },
  // One demo per feature carries the happy-path journey and is recorded; the
  // edge-case specs around it are not. Recording everything would bury the
  // journey in thirty validation cases and make the video unwatchable.
  projects: [
    { name: "e2e", testIgnore: "**/*.demo.spec.ts" },
    {
      name: "demo",
      testMatch: "**/*.demo.spec.ts",
      use: {
        viewport: { width: 1280, height: 720 },
        // "no-preference", explicitly: motion.css collapses moves under
        // reduced motion, and a demo must record the full experience.
        reducedMotion: "no-preference",
        // Pacing and recording are OPT-IN, via DEMO_SLOWMO.
        //
        // A demo that runs at machine speed is unwatchable — the first
        // recording of the auth journey was 1.7s end to end — so `npm run
        // demo` sets DEMO_SLOWMO=1800 and every action is paced (raised
        // 450 -> 900 -> 1800 on review feedback: reviewers kept losing the
        // cause of a state change).
        //
        // But CI does not watch videos, and it was paying the pacing
        // anyway: the closet journey measured 7.7s unpaced against 51.9s
        // paced — 44s of pure waiting, per demo, per run. Worse, it made
        // the 30s default timeout a moving target, which is exactly how
        // that spec broke when this raise landed on a branch written
        // before it.
        //
        // So: bare `playwright test` (what CI runs) exercises the demo
        // journeys at full speed and asserts everything they assert.
        // Recording is a separate, deliberate act.
        //
        // Slowing the video in post is not the alternative — Playwright
        // captures ~25fps, so a 7.7s run is ~192 frames, and stretching
        // those over 52s yields under 4fps. A slideshow, not a demo.
        launchOptions: { slowMo: demoSlowMo },
        video: demoSlowMo
          ? { mode: "on", size: { width: 1280, height: 720 } }
          : "off",
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    // VITE_DEVTOOLS=off keeps the floating devtools button out of demo
    // recordings (it covers the tab bar's last item at 1280×720).
    env: { PORT: String(port), VITE_DEVTOOLS: "off" },
    url: `http://localhost:${String(port)}`,
    // Never reuse: with per-worktree ports there is nothing legitimate to
    // reuse, and a busy port must fail loudly rather than hand these tests a
    // server built from a different worktree.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
